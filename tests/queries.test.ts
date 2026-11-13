import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import {
  addHumanFinding,
  completeReview,
  countPasteReviewsSince,
  decideFinding,
  editFinding,
  failReview,
  getEarlierDecisions,
  getReviewDetail,
  incrementRateLimit,
  latestActivity,
  listFindingEvents,
  listOpenReviews,
  listPublishedReviews,
  markPullRequestClosed,
  removeHumanFinding,
  renamePullRequest,
  updateHumanFinding,
  claimReviewForPublish,
  releasePublishClaim,
  recordPasteReview,
  STALE_REVIEW_MS,
  startGithubReview,
  upsertPullRequest,
  upsertRepository,
} from "@/db/queries";
import { findings, rateLimits, reviews } from "@/db/schema";
import type { ReviewResult } from "@/review/engine";
import { consumeHourlyLimit, hashClientIp, hourWindowStart } from "@/lib/rate-limit";
import { createTestDb, seedPullRequest } from "./helpers/test-db";

function completedResult(findingCount: number): ReviewResult {
  return {
    status: "completed",
    summary: { whatChanged: "Adds checkout.", riskLevel: "medium", doubleCheck: [] },
    findings: Array.from({ length: findingCount }, (_, i) => ({
      file: "src/checkout.ts",
      startLine: 10 + i,
      endLine: 10 + i,
      severity: i === 0 ? ("critical" as const) : ("warning" as const),
      category: "bug" as const,
      explanation: `Problem ${i}`,
      suggestedFix: null,
      confidence: 0.9,
    })),
    followUp: [],
    skippedFiles: [],
    usage: { inputTokens: 1200, outputTokens: 300 },
    model: "test-model",
  };
}

let db: Database;

beforeEach(async () => {
  db = await createTestDb();
});

describe("upserts", () => {
  it("updates a repository in place when the app is reinstalled", async () => {
    const first = await upsertRepository(db, {
      githubRepoId: 5, installationId: 1, owner: "acme", name: "old-name",
    });
    const second = await upsertRepository(db, {
      githubRepoId: 5, installationId: 2, owner: "acme", name: "new-name",
    });

    expect(second.id).toBe(first.id);
    expect(second.installationId).toBe(2);
    expect(second.name).toBe("new-name");
  });

  it("moves a pull request to its new head commit", async () => {
    const { repository, pullRequest } = await seedPullRequest(db);
    const updated = await upsertPullRequest(db, {
      repositoryId: repository.id, number: 7, title: "Add checkout v2",
      authorLogin: "sam", headSha: "sha-2",
    });

    expect(updated.id).toBe(pullRequest.id);
    expect(updated.headSha).toBe("sha-2");
  });
});

