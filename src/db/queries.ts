import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import type { ReviewResult } from "@/review/engine";
import type { Database } from "./client";
import {
  findings,
  pullRequests,
  rateLimits,
  repositories,
  reviews,
  type Finding,
  type PullRequest,
  type Repository,
  type Review,
  type ReviewStage,
} from "./schema";

/**
 * All database access goes through the functions in this file. Each takes the
 * database handle as its first argument so tests can pass an in-process
 * Postgres instead of Neon.
 *
 * The Neon HTTP driver has no interactive transactions. Multi-step writes are
 * therefore ordered so that a crash between steps leaves a state the next
 * attempt can recover from (see completeReview).
 */

/** A review still "running" after this long is assumed to have crashed. */
export const STALE_REVIEW_MS = 10 * 60 * 1000;

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`Expected a row for ${what}, got none`);
  }
  return row;
}

export async function upsertRepository(
  db: Database,
  input: {
    githubRepoId: number;
    installationId: number;
    owner: string;
    name: string;
  },
): Promise<Repository> {
  const rows = await db
    .insert(repositories)
    .values(input)
    .onConflictDoUpdate({
      target: repositories.githubRepoId,
      // Repos can be renamed or the app reinstalled; keep the latest values.
      set: {
        installationId: input.installationId,
        owner: input.owner,
        name: input.name,
      },
    })
    .returning();
  return firstRow(rows, "repository upsert");
}

export async function upsertPullRequest(
  db: Database,
  input: {
    repositoryId: number;
    number: number;
    title: string;
    authorLogin: string;
    headSha: string;
  },
): Promise<PullRequest> {
  const rows = await db
    .insert(pullRequests)
    .values(input)
    .onConflictDoUpdate({
      target: [pullRequests.repositoryId, pullRequests.number],
      set: {
        title: input.title,
        headSha: input.headSha,
        // Any event that reaches this point means the PR is open (again).
        closedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return firstRow(rows, "pull request upsert");
}

/** Records that a PR was closed or merged, which hides it from the dashboard. */
export async function markPullRequestClosed(
  db: Database,
  input: { githubRepoId: number; number: number },
  now: Date = new Date(),
): Promise<void> {
  const repoRows = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.githubRepoId, input.githubRepoId));
  const repository = repoRows[0];
  if (!repository) {
    return;
  }
  await db
    .update(pullRequests)
    .set({ closedAt: now, updatedAt: now })
    .where(
      and(
        eq(pullRequests.repositoryId, repository.id),
        eq(pullRequests.number, input.number),
      ),
    );
}

/** True when a review has been "running" for longer than a review can take. */
export function isStaleRunning(review: Review, now: Date = new Date()): boolean {
  const age = now.getTime() - review.createdAt.getTime();
  return review.status === "running" && age > STALE_REVIEW_MS;
}

function isRetryable(review: Review, now: Date): boolean {
  return review.status === "failed" || isStaleRunning(review, now);
}

/**
 * Claims the review for one commit of a PR.
 *
 * Returns `shouldRun: false` when a review for this commit already exists and
 * is running or finished, which makes webhook redelivery harmless. A failed or
 * crashed review is reset and may run again (close and reopen the PR to retry).
 */
export async function startGithubReview(
  db: Database,
  input: { pullRequestId: number; headSha: string },
  now: Date = new Date(),
): Promise<{ review: Review; shouldRun: boolean }> {
  const inserted = await db
    .insert(reviews)
    .values({ source: "github", status: "running", createdAt: now, ...input })
    .onConflictDoNothing()
    .returning();

  const created = inserted[0];
  if (created) {
    await supersedeOlderReviews(db, input.pullRequestId, created.id);
    return { review: created, shouldRun: true };
  }

  const existing = firstRow(
    await db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.pullRequestId, input.pullRequestId),
          eq(reviews.headSha, input.headSha),
        ),
      ),
    "existing review",
  );

  if (!isRetryable(existing, now)) {
    return { review: existing, shouldRun: false };
  }

  // Findings from the crashed attempt would otherwise be duplicated.
  await db.delete(findings).where(eq(findings.reviewId, existing.id));
  const reset = await db
    .update(reviews)
    .set({ status: "running", stage: null, errorMessage: null, createdAt: now })
    .where(eq(reviews.id, existing.id))
    .returning();
  await supersedeOlderReviews(db, input.pullRequestId, existing.id);
  return { review: firstRow(reset, "review reset"), shouldRun: true };
}

