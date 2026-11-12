import { describe, expect, it } from "vitest";
import type { Finding } from "@/db/schema";
import { buildReviewPayload, placeComment, publishedText } from "@/github/publish";
import { parseUnifiedDiff } from "@/review/diff";

// New-file lines in the diff: hunk 1 = 10..14, hunk 2 = 41..43.
const FILES = parseUnifiedDiff(`diff --git a/src/cart.ts b/src/cart.ts
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -10,4 +10,5 @@
   let sum = 0;
-  for (let i = 0; i < items.length; i++) {
+  for (let i = 0; i <= items.length; i++) {
+    // add price
     sum += items[i].price;
   }
@@ -40,2 +41,3 @@
   items = [];
+  log("cleared");
 }
`);

const SUMMARY = {
  whatChanged: "Changes the cart total loop.",
  riskLevel: "high" as const,
  doubleCheck: ["Check the total with two items."],
};

let nextId = 1;
function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: nextId++,
    reviewId: 1,
    source: "ai",
    filePath: "src/cart.ts",
    startLine: 11,
    endLine: 11,
    severity: "critical",
    category: "bug",
    explanation: "Loop reads past the end.",
    suggestedFix: "Use <.",
    confidence: 0.9,
    status: "confirmed",
    editedExplanation: null,
    editedSuggestedFix: null,
    rejectionReason: null,
    decidedBy: "lee",
    decidedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

describe("placeComment", () => {
  it("places a single-line finding on its line, on the new side", () => {
    expect(placeComment(finding(), FILES)).toMatchObject({
      path: "src/cart.ts", line: 11, side: "RIGHT",
    });
    expect(placeComment(finding(), FILES)).not.toHaveProperty("start_line");
  });

  it("uses a multi-line comment when the range is inside one hunk", () => {
    const comment = placeComment(finding({ startLine: 11, endLine: 13 }), FILES);
    expect(comment).toMatchObject({ start_line: 11, line: 13, start_side: "RIGHT" });
  });

  it("falls back to one line when the range spans two hunks", () => {
    const comment = placeComment(finding({ startLine: 13, endLine: 42 }), FILES);
    expect(comment).toMatchObject({ line: 13 });
    expect(comment).not.toHaveProperty("start_line");
  });

  it("uses whichever end of the range is in the diff", () => {
    expect(placeComment(finding({ startLine: 5, endLine: 10 }), FILES)).toMatchObject({ line: 10 });
    expect(placeComment(finding({ startLine: 14, endLine: 20 }), FILES)).toMatchObject({ line: 14 });
  });

  it("returns null for a line outside the diff or a file not in the diff", () => {
    expect(placeComment(finding({ startLine: 30, endLine: 30 }), FILES)).toBeNull();
    expect(placeComment(finding({ filePath: "src/other.ts" }), FILES)).toBeNull();
  });
});

describe("buildReviewPayload", () => {
  const base = { headSha: "abc123", summary: SUMMARY, files: FILES, reviewerLogin: "lee", reviewerNote: null };

  it("publishes confirmed findings only", () => {
    const payload = buildReviewPayload({
      ...base,
      findings: [
        finding({ explanation: "CONFIRMED_ONE" }),
        finding({ status: "rejected", explanation: "REJECTED_ONE", startLine: 12, endLine: 12 }),
        finding({ status: "pending", explanation: "PENDING_ONE", startLine: 42, endLine: 42 }),
      ],
    });
    const everything = JSON.stringify(payload);

    expect(payload.comments).toHaveLength(1);
    expect(everything).toContain("CONFIRMED_ONE");
    expect(everything).not.toContain("REJECTED_ONE");
    expect(everything).not.toContain("PENDING_ONE");
  });

  it("puts the plain-English summary at the top of the review body", () => {
    const payload = buildReviewPayload({ ...base, findings: [] });

    expect(payload.commitId).toBe("abc123");
    expect(payload.body.startsWith("## Second Look review")).toBe(true);
    expect(payload.body).toContain("Changes the cart total loop.");
    expect(payload.body).toContain("**Risk:** high");
    expect(payload.body).toContain("- Check the total with two items.");
    expect(payload.body).toContain("0 findings confirmed by lee");
  });

  it("lists findings without a valid inline position in the body instead of dropping them", () => {
    const payload = buildReviewPayload({
      ...base,
      findings: [finding({ startLine: 30, endLine: 30, explanation: "OUTSIDE_DIFF" })],
    });

    expect(payload.comments).toEqual([]);
    expect(payload.body).toContain("Findings outside the changed lines");
    expect(payload.body).toContain("`src/cart.ts:30`");
    expect(payload.body).toContain("OUTSIDE_DIFF");
  });

  it("publishes the reviewer's edit instead of the model's text", () => {
    const edited = finding({
      explanation: "MODEL_TEXT", suggestedFix: "MODEL_FIX",
      editedExplanation: "HUMAN_TEXT", editedSuggestedFix: null,
    });
    const payload = buildReviewPayload({ ...base, findings: [edited] });

    expect(payload.comments[0]?.body).toContain("HUMAN_TEXT");
    expect(payload.comments[0]?.body).not.toContain("MODEL_TEXT");
    // The reviewer removed the fix, so the model's fix must not come back.
    expect(payload.comments[0]?.body).not.toContain("MODEL_FIX");
    expect(publishedText(edited)).toEqual({ explanation: "HUMAN_TEXT", suggestedFix: null });
  });

  it("includes the reviewer note when there is one", () => {
    const payload = buildReviewPayload({ ...base, findings: [], reviewerNote: "  Ping me when fixed.  " });
    expect(payload.body).toContain("**Note from the reviewer**\nPing me when fixed.");
  });
});