describe("startGithubReview", () => {
  it("runs once per commit, so a redelivered webhook is a no-op", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const input = { pullRequestId: pullRequest.id, headSha: "sha-1" };

    const first = await startGithubReview(db, input);
    const second = await startGithubReview(db, input);

    expect(first.shouldRun).toBe(true);
    expect(second.shouldRun).toBe(false);
    expect(second.review.id).toBe(first.review.id);
  });

  it("supersedes the unpublished review of an older commit", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const old = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    await completeReview(db, old.review.id, completedResult(1));

    await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-2" });

    const [oldRow] = await db.select().from(reviews).where(eq(reviews.id, old.review.id));
    expect(oldRow?.status).toBe("superseded");
  });

  it("keeps a published review of an older commit as it was", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const old = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    await completeReview(db, old.review.id, completedResult(0));
    await claimReviewForPublish(db, old.review.id, { publishedBy: "lee", reviewerNote: null, resolution: "author_fixes" });

    await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-2" });

    const [oldRow] = await db.select().from(reviews).where(eq(reviews.id, old.review.id));
    expect(oldRow?.status).toBe("completed");
  });

  it("lets a failed review run again", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const input = { pullRequestId: pullRequest.id, headSha: "sha-1" };
    const first = await startGithubReview(db, input);
    await failReview(db, first.review.id, "model_request_failed");

    const retry = await startGithubReview(db, input);

    expect(retry.shouldRun).toBe(true);
    expect(retry.review.status).toBe("running");
    expect(retry.review.errorMessage).toBeNull();
  });

  it("retries a review stuck in 'running' only after it goes stale", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const input = { pullRequestId: pullRequest.id, headSha: "sha-1" };
    const startedAt = new Date("2026-01-01T00:00:00Z");
    await startGithubReview(db, input, startedAt);

    const soon = new Date(startedAt.getTime() + STALE_REVIEW_MS - 1000);
    const later = new Date(startedAt.getTime() + STALE_REVIEW_MS + 1000);

    expect((await startGithubReview(db, input, soon)).shouldRun).toBe(false);
    expect((await startGithubReview(db, input, later)).shouldRun).toBe(true);
  });

  it("clears findings left behind by a crashed attempt before retrying", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const input = { pullRequestId: pullRequest.id, headSha: "sha-1" };
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const first = await startGithubReview(db, input, startedAt);
    // The crash: findings were written, but the status never left "running".
    await db.insert(findings).values({
      reviewId: first.review.id, filePath: "src/checkout.ts", startLine: 1, endLine: 1,
      severity: "warning", category: "bug", explanation: "left over", confidence: 0.5,
    });

    const later = new Date(startedAt.getTime() + STALE_REVIEW_MS + 1000);
    const retry = await startGithubReview(db, input, later);
    await completeReview(db, retry.review.id, completedResult(2));

    const detail = await getReviewDetail(db, retry.review.id);
    expect(detail?.findings.map((f) => f.explanation)).toEqual(["Problem 0", "Problem 1"]);
  });
});

describe("superseded and closed", () => {
  it("does not let a superseded review come back to life when it finishes late", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const old = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    // A newer commit arrives while the first review is still running.
    await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-2" });

    const stillCurrent = await completeReview(db, old.review.id, completedResult(2));

    expect(stillCurrent).toBe(false);
    const detail = await getReviewDetail(db, old.review.id);
    expect(detail?.review.status).toBe("superseded");
    expect((await listOpenReviews(db)).map((r) => r.review.headSha)).toEqual(["sha-2"]);
  });

  it("does not mark a superseded review as failed either", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const old = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-2" });

    expect(await failReview(db, old.review.id, "model_request_failed")).toBe(false);
    expect((await getReviewDetail(db, old.review.id))?.review.status).toBe("superseded");
  });

  it("hides the review of a closed pull request and shows it again on reopen", async () => {
    const { repository, pullRequest } = await seedPullRequest(db);
    const { review } = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    await completeReview(db, review.id, completedResult(1));

    await markPullRequestClosed(db, { githubRepoId: repository.githubRepoId, number: 7 });
    expect(await listOpenReviews(db)).toEqual([]);

    // Reopening sends a webhook, which upserts the pull request.
    await upsertPullRequest(db, {
      repositoryId: repository.id, number: 7, title: "Add checkout", authorLogin: "sam", headSha: "sha-1",
    });
    expect(await listOpenReviews(db)).toHaveLength(1);
  });

  it("ignores a close event for a repository it has never seen", async () => {
    await expect(markPullRequestClosed(db, { githubRepoId: 424242, number: 1 })).resolves.toBeUndefined();
  });
});

