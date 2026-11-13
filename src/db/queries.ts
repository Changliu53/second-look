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
  findingEvents,
  findings,
  pullRequests,
  rateLimits,
  repositories,
  reviews,
  type Finding,
  type FindingEvent,
  type FollowUpEntry,
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
    baseRef?: string;
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
        ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
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
  input: { pullRequestId: number; headSha: string; baseSha?: string },
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
  followUp: FollowUpEntry[] = [],
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
      followUp: followUp.length > 0 ? followUp : null,
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

export type EarlierDecisions = {
  headSha: string | null;
  confirmed: Finding[];
  rejected: Finding[];
};

/**
 * The reviewer's decisions from earlier published reviews of this pull
 * request at other commits, or null if there are none.
 *
 * - `confirmed` comes from the most recent of those reviews: it is the list
 *   the author was last asked to fix, so it is what the new review verifies.
 * - `rejected` comes from all of them. A finding the reviewer turned down in
 *   round one must stay turned down in round three, even though round two
 *   never raised it and so has no record of it.
 */
export async function getEarlierDecisions(
  db: Database,
  pullRequestId: number,
  currentHeadSha: string,
): Promise<EarlierDecisions | null> {
  const published = await db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.pullRequestId, pullRequestId),
        isNotNull(reviews.publishedAt),
        ne(reviews.headSha, currentHeadSha),
      ),
    )
    .orderBy(desc(reviews.publishedAt));
  const latest = published[0];
  if (!latest) {
    return null;
  }

  const decided = await db
    .select()
    .from(findings)
    .where(
      inArray(
        findings.reviewId,
        published.map((review) => review.id),
      ),
    )
    .orderBy(findings.id);

  return {
    headSha: latest.headSha,
    confirmed: decided.filter(
      (finding) => finding.reviewId === latest.id && finding.status === "confirmed",
    ),
    rejected: uniqueByText(decided.filter((finding) => finding.status === "rejected")),
  };
}

