import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import {
  completeReview,
  failReview,
  getReviewDetail,
  setCheckRunId,
  startGithubReview,
  upsertPullRequest,
} from "@/db/queries";
import {
  ACTION_ERRORS,
  addFindingFor,
  decideFindingFor,
  editFindingFor,
  exportDecisionsFor,
  getInsightsFor,
  getDemoReview,
  getReviewFor,
  listReviewsFor,
  prepareRerunFor,
  rerunProblem,
  publishReviewFor,
  removeFindingFor,
  type DashboardDeps,
} from "@/dashboard/service";
import { clearDiffCache, getReviewDiff } from "@/dashboard/diff-cache";
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
    followUp: [],
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
  clearDiffCache();
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

describe("review diff", () => {
  const repo = { owner: "acme", name: "shop" };
  const current = { pullNumber: 7, headSha: "sha-2", currentHeadSha: "sha-2", base: "base-sha" };

  it("asks GitHub once per commit, not once per page render", async () => {
    let calls = 0;
    const original = github.getPullRequestDiff.bind(github);
    github.getPullRequestDiff = async () => {
      calls += 1;
      return original();
    };

    await getReviewDiff(github, repo, current);
    await getReviewDiff(github, repo, current);
    expect(calls).toBe(1);

    // An expired entry is fetched again.
    await getReviewDiff(github, repo, current, Date.now() + 6 * 60 * 1000);
    expect(calls).toBe(2);
  });

  it("rebuilds the diff of an older commit against its recorded base", async () => {
    const diff = await getReviewDiff(github, repo, { ...current, headSha: "sha-1" });

    expect(diff).toBe(DIFF);
    expect(github.commitDiffRequests).toEqual([{ base: "base-sha", headSha: "sha-1" }]);
  });

  it("returns no diff for an older commit when its base is unknown", async () => {
    expect(await getReviewDiff(github, repo, { ...current, headSha: "sha-1", base: null })).toBeNull();
    expect(await getReviewDiff(github, repo, { ...current, headSha: null })).toBeNull();
  });

  it("treats an empty comparison as no diff and asks again next time", async () => {
    // What GitHub returns for branch...oldCommit after the pull request merged.
    github.commitDiff = "";
    const older = { ...current, headSha: "sha-1" };

    expect(await getReviewDiff(github, repo, older)).toBeNull();
    github.commitDiff = DIFF;
    expect(await getReviewDiff(github, repo, older)).toBe(DIFF);
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

describe("exportDecisionsFor", () => {
  it("exports published decisions only, for a user with access, with no finding text", async () => {
    const [first, second] = await findings();
    await decideFindingFor(first!.id, { status: "confirmed" }, "lee", deps);
    await decideFindingFor(second!.id, { status: "rejected", rejectionReason: "=cmd|' /C calc'!A0" }, "lee", deps);

    const before = await exportDecisionsFor("lee", deps, "https://sl.test");
    await publishReviewFor(reviewId, null, "lee", deps);
    const after = await exportDecisionsFor("lee", deps, "https://sl.test");
    const outsider = await exportDecisionsFor("reader", deps, "https://sl.test");

    expect(before.trim().split("\r\n")).toHaveLength(1);
    const lines = after.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"decision"');
    expect(after).toContain(`"https://sl.test/dashboard/reviews/${reviewId}"`);
    // A reason that a spreadsheet would run as a formula is written as text.
    expect(after).toContain(`"'=cmd|' /C calc'!A0"`);
    for (const finding of await findings()) {
      expect(after).not.toContain(finding.explanation);
    }
    expect(outsider.trim().split("\r\n")).toHaveLength(1);
  });
});

describe("a review of an older commit", () => {
  it("points to the review of the latest commit", async () => {
    const { review: newer } = await startGithubReview(db, { pullRequestId, headSha: "sha-2" });

    const old = await getReviewFor(reviewId, "lee", deps);
    const latest = await getReviewFor(newer.id, "lee", deps);

    expect(old?.newerReviewId).toBe(newer.id);
    expect(latest?.newerReviewId).toBeNull();
  });
});

describe("prepareRerunFor", () => {
  async function failTheSeededReview() {
    const { review } = await startGithubReview(db, { pullRequestId, headSha: "sha-9" });
    await failReview(db, review.id, "model_timeout");
    return review.id;
  }

  it("refuses a review that finished, so a finished review is not paid for twice", async () => {
    const outcome = await prepareRerunFor(reviewId, "lee", deps);
    expect(outcome).toEqual({ ok: false, error: "not_rerunnable" });
  });

  it("refuses users without write access with the same answer as a missing review", async () => {
    const failed = await failTheSeededReview();
    expect(await prepareRerunFor(failed, "reader", deps)).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses when the pull request has been closed on GitHub", async () => {
    const failed = await failTheSeededReview();
    github.pullRequest = { ...github.pullRequest, state: "closed" };
    expect(await prepareRerunFor(failed, "lee", deps)).toEqual({ ok: false, error: "pull_request_closed" });
  });

  it("builds the run from the pull request as GitHub has it now", async () => {
    const failed = await failTheSeededReview();
    github.pullRequest = { ...github.pullRequest, title: "Renamed since", headSha: "sha-10" };

    const outcome = await prepareRerunFor(failed, "lee", deps);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.event.pull_request.title).toBe("Renamed since");
      expect(outcome.event.pull_request.head.sha).toBe("sha-10");
      expect(outcome.event.installation.id).toBeGreaterThan(0);
    }
  });
});

describe("rerunProblem", () => {
  it("allows a review that has been running far longer than any review takes", async () => {
    const detail = (await getReviewDetail(db, reviewId))!;
    const stuck = { ...detail.review, status: "running" as const, createdAt: new Date("2026-01-01T00:00:00Z") };
    expect(rerunProblem(stuck, new Date("2026-01-01T02:00:00Z"))).toBeNull();
    expect(rerunProblem({ ...stuck, createdAt: new Date("2026-01-01T01:59:30Z") }, new Date("2026-01-01T02:00:00Z"))).toBe("not_rerunnable");
  });
});

describe("approving with nothing to send", () => {
  it("publishes an approval and passes the check when every finding was rejected", async () => {
    for (const finding of await findings()) {
      await decideFindingFor(finding.id, { status: "rejected", rejectionReason: null }, "lee", deps);
    }

    const outcome = await publishReviewFor(reviewId, "Looks good", "lee", deps);

    expect(outcome.ok).toBe(true);
    const { payload } = github.reviews[0]!;
    expect(payload.body).toContain("**No changes needed.**");
    expect(payload.body).toContain("Looks good");
    expect(payload.comments).toEqual([]);
    expect(JSON.stringify(github.checkRunUpdates.at(-1))).toContain("No changes needed");
  });
});

describe("getInsightsFor", () => {
  it("counts decisions only once the review is published, and only for repositories the user may review", async () => {
    const [first, second] = await findings();
    await decideFindingFor(first!.id, { status: "confirmed" }, "lee", deps);
    await decideFindingFor(second!.id, { status: "rejected", rejectionReason: "By design" }, "lee", deps);

    const before = await getInsightsFor("lee", deps);
    await publishReviewFor(reviewId, null, "lee", deps);
    const after = await getInsightsFor("lee", deps);
    const outsider = await getInsightsFor("reader", deps);

    expect(before.insights.decided).toBe(0);
    expect(after.insights).toMatchObject({ decided: 2, confirmed: 1, rejected: 1 });
    expect(after.insights.rejectionReasons).toEqual([{ reason: "By design", count: 1 }]);
    expect(after.publishedReviews).toBe(1);
    expect(after.repositories).toHaveLength(1);
    expect(outsider.insights.decided).toBe(0);
    expect(outsider.repositories).toEqual([]);
  });

  it("counts only reviews published inside the period", async () => {
    for (const finding of await findings()) {
      await decideFindingFor(finding.id, { status: "confirmed" }, "lee", deps);
    }
    await publishReviewFor(reviewId, null, "lee", deps);
    const inAYear = new Date(Date.now() + 365 * 86_400_000);

    const recent = await getInsightsFor("lee", deps, 30);
    const later = await getInsightsFor("lee", deps, 30, inAYear);
    const allTime = await getInsightsFor("lee", deps, null, inAYear);

    expect(recent.insights.decided).toBe(2);
    expect(later.insights.decided).toBe(0);
    expect(allTime.insights.decided).toBe(2);
  });
});

describe("deciding the last pending finding", () => {
  it("is reported only by the decision that leaves nothing pending", async () => {
    const [first, second] = await findings();

    const notYet = await decideFindingFor(first!.id, { status: "confirmed" }, "lee", deps);
    const last = await decideFindingFor(second!.id, { status: "rejected", rejectionReason: null }, "lee", deps);

    expect(notYet).toEqual({ ok: true });
    expect(last).toEqual({ ok: true, allDecided: true });
  });

  it("is not reported when an earlier decision is changed or undone", async () => {
    const [first, second] = await findings();
    await decideFindingFor(first!.id, { status: "confirmed" }, "lee", deps);
    await decideFindingFor(second!.id, { status: "confirmed" }, "lee", deps);

    const changed = await decideFindingFor(second!.id, { status: "rejected", rejectionReason: null }, "lee", deps);
    const undone = await decideFindingFor(second!.id, { status: "pending" }, "lee", deps);

    expect(changed).toEqual({ ok: true });
    expect(undone).toEqual({ ok: true });
  });

  it("is reported when an edit confirms the last one", async () => {
    const [first, second] = await findings();
    await decideFindingFor(first!.id, { status: "rejected", rejectionReason: null }, "lee", deps);

    const edit = await editFindingFor(second!.id, { explanation: "In my words", suggestedFix: "" }, "lee", deps);

    expect(edit).toEqual({ ok: true, allDecided: true });
  });
});

describe("publishReviewFor", () => {
  it("refuses to publish while any finding is still pending", async () => {
    const [first] = await findings();
    await decideFindingFor(first!.id, { status: "confirmed" }, "lee", deps);

    const outcome = await publishReviewFor(reviewId, null, "lee", deps);

    expect(outcome).toEqual({ ok: false, error: "pending_findings" });
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

  it("records a take-over and tells the author they need not act", async () => {
    for (const finding of await findings()) {
      await decideFindingFor(finding.id, { status: "confirmed" }, "lee", deps);
    }

    const outcome = await publishReviewFor(reviewId, null, "lee", deps, "reviewer_takes_over");

    expect(outcome).toEqual({ ok: true });
    const body = github.reviews[0]?.payload.body ?? "";
    expect(body).toContain("lee is taking this pull request over");
    expect(body).not.toContain("Fix these with your AI tool");
    expect((await getReviewDetail(db, reviewId))?.review.resolution).toBe("reviewer_takes_over");
    expect(github.lastCheckUpdate()?.summary).toContain("lee has taken this pull request over");
  });

  it("sends the fix prompt and records the resolution when sent back to the author", async () => {
    for (const finding of await findings()) {
      await decideFindingFor(finding.id, { status: "confirmed" }, "lee", deps);
    }

    await publishReviewFor(reviewId, null, "lee", deps);

    expect(github.reviews[0]?.payload.body).toContain('my pull request "Add checkout"');
    expect((await getReviewDetail(db, reviewId))?.review.resolution).toBe("author_fixes");
  });

  it("publishes once even if the button is pressed twice", async () => {
    for (const finding of await findings()) {
      await decideFindingFor(finding.id, { status: "confirmed" }, "lee", deps);
    }

    const first = await publishReviewFor(reviewId, null, "lee", deps);
    const second = await publishReviewFor(reviewId, null, "lee", deps);

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "already_published" });
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

    expect(outcome).toEqual({ ok: false, error: "out_of_date" });
    expect(github.reviews).toEqual([]);
  });

  it("locks findings once the review is published", async () => {
    const [critical, warning] = await findings();
    await decideFindingFor(critical!.id, { status: "confirmed" }, "lee", deps);
    await decideFindingFor(warning!.id, { status: "confirmed" }, "lee", deps);
    await publishReviewFor(reviewId, null, "lee", deps);

    const late = await decideFindingFor(critical!.id, { status: "rejected", rejectionReason: null }, "lee", deps);

    expect(late).toEqual({ ok: false, error: "already_published" });
    expect((await findings())[0]?.status).toBe("confirmed");
  });
});

describe("findings the reviewer adds", () => {
  const mine = {
    filePath: "src/cart.ts", startLine: "10", endLine: "", severity: "critical",
    category: "security", explanation: "  REVIEWER_FOUND_THIS  ", suggestedFix: "",
  };

  it("stores the finding as confirmed and written by the reviewer", async () => {
    const outcome = await addFindingFor(reviewId, mine, "lee", deps);

    expect(outcome.ok).toBe(true);
    const added = (await findings()).find((f) => f.source === "human");
    expect(added).toMatchObject({
      filePath: "src/cart.ts", startLine: 10, endLine: 10, severity: "critical", category: "security",
      explanation: "REVIEWER_FOUND_THIS", suggestedFix: null, status: "confirmed", decidedBy: "lee", confidence: 1,
    });
  });

  it("publishes it with the AI findings and counts it for the check", async () => {
    for (const finding of await findings()) {
      await decideFindingFor(finding.id, { status: "rejected", rejectionReason: null }, "lee", deps);
    }
    await addFindingFor(reviewId, mine, "lee", deps);

    await publishReviewFor(reviewId, null, "lee", deps);

    const payload = github.reviews[0]!.payload;
    expect(payload.comments.map((c) => c.line)).toEqual([10]);
    expect(payload.comments[0]?.body).toContain("REVIEWER_FOUND_THIS");
    // Both AI findings were rejected, so the block comes from the reviewer's own.
    expect(github.lastCheckUpdate()).toMatchObject({ conclusion: "action_required" });
  });

  it("does not hold up publishing: it needs no confirmation", async () => {
    for (const finding of await findings()) {
      await decideFindingFor(finding.id, { status: "confirmed" }, "lee", deps);
    }
    await addFindingFor(reviewId, mine, "lee", deps);

    expect((await publishReviewFor(reviewId, null, "lee", deps)).ok).toBe(true);
  });

  it("refuses a file that is not part of the pull request, and incomplete input", async () => {
    const wrongFile = await addFindingFor(reviewId, { ...mine, filePath: "src/elsewhere.ts" }, "lee", deps);
    const noText = await addFindingFor(reviewId, { ...mine, explanation: "   " }, "lee", deps);
    const badSeverity = await addFindingFor(reviewId, { ...mine, severity: "blocker" }, "lee", deps);
    const backwards = await addFindingFor(reviewId, { ...mine, startLine: "12", endLine: "10" }, "lee", deps);

    expect([wrongFile, noText, badSeverity, backwards].map((r) => r.ok)).toEqual([false, false, false, false]);
    expect((await findings()).filter((f) => f.source === "human")).toEqual([]);
  });

  it("refuses users without write access, and reviews that are already published", async () => {
    expect((await addFindingFor(reviewId, mine, "reader", deps)).ok).toBe(false);

    for (const finding of await findings()) {
      await decideFindingFor(finding.id, { status: "confirmed" }, "lee", deps);
    }
    await publishReviewFor(reviewId, null, "lee", deps);
    expect(await addFindingFor(reviewId, mine, "lee", deps)).toEqual({ ok: false, error: "already_published" });
  });

  it("lets the reviewer rewrite it in place and remove it", async () => {
    const added = await addFindingFor(reviewId, mine, "lee", deps);
    if (!added.ok) throw new Error("expected the finding to be added");

    await editFindingFor(added.findingId, { explanation: "CLEARER_TEXT", suggestedFix: "Do X" }, "lee", deps);
    const edited = (await findings()).find((f) => f.id === added.findingId);
    expect(edited).toMatchObject({ explanation: "CLEARER_TEXT", suggestedFix: "Do X", editedExplanation: null });

    expect((await removeFindingFor(added.findingId, "lee", deps)).ok).toBe(true);
    expect((await findings()).some((f) => f.id === added.findingId)).toBe(false);
  });

  it("does not let an AI finding be removed, only rejected", async () => {
    const [ai] = await findings();

    expect((await removeFindingFor(ai!.id, "lee", deps)).ok).toBe(false);
    expect(await findings()).toHaveLength(2);
  });
});

describe("action errors", () => {
  it("has a readable message for every code the service can return", () => {
    for (const message of Object.values(ACTION_ERRORS)) {
      expect(message.length).toBeGreaterThan(10);
    }
  });
});

describe("getDemoReview", () => {
  const PULL = { owner: "acme", name: "shop", number: 7 };

  it("shows nothing until the review has been published", async () => {
    expect(await getDemoReview(PULL, deps)).toBeNull();
  });

  it("returns the published review, including rejected findings, without a login", async () => {
    const [critical, warning] = await findings();
    await decideFindingFor(critical!.id, { status: "confirmed" }, "lee", deps);
    await decideFindingFor(warning!.id, { status: "rejected", rejectionReason: "Intended" }, "lee", deps);
    await publishReviewFor(reviewId, null, "lee", deps);

    const demo = await getDemoReview(PULL, deps);

    expect(demo?.detail.review.id).toBe(reviewId);
    expect(demo?.rounds).toHaveLength(1);
    expect(demo?.detail.findings.map((f) => f.status)).toEqual(["confirmed", "rejected"]);
    expect(demo?.diff).toContain("src/cart.ts");
  });

  it("can open an earlier round", async () => {
    for (const finding of await findings()) {
      await decideFindingFor(finding.id, { status: "confirmed" }, "lee", deps);
    }
    await publishReviewFor(reviewId, null, "lee", deps);
    // A fix is pushed and its review published too.
    await upsertPullRequest(db, { repositoryId, number: 7, title: "Add checkout", authorLogin: "sam", headSha: "sha-2" });
    const second = await startGithubReview(db, { pullRequestId, headSha: "sha-2" });
    await completeReview(db, second.review.id, { ...result(), findings: [] });
    await publishReviewFor(second.review.id, null, "lee", deps);

    const latest = await getDemoReview(PULL, deps);
    const first = await getDemoReview(PULL, deps, 1);

    expect(latest?.detail.review.id).toBe(second.review.id);
    expect(latest?.diff).not.toBeNull();
    expect(first?.detail.review.id).toBe(reviewId);
    // Neither a base commit nor a base branch is recorded for the seeded
    // pull request, so the older round is shown without a diff instead of
    // with the wrong one.
    expect(first?.diff).toBeNull();
    expect(first?.rounds.map((r) => [r.confirmedCount, r.confirmedCriticalCount])).toEqual([[2, 1], [0, 0]]);
    expect(await getDemoReview(PULL, deps, 9)).toBeNull();
  });

  it("does not return reviews of other pull requests", async () => {
    for (const finding of await findings()) {
      await decideFindingFor(finding.id, { status: "confirmed" }, "lee", deps);
    }
    await publishReviewFor(reviewId, null, "lee", deps);

    expect(await getDemoReview({ ...PULL, number: 8 }, deps)).toBeNull();
    expect(await getDemoReview({ ...PULL, name: "other" }, deps)).toBeNull();
  });
});