describe("review lifecycle", () => {
  it("stores findings as pending along with summary and token usage", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const { review } = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });

    await completeReview(db, review.id, completedResult(2));
    const detail = await getReviewDetail(db, review.id);

    expect(detail?.review.status).toBe("completed");
    expect(detail?.review.inputTokens).toBe(1200);
    expect(detail?.review.outputTokens).toBe(300);
    expect(detail?.review.summary?.riskLevel).toBe("medium");
    expect(detail?.findings.map((f) => f.status)).toEqual(["pending", "pending"]);
    expect(detail?.findings.map((f) => f.source)).toEqual(["ai", "ai"]);
  });

  it("records who decided a finding and keeps the rejection reason", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const { review } = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    await completeReview(db, review.id, completedResult(2));
    const [first, second] = (await getReviewDetail(db, review.id))!.findings;

    await decideFinding(db, first!.id, { status: "confirmed" }, "lee");
    await decideFinding(db, second!.id, { status: "rejected", rejectionReason: "Guarded upstream" }, "lee");
    const after = (await getReviewDetail(db, review.id))!.findings;

    expect(after[0]).toMatchObject({ status: "confirmed", decidedBy: "lee", rejectionReason: null });
    expect(after[1]).toMatchObject({ status: "rejected", rejectionReason: "Guarded upstream" });
    expect(after[0]?.decidedAt).toBeInstanceOf(Date);
  });

  it("clears the decision when a finding is moved back to pending", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const { review } = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    await completeReview(db, review.id, completedResult(1));
    const [finding] = (await getReviewDetail(db, review.id))!.findings;
    await decideFinding(db, finding!.id, { status: "rejected", rejectionReason: "no" }, "lee");

    await decideFinding(db, finding!.id, { status: "pending" }, "lee");
    const [after] = (await getReviewDetail(db, review.id))!.findings;

    expect(after).toMatchObject({ status: "pending", decidedBy: null, rejectionReason: null, decidedAt: null });
  });

  it("keeps the model's original text when a reviewer edits a finding", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const { review } = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    await completeReview(db, review.id, completedResult(1));
    const [finding] = (await getReviewDetail(db, review.id))!.findings;

    await editFinding(db, finding!.id, { explanation: "Clearer wording", suggestedFix: "Do X" }, "lee");
    const [after] = (await getReviewDetail(db, review.id))!.findings;

    expect(after).toMatchObject({
      explanation: "Problem 0",
      editedExplanation: "Clearer wording",
      editedSuggestedFix: "Do X",
      status: "confirmed",
    });
  });

  it("lists open reviews with pending and confirmed counts, hiding published ones", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const { review } = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    await completeReview(db, review.id, completedResult(3));
    const [first] = (await getReviewDetail(db, review.id))!.findings;
    await decideFinding(db, first!.id, { status: "confirmed" }, "lee");

    const open = await listOpenReviews(db);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ pendingCount: 2, confirmedCount: 1 });
    expect(open[0]?.repository.name).toBe("shop");

    await claimReviewForPublish(db, review.id, { publishedBy: "lee", reviewerNote: "LGTM after fixes", resolution: "author_fixes" });
    expect(await listOpenReviews(db)).toEqual([]);
  });

  it("lists published reviews newest first with how many findings were sent", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const { review } = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    await completeReview(db, review.id, completedResult(3));
    const [first, second] = (await getReviewDetail(db, review.id))!.findings;
    await decideFinding(db, first!.id, { status: "confirmed" }, "lee");
    await decideFinding(db, second!.id, { status: "rejected", rejectionReason: null }, "lee");
    expect(await listPublishedReviews(db, 10)).toEqual([]);

    await claimReviewForPublish(db, review.id, { publishedBy: "lee", reviewerNote: null, resolution: "author_fixes" });

    const published = await listPublishedReviews(db, 10);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ confirmedCount: 1, decidedCount: 2, pendingCount: 1 });
    expect(await listPublishedReviews(db, 0)).toEqual([]);
  });

  it("lets only the first of two publish attempts claim the review", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const { review } = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    await completeReview(db, review.id, completedResult(0));

    const first = await claimReviewForPublish(db, review.id, { publishedBy: "lee", reviewerNote: null, resolution: "author_fixes" });
    const second = await claimReviewForPublish(db, review.id, { publishedBy: "kim", reviewerNote: null, resolution: "author_fixes" });

    expect([first, second]).toEqual([true, false]);
    expect((await getReviewDetail(db, review.id))?.review.publishedBy).toBe("lee");
  });

  it("makes a review publishable again after a released claim", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const { review } = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    await completeReview(db, review.id, completedResult(0));
    await claimReviewForPublish(db, review.id, { publishedBy: "lee", reviewerNote: "note", resolution: "author_fixes" });

    await releasePublishClaim(db, review.id);

    expect(await listOpenReviews(db)).toHaveLength(1);
    expect(await claimReviewForPublish(db, review.id, { publishedBy: "kim", reviewerNote: null, resolution: "author_fixes" })).toBe(true);
  });
});