/**
 * Marks unpublished reviews of older commits as superseded. Published reviews
 * are left alone: they are a record of what the author was told.
 */
async function supersedeOlderReviews(
  db: Database,
  pullRequestId: number,
  currentReviewId: number,
): Promise<void> {
  await db
    .update(reviews)
    .set({ status: "superseded" })
    .where(
      and(
        eq(reviews.pullRequestId, pullRequestId),
        ne(reviews.id, currentReviewId),
        isNull(reviews.publishedAt),
        ne(reviews.status, "superseded"),
      ),
    );
}

/**
 * Records what a running review is doing, for the live view in the dashboard.
 * A no-op once the review has finished or been superseded.
 */
export async function setReviewStage(
  db: Database,
  reviewId: number,
  stage: ReviewStage,
): Promise<void> {
  await db
    .update(reviews)
    .set({ stage })
    .where(and(eq(reviews.id, reviewId), eq(reviews.status, "running")));
}

export async function setCheckRunId(
  db: Database,
  reviewId: number,
  checkRunId: number,
): Promise<void> {
  await db.update(reviews).set({ checkRunId }).where(eq(reviews.id, reviewId));
}

/**
 * Stores the result of a finished review. Findings are written first and the
 * status is flipped last, so a review marked "completed" always has all of its
 * findings. If we crash in between, the review stays "running", goes stale,
 * and startGithubReview clears the partial findings before retrying.
 *
 * Returns false when the review was superseded in the meantime.
 */
export async function completeReview(
  db: Database,
  reviewId: number,
  result: ReviewResult,
): Promise<boolean> {
  if (result.findings.length > 0) {
    await db.insert(findings).values(
      result.findings.map((finding) => ({
        reviewId,
        filePath: finding.file,
        startLine: finding.startLine,
        endLine: finding.endLine,
        severity: finding.severity,
        category: finding.category,
        explanation: finding.explanation,
        suggestedFix: finding.suggestedFix,
        confidence: finding.confidence,
      })),
    );
  }
  // Only a review that is still "running" may be completed. If a newer commit
  // superseded it while the model was working, its status must stay
  // "superseded"; otherwise the outdated review would reappear as open.
  const updated = await db
    .update(reviews)
    .set({
      status: result.status,
      summary: result.summary,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      completedAt: new Date(),
    })
    .where(and(eq(reviews.id, reviewId), eq(reviews.status, "running")))
    .returning({ id: reviews.id });
  return updated.length === 1;
}

export async function failReview(
  db: Database,
  reviewId: number,
  errorMessage: string,
): Promise<boolean> {
  const updated = await db
    .update(reviews)
    .set({ status: "failed", errorMessage, completedAt: new Date() })
    .where(and(eq(reviews.id, reviewId), eq(reviews.status, "running")))
    .returning({ id: reviews.id });
  return updated.length === 1;
}

/** Logs a paste-mode review. Only token usage is kept, never the pasted code. */
export async function recordPasteReview(
  db: Database,
  result: ReviewResult,
): Promise<void> {
  await db.insert(reviews).values({
    source: "paste",
    status: result.status,
    model: result.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    completedAt: new Date(),
  });
}

export async function countPasteReviewsSince(
  db: Database,
  since: Date,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reviews)
    .where(and(eq(reviews.source, "paste"), gte(reviews.createdAt, since)));
  return rows[0]?.count ?? 0;
}

