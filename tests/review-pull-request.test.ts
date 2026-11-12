import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { getReviewDetail, listOpenReviews } from "@/db/queries";
import { reviewPullRequest, type ReviewDeps } from "@/github/review-pull-request";
import type { PullRequestEvent } from "@/github/webhook-payload";
import { ReviewError, type ReviewModel } from "@/review/engine";
import { FakeGitHub } from "./helpers/fake-github";
import { FakeModel, VALID_SUMMARY } from "./helpers/fake-model";
import { createTestDb } from "./helpers/test-db";

const DIFF = `diff --git a/src/cart.ts b/src/cart.ts
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -10,3 +10,3 @@
   let sum = 0;
-  for (let i = 0; i < items.length; i++) {
+  for (let i = 0; i <= items.length; i++) {
     sum += items[i].price;
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1 +1 @@
-a
+b
`;

const FINDING = {
  file: "src/cart.ts", startLine: 11, endLine: 11, severity: "critical",
  category: "bug", explanation: "Reads past the end.", suggestedFix: null, confidence: 0.9,
};

function event(headSha = "sha-1"): PullRequestEvent {
  return {
    action: "opened",
    number: 7,
    pull_request: {
      title: "Add checkout", body: "Adds the cart total.",
      user: { login: "sam" }, head: { sha: headSha }, base: { ref: "main" },
    },
    repository: { id: 1001, name: "shop", owner: { login: "acme" } },
    installation: { id: 42 },
  };
}

let db: Database;
let github: FakeGitHub;

function deps(model: ReviewModel): ReviewDeps {
  return {
    db, github, model,
    limits: { maxDiffChars: 5_000, maxContextChars: 5_000 },
    appUrl: "https://secondlook.test",
  };
}

async function onlyReview() {
  const [item] = await listOpenReviews(db);
  if (!item) throw new Error("no open review");
  return (await getReviewDetail(db, item.review.id))!;
}

beforeEach(async () => {
  db = await createTestDb();
  github = new FakeGitHub();
  github.diff = DIFF;
});

describe("reviewPullRequest", () => {
  it("stores findings as pending and leaves the check waiting for a reviewer", async () => {
    await reviewPullRequest(event(), deps(new FakeModel({ summary: VALID_SUMMARY, findings: [FINDING] })));

    const detail = await onlyReview();
    expect(detail.review.status).toBe("completed");
    expect(detail.review.headSha).toBe("sha-1");
    expect(detail.findings).toHaveLength(1);
    expect(detail.findings[0]?.status).toBe("pending");
    expect(detail.pullRequest.authorLogin).toBe("sam");

    expect(github.checkRuns[0]).toMatchObject({
      status: "in_progress", headSha: "sha-1",
      detailsUrl: `https://secondlook.test/dashboard/reviews/${detail.review.id}`,
    });
    expect(detail.review.checkRunId).toBe(github.checkRuns[0]?.id);
    expect(github.lastCheckUpdate()).toMatchObject({ status: "in_progress", title: "Waiting for a reviewer" });
    // Nothing is posted to the PR until a human publishes.
    expect(github.reviews).toEqual([]);
  });

  it("reads team guidelines from the base branch, not from the PR head", async () => {
    github.setFile(".second-look.md", "main", "RULE_FROM_MAIN");
    github.setFile(".second-look.md", "sha-1", "RULE_FROM_PR_AUTHOR");
    const model = new FakeModel({ summary: VALID_SUMMARY, findings: [] });

    await reviewPullRequest(event(), deps(model));

    expect(model.prompts[0]?.user).toContain("RULE_FROM_MAIN");
    expect(model.prompts[0]?.user).not.toContain("RULE_FROM_PR_AUTHOR");
  });

  it("fetches changed files at the head commit for context, skipping lockfiles", async () => {
    github.setFile("src/cart.ts", "sha-1", "FULL_CART_FILE");
    const model = new FakeModel({ summary: VALID_SUMMARY, findings: [] });

    await reviewPullRequest(event(), deps(model));

    expect(model.prompts[0]?.user).toContain("FULL_CART_FILE");
    expect(github.fileRequests).toContainEqual({ path: "src/cart.ts", ref: "sha-1" });
    expect(github.fileRequests.map((r) => r.path)).not.toContain("package-lock.json");
  });

  it("does nothing the second time the same commit is delivered", async () => {
    const model = new FakeModel({ summary: VALID_SUMMARY, findings: [FINDING] });

    await reviewPullRequest(event(), deps(model));
    await reviewPullRequest(event(), deps(model));

    expect(model.prompts).toHaveLength(1);
    expect(github.checkRuns).toHaveLength(1);
    expect((await onlyReview()).findings).toHaveLength(1);
  });

  it("starts a fresh review when a new commit is pushed", async () => {
    const model = new FakeModel({ summary: VALID_SUMMARY, findings: [FINDING] });

    await reviewPullRequest(event("sha-1"), deps(model));
    await reviewPullRequest(event("sha-2"), deps(model));

    const open = await listOpenReviews(db);
    expect(open).toHaveLength(1);
    expect(open[0]?.review.headSha).toBe("sha-2");
    expect(open[0]?.pullRequest.headSha).toBe("sha-2");
  });

  it("records a failure and fails the check when the model errors", async () => {
    const failing: ReviewModel = {
      name: "failing",
      generate: async () => {
        throw new ReviewError("model_refused", "declined");
      },
    };

    await reviewPullRequest(event(), deps(failing));

    const detail = await onlyReview();
    expect(detail.review.status).toBe("failed");
    expect(detail.review.errorMessage).toBe("model_refused");
    expect(github.lastCheckUpdate()).toMatchObject({ status: "completed", conclusion: "failure" });
  });

  it("records a failure when GitHub cannot return the diff", async () => {
    github.failOn = "diff";

    await reviewPullRequest(event(), deps(new FakeModel({ summary: VALID_SUMMARY, findings: [] })));

    const detail = await onlyReview();
    expect(detail.review.status).toBe("failed");
    expect(detail.review.errorMessage).toBe("http_500");
  });

  it("still completes the review when the check run cannot be created", async () => {
    github.failOn = "createCheckRun";

    await reviewPullRequest(event(), deps(new FakeModel({ summary: VALID_SUMMARY, findings: [FINDING] })));

    const detail = await onlyReview();
    expect(detail.review.status).toBe("completed");
    expect(detail.review.checkRunId).toBeNull();
    expect(github.checkRunUpdates).toEqual([]);
  });

  it("stores a too-large review without calling the model", async () => {
    const model = new FakeModel({ summary: VALID_SUMMARY, findings: [] });
    const tiny = { ...deps(model), limits: { maxDiffChars: 10, maxContextChars: 10 } };

    await reviewPullRequest(event(), tiny);

    const detail = await onlyReview();
    expect(detail.review.status).toBe("too_large");
    expect(detail.review.summary?.whatChanged).toContain("too large");
    expect(model.prompts).toHaveLength(0);
    expect(github.lastCheckUpdate()?.summary).toContain("too large");
  });
});