describe("getEarlierDecisions", () => {
  it("returns the decisions of the last published review at another commit", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const first = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    await completeReview(db, first.review.id, completedResult(3));
    const [a, b] = (await getReviewDetail(db, first.review.id))!.findings;
    await decideFinding(db, a!.id, { status: "confirmed" }, "lee");
    await decideFinding(db, b!.id, { status: "rejected", rejectionReason: "Intended" }, "lee");

    // Not published yet: a new review must not inherit undecided work.
    expect(await getEarlierDecisions(db, pullRequest.id, "sha-2")).toBeNull();

    await claimReviewForPublish(db, first.review.id, { publishedBy: "lee", reviewerNote: null, resolution: "author_fixes" });
    const earlier = await getEarlierDecisions(db, pullRequest.id, "sha-2");

    expect(earlier?.headSha).toBe("sha-1");
    expect(earlier?.confirmed.map((f) => f.id)).toEqual([a!.id]);
    expect(earlier?.rejected.map((f) => f.rejectionReason)).toEqual(["Intended"]);
    // The review of the same commit is not its own "earlier" review.
    expect(await getEarlierDecisions(db, pullRequest.id, "sha-1")).toBeNull();
  });
});

describe("getEarlierDecisions over several rounds", () => {
  it("remembers a rejection from round one in round three", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const publish = (reviewId: number) =>
      claimReviewForPublish(db, reviewId, { publishedBy: "lee", reviewerNote: null, resolution: "author_fixes" });

    // Round one: two findings, one confirmed, one rejected.
    const one = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    await completeReview(db, one.review.id, completedResult(2));
    const [kept, turnedDown] = (await getReviewDetail(db, one.review.id))!.findings;
    await decideFinding(db, kept!.id, { status: "confirmed" }, "lee");
    await decideFinding(db, turnedDown!.id, { status: "rejected", rejectionReason: "By design" }, "lee");
    await publish(one.review.id);

    // Round two: the rejected finding was not raised, so it has no row here.
    const two = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-2" });
    await completeReview(db, two.review.id, completedResult(1));
    const [again] = (await getReviewDetail(db, two.review.id))!.findings;
    await decideFinding(db, again!.id, { status: "confirmed" }, "lee");
    await publish(two.review.id);

    const earlier = await getEarlierDecisions(db, pullRequest.id, "sha-3");

    // Verified against the latest round only...
    expect(earlier?.headSha).toBe("sha-2");
    expect(earlier?.confirmed.map((f) => f.id)).toEqual([again!.id]);
    // ...but the round-one rejection is still known.
    expect(earlier?.rejected.map((f) => f.rejectionReason)).toEqual(["By design"]);
  });

  it("lists a finding rejected in two rounds once", async () => {
    const { pullRequest } = await seedPullRequest(db);
    for (const sha of ["sha-1", "sha-2"]) {
      const round = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: sha });
      await completeReview(db, round.review.id, completedResult(1));
      const [finding] = (await getReviewDetail(db, round.review.id))!.findings;
      await decideFinding(db, finding!.id, { status: "rejected", rejectionReason: "No" }, "lee");
      await claimReviewForPublish(db, round.review.id, { publishedBy: "lee", reviewerNote: null, resolution: "author_fixes" });
    }

    const earlier = await getEarlierDecisions(db, pullRequest.id, "sha-3");
    expect(earlier?.rejected).toHaveLength(1);
  });
});

