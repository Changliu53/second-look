import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import {
  completeReview,
  getReviewDetail,
  setCheckRunId,
  startGithubReview,
  upsertPullRequest,
} from "@/db/queries";
import {
  decideFindingFor,
  editFindingFor,
  getReviewFor,
  listReviewsFor,
  publishReviewFor,
  type DashboardDeps,
} from "@/dashboard/service";
import type { ReviewResult } from "@/review/engine";
import { FakeGitHub } from "./helpers/fake-github";
import { createTestDb, seedPullRequest } from "./helpers/test-db";

// New-file lines 10..12 are in the diff.
const DIFF = `diff --git a/src/cart.ts b/src/cart.ts
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -10,3 +10,3 @@
   let sum = 0;
-  for (let i = 0; i < items.length; i++) {
+  for (let i = 0; i <= items.length; i++) {
     sum += items[i].price;
`;

function result(): ReviewResult {
  const base = {
    file: "src/cart.ts", category: "bug" as const, suggestedFix: null, confidence: 0.9,
  };
  return {
    status: "completed",
    summary: { whatChanged: "Changes the cart loop.", riskLevel: "high", doubleCheck: [] },
    findings: [
      { ...base, startLine: 11, endLine: 11, severity: "critical", explanation: "CRITICAL_BUG" },
      { ...base, startLine: 12, endLine: 12, severity: "warning", explanation: "WARNING_BUG" },
    ],
    skippedFiles: [],
    usage: { inputTokens: 10, outputTokens: 5 },
    model: "test-model",
  };
}

let db: Database;
let github: FakeGitHub;
let deps: DashboardDeps;
let reviewId: number;
let pullRequestId: number;
let repositoryId: number;

async function findings() {
  return (await getReviewDetail(db, reviewId))!.findings;
}

beforeEach(async () => {
  db = await createTestDb();
  github = new FakeGitHub();
  github.diff = DIFF;
  github.permissions.set("lee", "write");
  github.permissions.set("reader", "read");
  deps = { db, githubFor: async () => github };

  const seeded = await seedPullRequest(db);
  pullRequestId = seeded.pullRequest.id;
  repositoryId = seeded.repository.id;
  const { review } = await startGithubReview(db, { pullRequestId, headSha: "sha-1" });
  reviewId = review.id;
  await completeReview(db, reviewId, result());
  // Give the review a check run so publishing has something to complete.
  await setCheckRunId(db, reviewId, 555);
});

describe("access control", () => {
  it("shows reviews only to users with write access to the repository", async () => {
    expect(await listReviewsFor("lee", deps)).toHaveLength(1);
    expect(await listReviewsFor("reader", deps)).toEqual([]);
    expect(await listReviewsFor("stranger", deps)).toEqual([]);
  });

  it("answers 'not found' for a review the user may not see", async () => {
    expect(await getReviewFor(reviewId, "lee", deps)).not.toBeNull();
    expect(await getReviewFor(reviewId, "reader", deps)).toBeNull();
    expect(await getReviewFor(99999, "lee", deps)).toBeNull();
  });

  it("refuses decisions, edits and publishing from users without write access", async () => {
    const [first] = await findings();

    const decide = await decideFindingFor(first!.id, { status: "confirmed" }, "reader", deps);
    const edit = await editFindingFor(first!.id, { explanation: "x", suggestedFix: "" }, "reader", deps);
    const publish = await publishReviewFor(reviewId, null, "reader", deps);

    expect([decide.ok, edit.ok, publish.ok]).toEqual([false, false, false]);
    expect((await findings()).every((f) => f.status === "pending")).toBe(true);
    expect(github.reviews).toEqual([]);
  });
});

describe("getReviewFor", () => {
  it("still returns the findings when GitHub cannot return the diff", async () => {
    github.failOn = "diff";
    const loaded = await getReviewFor(reviewId, "lee", deps);

    expect(loaded?.diff).toBeNull();
    expect(loaded?.detail.findings).toHaveLength(2);
  });
});

describe("editFindingFor", () => {
  it("rejects an empty explanation and stores an empty fix as null", async () => {
    const [first] = await findings();

    const empty = await editFindingFor(first!.id, { explanation: "  ", suggestedFix: "" }, "lee", deps);
    const valid = await editFindingFor(first!.id, { explanation: "Clear text", suggestedFix: "  " }, "lee", deps);

    expect(empty.ok).toBe(false);
    expect(valid.ok).toBe(true);
    const [after] = await findings();
    expect(after).toMatchObject({ editedExplanation: "Clear text", editedSuggestedFix: null, status: "confirmed" });
  });
});

