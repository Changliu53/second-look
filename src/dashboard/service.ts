import { z } from "zod";
import type { Database } from "@/db/client";
import {
  addHumanFinding,
  claimReviewForPublish,
  decideFinding,
  editFinding,
  getFinding,
  getPublishedReview,
  listReviewRounds,
  getReviewDetail,
  isStaleRunning,
  latestActivity,
  latestReviewId,
  listFindingEvents,
  listOpenReviews,
  listPublishedFindings,
  listPublishedFollowUps,
  listPublishedReviews,
  listRepositories,
  recordGithubReviewId,
  releasePublishClaim,
  removeHumanFinding,
  updateHumanFinding,
  type FindingDecision,
  type ReviewDetail,
  type ReviewListItem,
  type ReviewRound,
} from "@/db/queries";
import type { FindingEvent, Repository, Review } from "@/db/schema";
import type { PullRequestEvent } from "@/github/webhook-payload";
import { checkRunFor } from "@/github/check-run";
import type { GitHubClient, RepoRef } from "@/github/client";
import { buildReviewPayload, type Resolution } from "@/github/publish";
import type { PullRequestRef } from "@/lib/env";
import { logEvent, safeErrorCode } from "@/lib/log";
import { parseUnifiedDiff } from "@/review/diff";
import { CATEGORIES, SEVERITIES } from "@/review/schema";
import { canReviewRepository, PermissionCache } from "@/github/access";
import { getReviewDiff, type ReviewDiffTarget } from "./diff-cache";
import { summarizeDecisions, type DecidedFinding, type Insights } from "./insights";

/**
 * Everything the dashboard can do, as plain functions. The Next.js pages and
 * server actions are thin wrappers around these, which keeps the rules
 * (who may act, what may be published) testable without a browser.
 */

export type DashboardDeps = {
  db: Database;
  /** Returns a client for the GitHub App installation that owns a repo. */
  githubFor: (installationId: number) => Promise<GitHubClient>;
  /** Remembers access answers for a while. Without it, GitHub is asked every time. */
  permissions?: PermissionCache;
};

/** Whether `login` may review `repo`: write access, asked of GitHub or the cache. */
function mayReview(deps: DashboardDeps, github: GitHubClient, repo: RepoRef, login: string): Promise<boolean> {
  return deps.permissions
    ? deps.permissions.canReview(github, repo, login)
    : canReviewRepository(github, repo, login);
}

/**
 * Why an action was refused. The code, not the sentence, travels in the URL
 * back to the page, so a crafted link cannot make the dashboard display
 * arbitrary text.
 */
export const ACTION_ERRORS = {
  not_found: "That review or finding was not found.",
  already_published: "This review is already published.",
  out_of_date: "A newer commit was pushed. This review is out of date.",
  not_finished: "This review did not finish, so there is nothing to publish.",
  pending_findings: "Confirm or reject every finding before publishing.",
  no_summary: "This review has no summary to publish.",
  invalid_edit: "The explanation cannot be empty or longer than 5,000 characters.",
  invalid_finding:
    "The finding was not saved. It needs a file from this pull request, a line, and an explanation.",
  not_ready: "Findings can be added once the AI review has finished.",
  github_rejected: "GitHub did not accept the review. Nothing was published. Try again.",
  not_rerunnable: "Only a review that failed or did not finish can be run again.",
  pull_request_closed: "The pull request is closed on GitHub, so it is not reviewed again.",
  rerun_skipped: "The review was not started. Another run for this commit may already be going.",
} as const;

export type ActionErrorCode = keyof typeof ACTION_ERRORS;

export type ActionResult =
  | {
      ok: true;
      /** Set when this action decided the review's last pending finding. */
      allDecided?: true;
    }
  | { ok: false; error: ActionErrorCode };

const fail = (error: ActionErrorCode): ActionResult => ({ ok: false, error });

async function loadReviewFor(
  reviewId: number,
  login: string,
  deps: DashboardDeps,
): Promise<{ detail: ReviewDetail; github: GitHubClient } | null> {
  const detail = await getReviewDetail(deps.db, reviewId);
  if (!detail) {
    return null;
  }
  const github = await deps.githubFor(detail.repository.installationId);
  const allowed = await mayReview(deps, github, detail.repository, login);
  // A user without access gets the same answer as for a missing review, so
  // the dashboard does not reveal which review ids exist.
  return allowed ? { detail, github } : null;
}