describe("rate limit rows", () => {
  it("are dropped once they are more than a day old, when a caller starts a new window", async () => {
    const now = new Date("2026-11-13T12:00:00Z");
    await incrementRateLimit(db, "old-caller", new Date("2026-11-12T10:00:00Z"));
    await incrementRateLimit(db, "recent-caller", new Date("2026-11-13T09:00:00Z"));

    await incrementRateLimit(db, "new-caller", now);

    const left = await db.select({ key: rateLimits.key }).from(rateLimits);
    expect(left.map((row) => row.key).sort()).toEqual(["new-caller", "recent-caller"]);
  });
});

describe("renamePullRequest", () => {
  it("updates the title of a known pull request and ignores unknown ones", async () => {
    const { repository, pullRequest } = await seedPullRequest(db);

    await renamePullRequest(db, { githubRepoId: repository.githubRepoId, number: pullRequest.number, title: "New title" });
    await renamePullRequest(db, { githubRepoId: 424242, number: 1, title: "Nobody" });
    const { review } = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });

    expect((await getReviewDetail(db, review.id))!.pullRequest.title).toBe("New title");
  });
});

describe("finding history", () => {
  it("records every change in order, and keeps the record of a removed finding", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const { review } = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    await completeReview(db, review.id, completedResult(1));
    const [ai] = (await getReviewDetail(db, review.id))!.findings;

    await decideFinding(db, ai!.id, { status: "confirmed" }, "lee");
    await decideFinding(db, ai!.id, { status: "rejected", rejectionReason: "By design" }, "kim");
    await decideFinding(db, ai!.id, { status: "pending" }, "kim");
    await editFinding(db, ai!.id, { explanation: "Mine", suggestedFix: null }, "lee");
    const mine = await addHumanFinding(db, review.id, {
      filePath: "src/a.ts", startLine: 1, endLine: 1, severity: "nit", category: "bug", explanation: "x", suggestedFix: null,
    }, "lee");
    await updateHumanFinding(db, mine.id, { explanation: "y", suggestedFix: null }, "lee");
    await removeHumanFinding(db, mine.id, "lee");

    const history = await listFindingEvents(db, review.id);

    expect(history.map((e) => [e.actor, e.action, e.detail])).toEqual([
      ["lee", "confirmed", null],
      ["kim", "rejected", "By design"],
      ["kim", "reset", null],
      ["lee", "edited", null],
      ["lee", "added", null],
      ["lee", "edited", null],
      ["lee", "removed", null],
    ]);
    // The finding is gone; its history is not.
    expect(history.at(-1)?.findingId).toBe(mine.id);
    expect((await getReviewDetail(db, review.id))!.findings).toHaveLength(1);
  });

  it("reports the latest change per review", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const { review } = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });
    await completeReview(db, review.id, completedResult(2));
    const [first, second] = (await getReviewDetail(db, review.id))!.findings;
    await decideFinding(db, first!.id, { status: "confirmed" }, "lee");
    await decideFinding(db, second!.id, { status: "confirmed" }, "kim");

    const activity = await latestActivity(db, [review.id, 9999]);

    expect(activity.get(review.id)?.actor).toBe("kim");
    expect(activity.has(9999)).toBe(false);
    expect((await latestActivity(db, [])).size).toBe(0);
  });

  it("records nothing when the finding does not exist", async () => {
    const { pullRequest } = await seedPullRequest(db);
    const { review } = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: "sha-1" });

    await decideFinding(db, 99999, { status: "confirmed" }, "lee");
    await removeHumanFinding(db, 99999, "lee");

    expect(await listFindingEvents(db, review.id)).toEqual([]);
  });
});

