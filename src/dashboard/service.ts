import { z } from "zod";
import type { Database } from "@/db/client";
import {
  claimReviewForPublish,
  decideFinding,
  editFinding,
  getFinding,
  getReviewDetail,
  listOpenReviews,
  recordGithubReviewId,
  releasePublishClaim,
  type FindingDecision,
  type ReviewDetail,
  type ReviewListItem,
} from "@/db/queries";
import { checkRunFor } from "@/github/check-run";
import type { GitHubClient } from "@/github/client";
import { buildReviewPayload } from "@/github/publish";
import { logEvent, safeErrorCode } from "@/lib/log";
import { parseUnifiedDiff } from "@/review/diff";
import { canReviewRepository } from "./access";

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

export type ActionResult = { ok: true } | { ok: false; error: string };

const fail = (error: string): ActionResult => ({ ok: false, error });

const NOT_FOUND = "Review not found.";

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

export async function listReviewsFor(login: string, deps: DashboardDeps): Promise<ReviewListItem[]> {
  const items = await listOpenReviews(deps.db);
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
    diff = await loaded.github.getPullRequestDiff(loaded.detail.repository, loaded.detail.pullRequest.number);
  } catch (error) {
    logEvent("dashboard_diff_fetch_failed", { reviewId, error: safeErrorCode(error) });
  }
  return { detail: loaded.detail, diff };
}

function editableProblem(detail: ReviewDetail): string | null {
  if (detail.review.publishedAt !== null) {
    return "This review is already published.";
  }
  if (detail.review.status === "superseded") {
    return "A newer commit was pushed. This review is out of date.";
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
    return fail("Finding not found.");
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
    return fail(edit.error.issues[0]?.message ?? "Invalid edit.");
  }
  const loaded = await loadFindingFor(findingId, login, deps);
  if (!loaded) {
    return fail("Finding not found.");
  }
  const problem = editableProblem(loaded.detail);
  if (problem) {
    return fail(problem);
  }
  await editFinding(deps.db, findingId, edit.data, login);
  return { ok: true };
}

function publishProblem(detail: ReviewDetail): string | null {
  const problem = editableProblem(detail);
  if (problem) {
    return problem;
  }
  if (detail.review.status !== "completed" && detail.review.status !== "too_large") {
    return "This review did not finish, so there is nothing to publish.";
  }
  if (detail.review.headSha !== detail.pullRequest.headSha) {
    return "A newer commit was pushed. This review is out of date.";
  }
  const pending = detail.findings.filter((finding) => finding.status === "pending").length;
  if (pending > 0) {
    // Publishing with undecided findings would silently drop them.
    return `Confirm or reject every finding first (${pending} still pending).`;
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
): Promise<ActionResult> {
  const loaded = await loadReviewFor(reviewId, login, deps);
  if (!loaded) {
    return fail(NOT_FOUND);
  }
  const { detail, github } = loaded;
  const problem = publishProblem(detail);
  if (problem) {
    return fail(problem);
  }
  const { review, repository, pullRequest } = detail;
  if (review.summary === null || review.headSha === null) {
    return fail("This review has no summary to publish.");
  }

  const note = reviewerNote?.trim() ? reviewerNote.trim().slice(0, 2_000) : null;
  const claimed = await claimReviewForPublish(deps.db, reviewId, { publishedBy: login, reviewerNote: note });
  if (!claimed) {
    return fail("This review is already published.");
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
    });
    const githubReviewId = await github.createReview(repository, pullRequest.number, payload);
    await recordGithubReviewId(deps.db, reviewId, githubReviewId);
  } catch (error) {
    await releasePublishClaim(deps.db, reviewId);
    logEvent("publish_failed", { reviewId, error: safeErrorCode(error) });
    return fail("GitHub did not accept the review. Nothing was published. Try again.");
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
        }),
      );
    } catch (error) {
      // The review is already on the PR. A stale check is the lesser problem.
      logEvent("check_run_update_failed", { reviewId, error: safeErrorCode(error) });
    }
  }

  logEvent("review_published", { reviewId, confirmed: confirmed.length });
  return { ok: true };
}
