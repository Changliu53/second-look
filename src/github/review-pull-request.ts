import type { Database } from "@/db/client";
import {
  completeReview,
  failReview,
  getEarlierDecisions,
  setCheckRunId,
  setReviewStage,
  startGithubReview,
  upsertPullRequest,
  upsertRepository,
} from "@/db/queries";
import { logEvent, safeErrorCode } from "@/lib/log";
import { parseUnifiedDiff } from "@/review/diff";
import {
  reviewChange,
  tooLargeResult,
  type ReviewInput,
  type ReviewLimits,
  type ReviewModel,
  type ReviewResult,
} from "@/review/engine";
import { getSkipReason } from "@/review/filters";
import type { Finding, FollowUpEntry, ReviewStage } from "@/db/schema";
import type { EarlierFinding, EarlierReview, FileContext } from "@/review/prompt";
import type { FollowUp } from "@/review/schema";
import { publishedText } from "./publish";
import { canReviewRepository } from "./access";
import { checkRunFor, type CheckState } from "./check-run";
import { DiffTooLargeError, type GitHubClient, type RepoRef } from "./client";
import type { PullRequestEvent } from "./webhook-payload";

export const GUIDELINES_PATH = ".second-look.md";

/** Upper bound on GitHub API calls spent fetching context for one review. */
const MAX_CONTEXT_FILES = 15;

export type ReviewDeps = {
  db: Database;
  github: GitHubClient;
  model: ReviewModel;
  limits: ReviewLimits;
  appUrl: string;
};

/**
 * Fetches the full contents of the changed files at the PR head. Stops when
 * the context budget or the file cap is reached, so a PR touching hundreds of
 * files does not turn into hundreds of API calls.
 */
async function fetchFileContexts(
  github: GitHubClient,
  repo: RepoRef,
  diff: string,
  headSha: string,
  maxContextChars: number,
): Promise<FileContext[]> {
  const paths = parseUnifiedDiff(diff)
    .filter((file) => file.status !== "deleted")
    .filter((file) => getSkipReason(file.path, file.isBinary) === null)
    .map((file) => file.path)
    .slice(0, MAX_CONTEXT_FILES);

  const contexts: FileContext[] = [];
  let used = 0;
  for (const path of paths) {
    if (used >= maxContextChars) {
      break;
    }
    const content = await github.getFileContent(repo, path, headSha);
    if (content !== null) {
      contexts.push({ path, content });
      used += content.length;
    }
  }
  return contexts;
}

/** Check-run updates are best effort: a failed status update must not fail the review. */
async function updateCheck(
  github: GitHubClient,
  repo: RepoRef,
  checkRunId: number | null,
  state: CheckState,
): Promise<void> {
  if (checkRunId === null) {
    return;
  }
  try {
    await github.updateCheckRun(repo, checkRunId, checkRunFor(state));
  } catch (error) {
    logEvent("check_run_update_failed", { checkRunId, error: safeErrorCode(error) });
  }
}

async function createCheck(
  deps: ReviewDeps,
  repo: RepoRef,
  headSha: string,
  reviewId: number,
): Promise<number | null> {
  try {
    const checkRunId = await deps.github.createCheckRun(repo, {
      ...checkRunFor({ kind: "reviewing" }),
      headSha,
      detailsUrl: `${deps.appUrl}/dashboard/reviews/${reviewId}`,
    });
    await setCheckRunId(deps.db, reviewId, checkRunId);
    return checkRunId;
  } catch (error) {
    logEvent("check_run_create_failed", { reviewId, error: safeErrorCode(error) });
    return null;
  }
}

function toEarlierFinding(prefix: string, finding: Finding): EarlierFinding {
  return {
    id: `${prefix}${finding.id}`,
    file: finding.filePath,
    startLine: finding.startLine,
    endLine: finding.endLine,
    // What the author actually received: the reviewer's edit if there was one.
    explanation: publishedText(finding).explanation,
  };
}

const CONFIRMED_PREFIX = "P";
const REJECTED_PREFIX = "R";

/** Turns the last review's decisions into what the prompt needs. */
export function toEarlierReview(confirmed: Finding[], rejected: Finding[]): EarlierReview {
  return {
    confirmed: confirmed.map((finding) => toEarlierFinding(CONFIRMED_PREFIX, finding)),
    rejected: rejected.map((finding) => ({
      ...toEarlierFinding(REJECTED_PREFIX, finding),
      reason: finding.rejectionReason,
    })),
  };
}

/** Joins the model's verdicts back to the earlier findings they are about. */
export function toFollowUpEntries(verdicts: FollowUp[], confirmed: Finding[]): FollowUpEntry[] {
  const entries: FollowUpEntry[] = [];
  for (const finding of confirmed) {
    const verdict = verdicts.find((entry) => entry.id === `${CONFIRMED_PREFIX}${finding.id}`);
    if (!verdict) {
      continue;
    }
    entries.push({
      previousFindingId: finding.id,
      status: verdict.status,
      note: verdict.note,
      filePath: finding.filePath,
      startLine: finding.startLine,
      severity: finding.severity,
      explanation: publishedText(finding).explanation,
    });
  }
  return entries;
}