/** Keeps only the reviews of repositories the user may review. */
async function visibleTo(
  login: string,
  items: ReviewListItem[],
  deps: DashboardDeps,
): Promise<ReviewListItem[]> {
  // One permission lookup per repository, however many reviews it has.
  const allowedByRepo = new Map<number, boolean>();
  const visible: ReviewListItem[] = [];

  for (const item of items) {
    let allowed = allowedByRepo.get(item.repository.id);
    if (allowed === undefined) {
      const github = await deps.githubFor(item.repository.installationId);
      allowed = await mayReview(deps, github, item.repository, login);
      allowedByRepo.set(item.repository.id, allowed);
    }
    if (allowed) {
      visible.push(item);
    }
  }
  return visible;
}

function diffTarget(detail: ReviewDetail): ReviewDiffTarget {
  return {
    pullNumber: detail.pullRequest.number,
    headSha: detail.review.headSha,
    currentHeadSha: detail.pullRequest.headSha,
    base: detail.review.baseSha ?? detail.pullRequest.baseRef,
  };
}

export async function listReviewsFor(login: string, deps: DashboardDeps): Promise<ReviewListItem[]> {
  const items = await visibleTo(login, await listOpenReviews(deps.db), deps);
  // So a team can see that someone is already working through a review.
  const activity = await latestActivity(deps.db, items.map((item) => item.review.id));
  return items.map((item) => {
    const last = activity.get(item.review.id);
    return last ? { ...item, lastActivity: last } : item;
  });
}

const RECENT_PUBLISHED_LIMIT = 10;

export async function listPublishedReviewsFor(
  login: string,
  deps: DashboardDeps,
): Promise<ReviewListItem[]> {
  return visibleTo(login, await listPublishedReviews(deps.db, RECENT_PUBLISHED_LIMIT), deps);
}

export async function getReviewFor(
  reviewId: number,
  login: string,
  deps: DashboardDeps,
): Promise<{
  detail: ReviewDetail;
  diff: string | null;
  rounds: ReviewRound[];
  history: FindingEvent[];
  /** The review of the pull request's latest commit, when it is not this one. */
  newerReviewId: number | null;
} | null> {
  const loaded = await loadReviewFor(reviewId, login, deps);
  if (!loaded) {
    return null;
  }
  const { detail } = loaded;
  const [rounds, history, latestId] = await Promise.all([
    listReviewRounds(deps.db, detail.pullRequest.id),
    listFindingEvents(deps.db, reviewId),
    latestReviewId(deps.db, detail.pullRequest.id),
  ]);

  // The diff is fetched from GitHub instead of being stored. If GitHub is
  // unreachable the findings are still shown, without the diff.
  let diff: string | null = null;
  try {
    diff = await getReviewDiff(loaded.github, detail.repository, diffTarget(detail));
  } catch (error) {
    logEvent("dashboard_diff_fetch_failed", { reviewId, error: safeErrorCode(error) });
  }
  return { detail, diff, rounds, history, newerReviewId: latestId !== reviewId ? latestId : null };
}

/**
 * Loads a published review of the configured example pull request, with the
 * list of all its rounds. No login is needed: the pull request is in a public
 * repository and the reviews are already posted there. Unpublished reviews
 * are never returned.
 */
export async function getDemoReview(
  pull: PullRequestRef,
  deps: DashboardDeps,
  round?: number,
): Promise<{ detail: ReviewDetail; diff: string | null; rounds: ReviewRound[] } | null> {
  const detail = await getPublishedReview(deps.db, pull, round);
  if (!detail) {
    return null;
  }
  const rounds = await listReviewRounds(deps.db, detail.pullRequest.id);
  let diff: string | null = null;
  try {
    const github = await deps.githubFor(detail.repository.installationId);
    diff = await getReviewDiff(github, detail.repository, diffTarget(detail));
  } catch (error) {
    logEvent("demo_diff_fetch_failed", { error: safeErrorCode(error) });
  }
  return { detail, diff, rounds };
}