export type ReviewListItem = {
  review: Review;
  pullRequest: PullRequest;
  repository: Repository;
  pendingCount: number;
  confirmedCount: number;
  /** Confirmed plus rejected. */
  decidedCount: number;
};

type ReviewRow = Pick<ReviewListItem, "review" | "pullRequest" | "repository">;

/** Adds per-status finding counts to a list of reviews with one extra query. */
async function withFindingCounts(
  db: Database,
  rows: ReviewRow[],
): Promise<ReviewListItem[]> {
  if (rows.length === 0) {
    return [];
  }
  const counts = await db
    .select({
      reviewId: findings.reviewId,
      status: findings.status,
      count: sql<number>`count(*)::int`,
    })
    .from(findings)
    .where(
      inArray(
        findings.reviewId,
        rows.map((row) => row.review.id),
      ),
    )
    .groupBy(findings.reviewId, findings.status);

  const countFor = (reviewId: number, status: Finding["status"]) =>
    counts.find((c) => c.reviewId === reviewId && c.status === status)?.count ??
    0;

  return rows.map((row) => {
    const confirmedCount = countFor(row.review.id, "confirmed");
    return {
      ...row,
      pendingCount: countFor(row.review.id, "pending"),
      confirmedCount,
      decidedCount: confirmedCount + countFor(row.review.id, "rejected"),
    };
  });
}

/** Reviews a human still has to act on: open PR, not published, not superseded. */
export async function listOpenReviews(db: Database): Promise<ReviewListItem[]> {
  const rows = await db
    .select({
      review: reviews,
      pullRequest: pullRequests,
      repository: repositories,
    })
    .from(reviews)
    .innerJoin(pullRequests, eq(reviews.pullRequestId, pullRequests.id))
    .innerJoin(repositories, eq(pullRequests.repositoryId, repositories.id))
    .where(
      and(
        isNull(reviews.publishedAt),
        ne(reviews.status, "superseded"),
        isNull(pullRequests.closedAt),
      ),
    )
    .orderBy(desc(reviews.createdAt));
  return withFindingCounts(db, rows);
}

/** The most recently published reviews, newest first. */
export async function listPublishedReviews(
  db: Database,
  limit: number,
): Promise<ReviewListItem[]> {
  const rows = await db
    .select({
      review: reviews,
      pullRequest: pullRequests,
      repository: repositories,
    })
    .from(reviews)
    .innerJoin(pullRequests, eq(reviews.pullRequestId, pullRequests.id))
    .innerJoin(repositories, eq(pullRequests.repositoryId, repositories.id))
    .where(isNotNull(reviews.publishedAt))
    .orderBy(desc(reviews.publishedAt))
    .limit(limit);
  return withFindingCounts(db, rows);
}

export type ReviewDetail = {
  review: Review;
  pullRequest: PullRequest;
  repository: Repository;
  findings: Finding[];
};

export async function getReviewDetail(
  db: Database,
  reviewId: number,
): Promise<ReviewDetail | null> {
  const rows = await db
    .select({
      review: reviews,
      pullRequest: pullRequests,
      repository: repositories,
    })
    .from(reviews)
    .innerJoin(pullRequests, eq(reviews.pullRequestId, pullRequests.id))
    .innerJoin(repositories, eq(pullRequests.repositoryId, repositories.id))
    .where(eq(reviews.id, reviewId));

  const row = rows[0];
  if (!row) {
    return null;
  }

  const reviewFindings = await db
    .select()
    .from(findings)
    .where(eq(findings.reviewId, reviewId))
    .orderBy(findings.filePath, findings.startLine, findings.id);

  return { ...row, findings: reviewFindings };
}

/**
 * The most recently published review of one pull request, for the public
 * demo page. Only published reviews are returned: nothing a reviewer has not
 * already released to the PR can be shown this way.
 */