describe("recently published", () => {
  it("lists a pull request once, with its latest round", async () => {
    const { pullRequest } = await seedPullRequest(db);
    for (const sha of ["sha-1", "sha-2"]) {
      const round = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: sha });
      await completeReview(db, round.review.id, completedResult(0));
      await claimReviewForPublish(db, round.review.id, { publishedBy: "lee", reviewerNote: null, resolution: "author_fixes" });
    }

    const published = await listPublishedReviews(db, 10);

    expect(published).toHaveLength(1);
    expect(published[0]?.review.headSha).toBe("sha-2");
  });

  it("still lists it once when two rounds were published at the same instant", async () => {
    // This happened in this test suite itself: two publishes in one
    // millisecond, and the pull request was listed twice.
    const { pullRequest } = await seedPullRequest(db);
    for (const sha of ["sha-1", "sha-2"]) {
      const round = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: sha });
      await completeReview(db, round.review.id, completedResult(0));
      await claimReviewForPublish(db, round.review.id, { publishedBy: "lee", reviewerNote: null, resolution: "author_fixes" });
    }
    await db
      .update(reviews)
      .set({ publishedAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(reviews.pullRequestId, pullRequest.id));

    const published = await listPublishedReviews(db, 10);

    expect(published).toHaveLength(1);
    expect(published[0]?.review.headSha).toBe("sha-2");
  });

  it("returns at most the limit, newest pull request first", async () => {
    const repository = await upsertRepository(db, { githubRepoId: 9, installationId: 1, owner: "acme", name: "shop" });
    for (const number of [1, 2, 3]) {
      const pullRequest = await upsertPullRequest(db, {
        repositoryId: repository.id, number, title: `PR ${number}`, authorLogin: "sam", headSha: `sha-${number}`,
      });
      const round = await startGithubReview(db, { pullRequestId: pullRequest.id, headSha: `sha-${number}` });
      await completeReview(db, round.review.id, completedResult(0));
      await claimReviewForPublish(db, round.review.id, { publishedBy: "lee", reviewerNote: null, resolution: "author_fixes" });
    }

    const published = await listPublishedReviews(db, 2);

    expect(published.map((item) => item.pullRequest.number)).toEqual([3, 2]);
  });
});

describe("paste reviews", () => {
  it("logs token usage without a pull request and counts recent ones", async () => {
    await recordPasteReview(db, completedResult(1));
    await recordPasteReview(db, completedResult(0));

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const inFuture = new Date(Date.now() + 60 * 1000);

    expect(await countPasteReviewsSince(db, hourAgo)).toBe(2);
    expect(await countPasteReviewsSince(db, inFuture)).toBe(0);
    // Paste reviews never show up in the reviewer dashboard.
    expect(await listOpenReviews(db)).toEqual([]);
  });
});

describe("rate limit", () => {
  const now = new Date("2026-03-01T10:20:00Z");

  it("allows up to the limit in one hour window, then blocks", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push((await consumeHourlyLimit(db, "caller-a", 3, now)).allowed);
    }
    expect(results).toEqual([true, true, true, false]);
  });

  it("counts each caller separately", async () => {
    await consumeHourlyLimit(db, "caller-a", 1, now);
    expect((await consumeHourlyLimit(db, "caller-a", 1, now)).allowed).toBe(false);
    expect((await consumeHourlyLimit(db, "caller-b", 1, now)).allowed).toBe(true);
  });

  it("starts a new count in the next hour", async () => {
    await consumeHourlyLimit(db, "caller-a", 1, now);
    const nextHour = new Date("2026-03-01T11:00:01Z");

    const result = await consumeHourlyLimit(db, "caller-a", 1, nextHour);

    expect(result.allowed).toBe(true);
    expect(result.resetAt.toISOString()).toBe("2026-03-01T12:00:00.000Z");
  });

  it("rounds a time down to the start of its hour", () => {
    expect(hourWindowStart(now).toISOString()).toBe("2026-03-01T10:00:00.000Z");
  });

  it("hashes IPs so the stored key is stable but not the address", () => {
    const key = hashClientIp("203.0.113.9", "secret");
    expect(key).toBe(hashClientIp("203.0.113.9", "secret"));
    expect(key).not.toBe(hashClientIp("203.0.113.10", "secret"));
    expect(key).not.toBe(hashClientIp("203.0.113.9", "other-secret"));
    expect(key).not.toContain("203.0.113.9");
  });
});