/**
 * Gathers the inputs from GitHub and runs the engine. `onStage` is told as
 * each step starts, so the dashboard can show progress while this runs.
 */
async function runReview(
  event: PullRequestEvent,
  repo: RepoRef,
  deps: ReviewDeps,
  earlier: EarlierReview | undefined,
  onStage: (stage: ReviewStage) => Promise<void>,
): Promise<ReviewResult> {
  await onStage("fetching_diff");
  let diff: string;
  try {
    diff = await deps.github.getPullRequestDiff(repo, event.number);
  } catch (error) {
    if (error instanceof DiffTooLargeError) {
      return tooLargeResult("GitHub could not render a diff this big");
    }
    throw error;
  }

  await onStage("reading_files");
  // Read the rules from the base branch, not the PR head. Otherwise the
  // author of a PR could change the rules that review their own PR.
  const guidelines = await deps.github.getFileContent(
    repo,
    GUIDELINES_PATH,
    event.pull_request.base.ref,
  );
  const fileContents = await fetchFileContexts(
    deps.github,
    repo,
    diff,
    event.pull_request.head.sha,
    deps.limits.maxContextChars,
  );

  const input: ReviewInput = {
    diff,
    title: event.pull_request.title,
    description: event.pull_request.body ?? undefined,
    fileContents,
    guidelines: guidelines ?? undefined,
    earlier,
  };
  await onStage("model_reviewing");
  return reviewChange(input, deps.model, deps.limits);
}

/**
 * Handles one pull_request webhook: record the PR, run the review, store the
 * findings as "pending", and update the check run. Never throws; a failure is
 * recorded on the review row and shown on the check run.
 */
export async function reviewPullRequest(event: PullRequestEvent, deps: ReviewDeps): Promise<void> {
  const repo: RepoRef = { owner: event.repository.owner.login, name: event.repository.name };
  const headSha = event.pull_request.head.sha;

  // Cost guard for public repositories: anyone can open a pull request from a
  // fork, and every review is a paid model call. Only authors who can already
  // write to the repository get an automatic review.
  const authorLogin = event.pull_request.user.login;
  if (!(await canReviewRepository(deps.github, repo, authorLogin))) {
    logEvent("review_skipped_outside_author", { pullNumber: event.number });
    return;
  }

  const repository = await upsertRepository(deps.db, {
    githubRepoId: event.repository.id,
    installationId: event.installation.id,
    owner: repo.owner,
    name: repo.name,
  });
  const pullRequest = await upsertPullRequest(deps.db, {
    repositoryId: repository.id,
    number: event.number,
    title: event.pull_request.title,
    authorLogin,
    headSha,
    baseRef: event.pull_request.base.ref,
  });

  const { review, shouldRun } = await startGithubReview(deps.db, {
    pullRequestId: pullRequest.id,
    headSha,
  });
  if (!shouldRun) {
    logEvent("review_skipped_duplicate", { reviewId: review.id });
    return;
  }

  const checkRunId = await createCheck(deps, repo, headSha, review.id);

  try {
    // If a reviewer already went through this pull request at an earlier
    // commit, carry their decisions into this review.
    const decisions = await getEarlierDecisions(deps.db, pullRequest.id, headSha);
    const earlier = decisions
      ? toEarlierReview(decisions.confirmed, decisions.rejected)
      : undefined;

    const result = await runReview(event, repo, deps, earlier, (stage) =>
      setReviewStage(deps.db, review.id, stage),
    );
    const followUp = toFollowUpEntries(result.followUp, decisions?.confirmed ?? []);

    const stillCurrent = await completeReview(deps.db, review.id, result, followUp);
    if (!stillCurrent) {
      // A newer commit arrived while the model was working. Its own review
      // owns the PR now; this one only needs its check run closed.
      await updateCheck(deps.github, repo, checkRunId, { kind: "superseded" });
      logEvent("review_superseded_while_running", { reviewId: review.id });
      return;
    }
    await updateCheck(deps.github, repo, checkRunId, {
      kind: "awaiting_reviewer",
      findingCount: result.findings.length,
      tooLarge: result.status === "too_large",
    });
    logEvent("review_completed", {
      reviewId: review.id,
      status: result.status,
      findings: result.findings.length,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
  } catch (error) {
    const code = safeErrorCode(error);
    const stillCurrent = await failReview(deps.db, review.id, code);
    await updateCheck(deps.github, repo, checkRunId, {
      kind: stillCurrent ? "failed" : "superseded",
    });
    logEvent("review_failed", { reviewId: review.id, error: code });
  }
}
