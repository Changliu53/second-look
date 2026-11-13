import { z } from "zod";
import type { Database } from "@/db/client";
import {
  claimReviewForPublish,
  decideFinding,
  editFinding,
  getFinding,
  getLatestPublishedReview,
  getReviewDetail,
  listOpenReviews,
  listPublishedReviews,
  recordGithubReviewId,
  releasePublishClaim,
  type FindingDecision,
  type ReviewDetail,
  type ReviewListItem,
} from "@/db/queries";
import { checkRunFor } from "@/github/check-run";
import type { GitHubClient } from "@/github/client";
import { buildReviewPayload, type Resolution } from "@/github/publish";
import type { PullRequestRef } from "@/lib/env";
import { logEvent, safeErrorCode } from "@/lib/log";
import { parseUnifiedDiff } from "@/review/diff";
import { canReviewRepository } from "@/github/access";
import { getDiffCached } from "./diff-cache";

/**
 * Everything the dashboard can do, as plain functions. The Next.js pages and
 * server actions are thin wrappers around these, which keeps the rules
 * (who may act, what may be published) testable without a browser.
 */

export type DashboardDeps = {
  db: Database;
  /** Returns a client for the GitHub App installation that owns a repo. */
  githubFor: (installationId: number) => Promise<GitHubClient>;
};

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
  github_rejected: "GitHub did not accept the review. Nothing was published. Try again.",
} as const;

export type ActionErrorCode = keyof typeof ACTION_ERRORS;

export type ActionResult = { ok: true } | { ok: false; error: ActionErrorCode };

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
  const allowed = await canReviewRepository(github, detail.repository, login);
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
      allowed = await canReviewRepository(github, item.repository, login);
      allowedByRepo.set(item.repository.id, allowed);
    }
    if (allowed) {
      visible.push(item);
    }
  }
  return visible;
}

export async function listReviewsFor(login: string, deps: DashboardDeps): Promise<ReviewListItem[]> {
  return visibleTo(login, await listOpenReviews(deps.db), deps);
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
): Promise<{ detail: ReviewDetail; diff: string | null } | null> {
  const loaded = await loadReviewFor(reviewId, login, deps);
  if (!loaded) {
    return null;
  }
  // The diff is fetched from GitHub on every view instead of being stored.
  // If GitHub is unreachable the findings are still shown, without the diff.
  let diff: string | null = null;
  try {
    diff = await getDiffCached(
      loaded.github,
      loaded.detail.repository,
      loaded.detail.pullRequest.number,
      loaded.detail.review.headSha,
    );
  } catch (error) {
    logEvent("dashboard_diff_fetch_failed", { reviewId, error: safeErrorCode(error) });
  }
  return { detail: loaded.detail, diff };
}

/**
 * Loads the published review of the configured demo pull request. No login is
 * needed: the PR is in a public repository and the review is already posted
 * there. Unpublished reviews are never returned.
 */
export async function getDemoReview(
  pull: PullRequestRef,
  deps: DashboardDeps,
): Promise<{ detail: ReviewDetail; diff: string | null } | null> {
  const detail = await getLatestPublishedReview(deps.db, pull);
  if (!detail) {
    return null;
  }
  let diff: string | null = null;
  try {
    const github = await deps.githubFor(detail.repository.installationId);
    diff = await github.getPullRequestDiff(detail.repository, pull.number);
  } catch (error) {
    logEvent("demo_diff_fetch_failed", { error: safeErrorCode(error) });
  }
  return { detail, diff };
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
  return { ok: true };
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
  await editFinding(deps.db, findingId, edit.data, login);
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
