import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import {
  completeReview,
  countPasteReviewsSince,
  decideFinding,
  editFinding,
  failReview,
  getReviewDetail,
  listOpenReviews,
  markReviewPublished,
  recordPasteReview,
  STALE_REVIEW_MS,
  startGithubReview,
  upsertPullRequest,
  upsertRepository,
} from "@/db/queries";
import { reviews } from "@/db/schema";
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
    await markReviewPublished(db, old.review.id, {
      publishedBy: "lee", githubReviewId: 99, reviewerNote: null,
    });

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
    const first = await startGithubReview(db, input);
    await completeReview(db, first.review.id, completedResult(2));
    await failReview(db, first.review.id, "simulated crash after findings were written");

    const retry = await startGithubReview(db, input);
    await completeReview(db, retry.review.id, completedResult(2));

    const detail = await getReviewDetail(db, retry.review.id);
    expect(detail?.findings).toHaveLength(2);
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

    await markReviewPublished(db, review.id, { publishedBy: "lee", githubReviewId: 5, reviewerNote: "LGTM after fixes" });
    expect(await listOpenReviews(db)).toEqual([]);
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