function editableProblem(detail: ReviewDetail): ActionErrorCode | null {
  if (detail.review.publishedAt !== null) {
    return "already_published";
  }
  if (detail.review.status === "superseded") {
    return "out_of_date";
  }
  return null;
}

async function loadFindingFor(findingId: number, login: string, deps: DashboardDeps) {
  const finding = await getFinding(deps.db, findingId);
  if (!finding) {
    return null;
  }
  const loaded = await loadReviewFor(finding.reviewId, login, deps);
  return loaded ? { finding, detail: loaded.detail } : null;
}

/**
 * True when `findingId` is pending and is the only pending finding left, so
 * deciding it finishes the review. The page then tells the reviewer they can
 * publish. Changing an earlier decision does not count: nothing was finished.
 */
function isLastPending(detail: ReviewDetail, findingId: number): boolean {
  const pending = detail.findings.filter((finding) => finding.status === "pending");
  return pending.length === 1 && pending[0]?.id === findingId;
}

export async function decideFindingFor(
  findingId: number,
  decision: FindingDecision,
  login: string,
  deps: DashboardDeps,
): Promise<ActionResult> {
  const loaded = await loadFindingFor(findingId, login, deps);
  if (!loaded) {
    return fail("not_found");
  }
  const problem = editableProblem(loaded.detail);
  if (problem) {
    return fail(problem);
  }
  await decideFinding(deps.db, findingId, decision, login);
  const finishes = decision.status !== "pending" && isLastPending(loaded.detail, findingId);
  return finishes ? { ok: true, allDecided: true } : { ok: true };
}

export const findingEditSchema = z.object({
  explanation: z.string().trim().min(1, "The explanation cannot be empty.").max(5_000),
  suggestedFix: z
    .string()
    .trim()
    .max(5_000)
    .transform((value) => (value === "" ? null : value)),
});

export async function editFindingFor(
  findingId: number,
  rawEdit: unknown,
  login: string,
  deps: DashboardDeps,
): Promise<ActionResult> {
  const edit = findingEditSchema.safeParse(rawEdit);
  if (!edit.success) {
    return fail("invalid_edit");
  }
  const loaded = await loadFindingFor(findingId, login, deps);
  if (!loaded) {
    return fail("not_found");
  }
  const problem = editableProblem(loaded.detail);
  if (problem) {
    return fail(problem);
  }
  if (loaded.finding.source === "human") {
    // The reviewer is rewriting their own text; there is no AI original.
    await updateHumanFinding(deps.db, findingId, edit.data, login);
  } else {
    await editFinding(deps.db, findingId, edit.data, login);
  }
  // An edit confirms the finding, so it can be the one that finishes the review.
  return isLastPending(loaded.detail, findingId) ? { ok: true, allDecided: true } : { ok: true };
}

const optionalText = z
  .string()
  .trim()
  .max(5_000)
  .transform((value) => (value === "" ? null : value));

export const newFindingSchema = z
  .object({
    filePath: z.string().trim().min(1).max(500),
    startLine: z.coerce.number().int().positive(),
    // Left empty in the form for a single line.
    endLine: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce.number().int().positive().optional(),
    ),
    severity: z.enum(SEVERITIES),
    category: z.enum(CATEGORIES),
    explanation: z.string().trim().min(1).max(5_000),
    suggestedFix: optionalText,
  })
  .refine((value) => value.endLine === undefined || value.endLine >= value.startLine);

export type AddFindingResult =
  | { ok: true; findingId: number }
  | { ok: false; error: ActionErrorCode };

/**
 * Adds a finding the reviewer wrote: something the AI missed. It is stored
 * as confirmed and goes out with the rest when the review is published.
 */