describe("publishReviewFor", () => {
  it("refuses to publish while any finding is still pending", async () => {
    const [first] = await findings();
    await decideFindingFor(first!.id, { status: "confirmed" }, "lee", deps);

    const outcome = await publishReviewFor(reviewId, null, "lee", deps);

    expect(outcome).toEqual({ ok: false, error: "Confirm or reject every finding first (1 still pending)." });
    expect(github.reviews).toEqual([]);
  });

  it("posts only confirmed findings and requires action for a confirmed critical", async () => {
    const [critical, warning] = await findings();
    await decideFindingFor(critical!.id, { status: "confirmed" }, "lee", deps);
    await decideFindingFor(warning!.id, { status: "rejected", rejectionReason: "Intended" }, "lee", deps);

    const outcome = await publishReviewFor(reviewId, "Please fix the loop.", "lee", deps);

    expect(outcome).toEqual({ ok: true });
    expect(github.reviews).toHaveLength(1);
    const { payload, pullNumber } = github.reviews[0]!;
    expect(pullNumber).toBe(7);
    expect(payload.commitId).toBe("sha-1");
    expect(payload.comments.map((c) => c.line)).toEqual([11]);
    expect(JSON.stringify(payload)).toContain("CRITICAL_BUG");
    expect(JSON.stringify(payload)).not.toContain("WARNING_BUG");
    expect(payload.body).toContain("Please fix the loop.");

    expect(github.checkRunUpdates).toEqual([
      { id: 555, update: expect.objectContaining({ status: "completed", conclusion: "action_required" }) },
    ]);
    const detail = await getReviewDetail(db, reviewId);
    expect(detail?.review).toMatchObject({ publishedBy: "lee", githubReviewId: 7001 });
    expect(detail?.review.publishedAt).toBeInstanceOf(Date);
  });

  it("passes the check when the critical finding was rejected", async () => {
    const [critical, warning] = await findings();
    await decideFindingFor(critical!.id, { status: "rejected", rejectionReason: null }, "lee", deps);
    await decideFindingFor(warning!.id, { status: "confirmed" }, "lee", deps);

    await publishReviewFor(reviewId, null, "lee", deps);

    expect(github.lastCheckUpdate()).toMatchObject({ conclusion: "success" });
  });

  it("publishes once even if the button is pressed twice", async () => {
    for (const finding of await findings()) {
      await decideFindingFor(finding.id, { status: "confirmed" }, "lee", deps);
    }

    const first = await publishReviewFor(reviewId, null, "lee", deps);
    const second = await publishReviewFor(reviewId, null, "lee", deps);

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "This review is already published." });
    expect(github.reviews).toHaveLength(1);
  });

  it("leaves the review unpublished when GitHub rejects it", async () => {
    for (const finding of await findings()) {
      await decideFindingFor(finding.id, { status: "confirmed" }, "lee", deps);
    }
    github.failOn = "createReview";

    const failed = await publishReviewFor(reviewId, null, "lee", deps);
    expect(failed.ok).toBe(false);
    expect((await getReviewDetail(db, reviewId))?.review.publishedAt).toBeNull();
    expect(github.checkRunUpdates).toEqual([]);

    // The reviewer can try again once GitHub recovers.
    github.failOn = null;
    expect((await publishReviewFor(reviewId, null, "lee", deps)).ok).toBe(true);
  });

  it("refuses to publish a review of an old commit", async () => {
    for (const finding of await findings()) {
      await decideFindingFor(finding.id, { status: "confirmed" }, "lee", deps);
    }
    // A new commit arrives but its review has not been created yet.
    await upsertPullRequest(db, {
      repositoryId, number: 7, title: "Add checkout", authorLogin: "sam", headSha: "sha-2",
    });

    const outcome = await publishReviewFor(reviewId, null, "lee", deps);

    expect(outcome.ok).toBe(false);
    expect(github.reviews).toEqual([]);
  });

  it("locks findings once the review is published", async () => {
    const [critical, warning] = await findings();
    await decideFindingFor(critical!.id, { status: "confirmed" }, "lee", deps);
    await decideFindingFor(warning!.id, { status: "confirmed" }, "lee", deps);
    await publishReviewFor(reviewId, null, "lee", deps);

    const late = await decideFindingFor(critical!.id, { status: "rejected", rejectionReason: null }, "lee", deps);

    expect(late).toEqual({ ok: false, error: "This review is already published." });
    expect((await findings())[0]?.status).toBe("confirmed");
  });
});