/** Drops repeats of the same finding on the same file, keeping the first. */
function uniqueByText(list: Finding[]): Finding[] {
  const seen = new Set<string>();
  return list.filter((finding) => {
    const key = `${finding.filePath}\n${finding.explanation}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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
  /** The last change any reviewer made to a finding here. Set for open reviews. */
  lastActivity?: { actor: string; at: Date };
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

/** The newest review of a pull request: the one for its latest commit. */
export async function latestReviewId(db: Database, pullRequestId: number): Promise<number | null> {
  const rows = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(eq(reviews.pullRequestId, pullRequestId))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(1);
  return rows[0]?.id ?? null;
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

/**
 * Recently reviewed pull requests, newest first: one row per pull request,
 * showing its latest published review. A pull request that went through
 * three rounds is one line, not three.
 */
export async function listPublishedReviews(
  db: Database,
  limit: number,
): Promise<ReviewListItem[]> {
  if (limit <= 0) {
    return [];
  }
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
      // Keep a review only if it is the newest published one of its pull
      // request. Done in SQL so the database returns at most `limit` rows,
      // however many pull requests have been reviewed. Compared by id, with
      // the id as tie-break, so two rounds published in the same millisecond
      // still give one row.
      sql`${reviews.id} = (
        select newer.id
        from reviews newer
        where newer.pull_request_id = ${reviews.pullRequestId}
          and newer.published_at is not null
        order by newer.published_at desc, newer.id desc
        limit 1
      )`,
    )
    .orderBy(desc(reviews.publishedAt))
    .limit(limit);
  return withFindingCounts(db, rows);
}

/** One published review in the history of a pull request. */
export type ReviewRound = {
  reviewId: number;
  headSha: string | null;
  publishedAt: Date;
  publishedBy: string | null;
  resolution: Review["resolution"];
  confirmedCount: number;
  confirmedCriticalCount: number;
};

/** Every published review of a pull request, oldest first. */
export async function listReviewRounds(
  db: Database,
  pullRequestId: number,
): Promise<ReviewRound[]> {
  const published = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.pullRequestId, pullRequestId), isNotNull(reviews.publishedAt)))
    .orderBy(reviews.publishedAt);
  if (published.length === 0) {
    return [];
  }

  const confirmed = await db
    .select({ reviewId: findings.reviewId, severity: findings.severity })
    .from(findings)
    .where(
      and(
        inArray(
          findings.reviewId,
          published.map((review) => review.id),
        ),
        eq(findings.status, "confirmed"),
      ),
    );

  return published.map((review) => {
    const own = confirmed.filter((finding) => finding.reviewId === review.id);
    return {
      reviewId: review.id,
      headSha: review.headSha,
      // The query only returns published reviews, so this is never null.
      publishedAt: review.publishedAt ?? review.createdAt,
      publishedBy: review.publishedBy,
      resolution: review.resolution,
      confirmedCount: own.length,
      confirmedCriticalCount: own.filter((finding) => finding.severity === "critical").length,
    };
  });
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
 * A published review of one pull request, for the public example page.
 * `round` counts published reviews from 1 (the first); without it the latest
 * is returned. Only published reviews can be reached this way: nothing a
 * reviewer has not already released to the pull request is shown.
 */
export async function getPublishedReview(
  db: Database,
  pull: { owner: string; name: string; number: number },
  round?: number,
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
    .orderBy(reviews.publishedAt);

  const row = round === undefined ? rows.at(-1) : rows[round - 1];
  return row ? getReviewDetail(db, row.id) : null;
}

export async function getFinding(
  db: Database,
  findingId: number,
): Promise<Finding | null> {
  const rows = await db.select().from(findings).where(eq(findings.id, findingId));
  return rows[0] ?? null;
}

type FindingEventInput = {
  reviewId: number;
  findingId: number;
  actor: string;
  action: FindingEvent["action"];
  detail?: string | null;
};

/**
 * Appends to a finding's history. Written after the change it records, as
 * a separate statement: the Neon HTTP driver has no transactions. If this
 * write fails the change stands without its record, which is the safer way
 * round for a reviewer in the middle of a review.
 */
async function recordFindingEvent(db: Database, event: FindingEventInput): Promise<void> {
  await db.insert(findingEvents).values({ ...event, detail: event.detail ?? null });
}

/** Who last changed a finding on each of these reviews, and when. */
export async function latestActivity(
  db: Database,
  reviewIds: number[],
): Promise<Map<number, { actor: string; at: Date }>> {
  if (reviewIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectDistinctOn([findingEvents.reviewId], {
      reviewId: findingEvents.reviewId,
      actor: findingEvents.actor,
      at: findingEvents.createdAt,
    })
    .from(findingEvents)
    .where(inArray(findingEvents.reviewId, reviewIds))
    .orderBy(findingEvents.reviewId, desc(findingEvents.createdAt), desc(findingEvents.id));
  return new Map(rows.map((row) => [row.reviewId, { actor: row.actor, at: row.at }]));
}

/** A review's finding history, oldest first. */
export async function listFindingEvents(db: Database, reviewId: number): Promise<FindingEvent[]> {
  return db
    .select()
    .from(findingEvents)
    .where(eq(findingEvents.reviewId, reviewId))
    .orderBy(findingEvents.createdAt, findingEvents.id);
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
  const rejectionReason = decision.status === "rejected" ? decision.rejectionReason : null;
  const updated = await db
    .update(findings)
    .set({
      status: decision.status,
      rejectionReason,
      // Moving back to pending clears who decided: nobody has, any more.
      decidedBy: isPending ? null : decidedBy,
      decidedAt: isPending ? null : new Date(),
    })
    .where(eq(findings.id, findingId))
    .returning({ reviewId: findings.reviewId });
  const row = updated[0];
  if (row) {
    await recordFindingEvent(db, {
      reviewId: row.reviewId,
      findingId,
      actor: decidedBy,
      action: isPending ? "reset" : decision.status,
      detail: rejectionReason,
    });
  }
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
  const updated = await db
    .update(findings)
    .set({
      editedExplanation: edit.explanation,
      editedSuggestedFix: edit.suggestedFix,
      status: "confirmed",
      rejectionReason: null,
      decidedBy,
      decidedAt: new Date(),
    })
    .where(eq(findings.id, findingId))
    .returning({ reviewId: findings.reviewId });
  const row = updated[0];
  if (row) {
    await recordFindingEvent(db, { reviewId: row.reviewId, findingId, actor: decidedBy, action: "edited" });
  }
}

export type HumanFindingInput = {
  filePath: string;
  startLine: number;
  endLine: number;
  severity: Finding["severity"];
  category: Finding["category"];
  explanation: string;
  suggestedFix: string | null;
};

/**
 * Stores a finding the reviewer wrote themselves. It starts out confirmed:
 * nobody needs to approve their own finding, and it should be published
 * unless they remove it.
 */
export async function addHumanFinding(
  db: Database,
  reviewId: number,
  input: HumanFindingInput,
  addedBy: string,
): Promise<Finding> {
  const rows = await db
    .insert(findings)
    .values({
      reviewId,
      source: "human",
      ...input,
      // The reviewer is sure, or they would not have written it.
      confidence: 1,
      status: "confirmed",
      decidedBy: addedBy,
      decidedAt: new Date(),
    })
    .returning();
  const added = firstRow(rows, "human finding insert");
  await recordFindingEvent(db, { reviewId, findingId: added.id, actor: addedBy, action: "added" });
  return added;
}

/** Rewrites a finding the reviewer added. There is no AI original to keep. */
export async function updateHumanFinding(
  db: Database,
  findingId: number,
  edit: { explanation: string; suggestedFix: string | null },
  editedBy: string,
): Promise<void> {
  const updated = await db
    .update(findings)
    .set(edit)
    .where(and(eq(findings.id, findingId), eq(findings.source, "human")))
    .returning({ reviewId: findings.reviewId });
  const row = updated[0];
  if (row) {
    await recordFindingEvent(db, { reviewId: row.reviewId, findingId, actor: editedBy, action: "edited" });
  }
}

/**
 * Deletes a finding the reviewer added. Only human findings can be deleted:
 * an AI finding is rejected instead, so the decision stays on record.
 */
export async function removeHumanFinding(
  db: Database,
  findingId: number,
  removedBy: string,
): Promise<void> {
  const deleted = await db
    .delete(findings)
    .where(and(eq(findings.id, findingId), eq(findings.source, "human")))
    .returning({ reviewId: findings.reviewId });
  const row = deleted[0];
  if (row) {
    await recordFindingEvent(db, { reviewId: row.reviewId, findingId, actor: removedBy, action: "removed" });
  }
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
  input: {
    publishedBy: string;
    reviewerNote: string | null;
    resolution: Review["resolution"];
  },
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
    .set({ publishedAt: null, publishedBy: null, reviewerNote: null, resolution: null })
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

/** Every repository the app has seen a pull request on. */
export async function listRepositories(db: Database): Promise<Repository[]> {
  return db.select().from(repositories).orderBy(repositories.owner, repositories.name);
}

/**
 * Decided findings of published reviews in the given repositories, for the
 * insights page. Unpublished reviews are left out: a decision can still
 * change until the review is published.
 */
export async function listPublishedFindings(db: Database, repositoryIds: number[]) {
  if (repositoryIds.length === 0) {
    return [];
  }
  return db
    .select({
      source: findings.source,
      status: findings.status,
      severity: findings.severity,
      category: findings.category,
      editedExplanation: findings.editedExplanation,
      rejectionReason: findings.rejectionReason,
    })
    .from(findings)
    .innerJoin(reviews, eq(findings.reviewId, reviews.id))
    .innerJoin(pullRequests, eq(reviews.pullRequestId, pullRequests.id))
    .where(
      and(
        isNotNull(reviews.publishedAt),
        ne(findings.status, "pending"),
        inArray(pullRequests.repositoryId, repositoryIds),
      ),
    );
}

/** How many reviews have been published in the given repositories, and their follow-up verdicts. */
export async function listPublishedFollowUps(db: Database, repositoryIds: number[]) {
  if (repositoryIds.length === 0) {
    return [];
  }
  return db
    .select({
      followUp: reviews.followUp,
      completedAt: reviews.completedAt,
      publishedAt: reviews.publishedAt,
    })
    .from(reviews)
    .innerJoin(pullRequests, eq(reviews.pullRequestId, pullRequests.id))
    .where(and(isNotNull(reviews.publishedAt), inArray(pullRequests.repositoryId, repositoryIds)));
}