export async function getLatestPublishedReview(
  db: Database,
  pull: { owner: string; name: string; number: number },
): Promise<ReviewDetail | null> {
  const rows = await db
    .select({ id: reviews.id })
    .from(reviews)
    .innerJoin(pullRequests, eq(reviews.pullRequestId, pullRequests.id))
    .innerJoin(repositories, eq(pullRequests.repositoryId, repositories.id))
    .where(
      and(
        eq(repositories.owner, pull.owner),
        eq(repositories.name, pull.name),
        eq(pullRequests.number, pull.number),
        isNotNull(reviews.publishedAt),
      ),
    )
    .orderBy(desc(reviews.publishedAt))
    .limit(1);

  const row = rows[0];
  return row ? getReviewDetail(db, row.id) : null;
}

export async function getFinding(
  db: Database,
  findingId: number,
): Promise<Finding | null> {
  const rows = await db.select().from(findings).where(eq(findings.id, findingId));
  return rows[0] ?? null;
}

export type FindingDecision =
  | { status: "confirmed" }
  | { status: "rejected"; rejectionReason: string | null }
  | { status: "pending" };

export async function decideFinding(
  db: Database,
  findingId: number,
  decision: FindingDecision,
  decidedBy: string,
): Promise<void> {
  const isPending = decision.status === "pending";
  await db
    .update(findings)
    .set({
      status: decision.status,
      rejectionReason:
        decision.status === "rejected" ? decision.rejectionReason : null,
      // Moving back to pending clears who decided: nobody has, any more.
      decidedBy: isPending ? null : decidedBy,
      decidedAt: isPending ? null : new Date(),
    })
    .where(eq(findings.id, findingId));
}

/**
 * Saves the reviewer's rewrite. The model's original text stays in
 * `explanation` and `suggestedFix`; an edit also confirms the finding, because
 * rewriting a finding you intend to reject makes no sense.
 */
export async function editFinding(
  db: Database,
  findingId: number,
  edit: { explanation: string; suggestedFix: string | null },
  decidedBy: string,
): Promise<void> {
  await db
    .update(findings)
    .set({
      editedExplanation: edit.explanation,
      editedSuggestedFix: edit.suggestedFix,
      status: "confirmed",
      rejectionReason: null,
      decidedBy,
      decidedAt: new Date(),
    })
    .where(eq(findings.id, findingId));
}

/**
 * Claims a review for publishing. Returns false if someone already did.
 *
 * The claim is one conditional UPDATE, so two reviewers clicking "Publish" at
 * the same moment cannot both post a review to GitHub. If posting then fails,
 * the caller releases the claim with releasePublishClaim.
 */
export async function claimReviewForPublish(
  db: Database,
  reviewId: number,
  input: { publishedBy: string; reviewerNote: string | null },
): Promise<boolean> {
  const rows = await db
    .update(reviews)
    .set({ ...input, publishedAt: new Date() })
    .where(and(eq(reviews.id, reviewId), isNull(reviews.publishedAt)))
    .returning({ id: reviews.id });
  return rows.length === 1;
}

export async function releasePublishClaim(
  db: Database,
  reviewId: number,
): Promise<void> {
  await db
    .update(reviews)
    .set({ publishedAt: null, publishedBy: null, reviewerNote: null })
    .where(eq(reviews.id, reviewId));
}

export async function recordGithubReviewId(
  db: Database,
  reviewId: number,
  githubReviewId: number,
): Promise<void> {
  await db
    .update(reviews)
    .set({ githubReviewId })
    .where(eq(reviews.id, reviewId));
}

/**
 * Counts one request against a rate-limit window and returns the new count.
 * A single upsert statement, so two concurrent requests cannot both read the
 * same old count.
 */
export async function incrementRateLimit(
  db: Database,
  key: string,
  windowStart: Date,
): Promise<number> {
  const rows = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  return firstRow(rows, "rate limit upsert").count;
}
