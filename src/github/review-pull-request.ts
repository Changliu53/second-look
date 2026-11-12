import type { Database } from "@/db/client";
import {
  completeReview,
  failReview,
  setCheckRunId,
  startGithubReview,
  upsertPullRequest,
  upsertRepository,
} from "@/db/queries";
import { logEvent, safeErrorCode } from "@/lib/log";
import { parseUnifiedDiff } from "@/review/diff";
import { reviewChange, type ReviewLimits, type ReviewModel } from "@/review/engine";
import { getSkipReason } from "@/review/filters";
import type { FileContext } from "@/review/prompt";
import { checkRunFor, type CheckState } from "./check-run";
import type { GitHubClient, RepoRef } from "./client";
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

/**
 * Handles one pull_request webhook: record the PR, run the review, store the
 * findings as "pending", and update the check run. Never throws; a failure is
 * recorded on the review row and shown on the check run.
 */
export async function reviewPullRequest(event: PullRequestEvent, deps: ReviewDeps): Promise<void> {
  const repo: RepoRef = { owner: event.repository.owner.login, name: event.repository.name };
  const headSha = event.pull_request.head.sha;

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
    authorLogin: event.pull_request.user.login,
    headSha,
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
    const diff = await deps.github.getPullRequestDiff(repo, event.number);
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
      headSha,
      deps.limits.maxContextChars,
    );

    const result = await reviewChange(
      {
        diff,
        title: event.pull_request.title,
        description: event.pull_request.body ?? undefined,
        fileContents,
        guidelines: guidelines ?? undefined,
      },
      deps.model,
      deps.limits,
    );

    await completeReview(deps.db, review.id, result);
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
    await failReview(deps.db, review.id, code);
    await updateCheck(deps.github, repo, checkRunId, { kind: "failed" });
    logEvent("review_failed", { reviewId: review.id, error: code });
  }
}