export async function addFindingFor(
  reviewId: number,
  rawFinding: unknown,
  login: string,
  deps: DashboardDeps,
): Promise<AddFindingResult> {
  const parsed = newFindingSchema.safeParse(rawFinding);
  if (!parsed.success) {
    return { ok: false, error: "invalid_finding" };
  }
  const loaded = await loadReviewFor(reviewId, login, deps);
  if (!loaded) {
    return { ok: false, error: "not_found" };
  }
  const { detail, github } = loaded;
  const problem = editableProblem(detail);
  if (problem) {
    return { ok: false, error: problem };
  }
  // A too-large review has no AI findings, which is exactly when a reviewer
  // may want to write their own.
  if (detail.review.status !== "completed" && detail.review.status !== "too_large") {
    return { ok: false, error: "not_ready" };
  }

  // The file has to be one this pull request changes. If GitHub cannot be
  // reached to check, the finding is refused, not saved unverified.
  let changedPaths: Set<string>;
  try {
    const diff = await getReviewDiff(github, detail.repository, diffTarget(detail));
    changedPaths = new Set(parseUnifiedDiff(diff ?? "").map((file) => file.path));
  } catch (error) {
    logEvent("add_finding_diff_failed", { reviewId, error: safeErrorCode(error) });
    return { ok: false, error: "invalid_finding" };
  }
  if (!changedPaths.has(parsed.data.filePath)) {
    return { ok: false, error: "invalid_finding" };
  }

  const finding = await addHumanFinding(
    deps.db,
    reviewId,
    { ...parsed.data, endLine: parsed.data.endLine ?? parsed.data.startLine },
    login,
  );
  return { ok: true, findingId: finding.id };
}

/** Deletes a finding the reviewer added. AI findings are rejected, not deleted. */
export async function removeFindingFor(
  findingId: number,
  login: string,
  deps: DashboardDeps,
): Promise<ActionResult> {
  const loaded = await loadFindingFor(findingId, login, deps);
  if (!loaded || loaded.finding.source !== "human") {
    return fail("not_found");
  }
  const problem = editableProblem(loaded.detail);
  if (problem) {
    return fail(problem);
  }
  await removeHumanFinding(deps.db, findingId, login);
  return { ok: true };
}

function publishProblem(detail: ReviewDetail): ActionErrorCode | null {
  const problem = editableProblem(detail);
  if (problem) {
    return problem;
  }
  if (detail.review.status !== "completed" && detail.review.status !== "too_large") {
    return "not_finished";
  }
  if (detail.review.headSha !== detail.pullRequest.headSha) {
    return "out_of_date";
  }
  // Publishing with undecided findings would silently drop them.
  if (detail.findings.some((finding) => finding.status === "pending")) {
    return "pending_findings";
  }
  return null;
}

/**
 * Posts the confirmed findings and the summary to GitHub as one review, then
 * completes the check run. This is the only code path that writes to a PR.
 */
export async function publishReviewFor(
  reviewId: number,
  reviewerNote: string | null,
  login: string,
  deps: DashboardDeps,
  resolution: Resolution = "author_fixes",
): Promise<ActionResult> {
  const loaded = await loadReviewFor(reviewId, login, deps);
  if (!loaded) {
    return fail("not_found");
  }
  const { detail, github } = loaded;
  const problem = publishProblem(detail);
  if (problem) {
    return fail(problem);
  }
  const { review, repository, pullRequest } = detail;
  if (review.summary === null || review.headSha === null) {
    return fail("no_summary");
  }

  const note = reviewerNote?.trim() ? reviewerNote.trim().slice(0, 2_000) : null;
  const claimed = await claimReviewForPublish(deps.db, reviewId, {
    publishedBy: login,
    reviewerNote: note,
    resolution,
  });
  if (!claimed) {
    return fail("already_published");
  }

  try {
    const diff = await github.getPullRequestDiff(repository, pullRequest.number);
    const payload = buildReviewPayload({
      headSha: review.headSha,
      summary: review.summary,
      findings: detail.findings,
      files: parseUnifiedDiff(diff),
      reviewerLogin: login,
      reviewerNote: note,
      resolution,
      pullRequestTitle: pullRequest.title,
    });
    const githubReviewId = await github.createReview(repository, pullRequest.number, payload);
    await recordGithubReviewId(deps.db, reviewId, githubReviewId);
  } catch (error) {
    await releasePublishClaim(deps.db, reviewId);
    logEvent("publish_failed", { reviewId, error: safeErrorCode(error) });
    return fail("github_rejected");
  }

  const confirmed = detail.findings.filter((finding) => finding.status === "confirmed");
  if (review.checkRunId !== null) {
    try {
      await github.updateCheckRun(
        repository,
        review.checkRunId,
        checkRunFor({
          kind: "published",
          confirmedCount: confirmed.length,
          confirmedCriticalCount: confirmed.filter((f) => f.severity === "critical").length,
          takenOverBy: resolution === "reviewer_takes_over" ? login : undefined,
        }),
      );
    } catch (error) {
      // The review is already on the PR. A stale check is the lesser problem.
      logEvent("check_run_update_failed", { reviewId, error: safeErrorCode(error) });
    }
  }

  logEvent("review_published", { reviewId, confirmed: confirmed.length, resolution });
  return { ok: true };
}

export type InsightsView = {
  insights: Insights;
  /** The repositories the numbers cover, as owner/name. */
  repositories: string[];
  publishedReviews: number;
};

/**
 * Totals of reviewers' decisions, over the repositories this user may
 * review. The same access rule as everywhere else: write access, asked of
 * GitHub, one lookup per repository.
 */
export async function getInsightsFor(login: string, deps: DashboardDeps): Promise<InsightsView> {
  const visible: Repository[] = [];
  for (const repository of await listRepositories(deps.db)) {
    const github = await deps.githubFor(repository.installationId);
    if (await mayReview(deps, github, repository, login)) {
      visible.push(repository);
    }
  }
  const ids = visible.map((repository) => repository.id);
  const [rows, published] = await Promise.all([
    listPublishedFindings(deps.db, ids),
    listPublishedFollowUps(deps.db, ids),
  ]);
  const decided: DecidedFinding[] = rows.flatMap((row) =>
    // The query leaves out pending findings; this narrows the type to match.
    row.status === "pending"
      ? []
      : [
          {
            source: row.source,
            status: row.status,
            severity: row.severity,
            category: row.category,
            edited: row.editedExplanation !== null,
            rejectionReason: row.rejectionReason,
          },
        ],
  );
  return {
    insights: summarizeDecisions(
      decided,
      published.flatMap((review) => review.followUp ?? []),
      published,
    ),
    repositories: visible.map((repository) => `${repository.owner}/${repository.name}`),
    publishedReviews: published.length,
  };
}

/** Why a review cannot be run again, or null if it can. */
export function rerunProblem(review: Review, now: Date = new Date()): ActionErrorCode | null {
  if (review.publishedAt !== null) {
    return "already_published";
  }
  if (review.status === "superseded") {
    return "out_of_date";
  }
  // A review that finished, or one still running normally, has nothing to
  // recover. Running it again would only spend another model call.
  if (review.status !== "failed" && !isStaleRunning(review, now)) {
    return "not_rerunnable";
  }
  return null;
}

/**
 * What a reviewer needs to start a failed review again: the pull request as
 * GitHub has it now, in the shape a webhook delivers. Reading it from GitHub
 * instead of the database means a new title, body, or commit is picked up.
 */
export async function prepareRerunFor(
  reviewId: number,
  login: string,
  deps: DashboardDeps,
): Promise<
  | { ok: true; event: PullRequestEvent; github: GitHubClient }
  | { ok: false; error: ActionErrorCode }
> {
  const loaded = await loadReviewFor(reviewId, login, deps);
  if (!loaded) {
    return { ok: false, error: "not_found" };
  }
  const { detail, github } = loaded;
  const problem = rerunProblem(detail.review);
  if (problem) {
    return { ok: false, error: problem };
  }
  const { repository, pullRequest } = detail;
  const current = await github.getPullRequest(repository, pullRequest.number);
  if (current.state !== "open") {
    return { ok: false, error: "pull_request_closed" };
  }
  return {
    ok: true,
    github,
    event: {
      action: "synchronize",
      number: pullRequest.number,
      pull_request: {
        title: current.title,
        body: current.body,
        draft: current.draft,
        user: { login: current.authorLogin },
        head: { sha: current.headSha },
        base: { ref: current.baseRef, sha: current.baseSha },
      },
      repository: {
        id: repository.githubRepoId,
        name: repository.name,
        owner: { login: repository.owner },
      },
      installation: { id: repository.installationId },
    },
  };
}

