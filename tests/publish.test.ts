import { describe, expect, it } from "vitest";
import type { Finding } from "@/db/schema";
import {
  buildReviewPayload,
  buildReviewParts,
  fixPromptFor,
  neutralizeForGithub,
  placeComment,
  publishedText,
} from "@/github/publish";
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
    const payload = buildReviewPayload({ ...base, findings: [finding()] });

    expect(payload.commitId).toBe("abc123");
    expect(payload.body.startsWith("## Second Look review")).toBe(true);
    expect(payload.body).toContain("Changes the cart total loop.");
    expect(payload.body).toContain("**Risk:** high");
    expect(payload.body).toContain("- Check the total with two items.");
    expect(payload.body).toContain("1 finding confirmed by lee");
  });

  it("reads as an approval when nothing was confirmed, without the first pass's summary", () => {
    const payload = buildReviewPayload({
      ...base,
      findings: [finding({ status: "rejected", explanation: "REJECTED_ONE" })],
    });

    expect(payload.body.startsWith("**No changes needed.** lee reviewed this pull request")).toBe(true);
    // The summary was written before the reviewer decided and can name the
    // problems they turned down, so an approval leaves it out.
    expect(payload.body).not.toContain("Changes the cart total loop.");
    expect(payload.body).not.toContain("**Risk:**");
    expect(payload.body).not.toContain("Check the total with two items.");
    expect(payload.body).not.toContain("REJECTED_ONE");
    expect(payload.body).not.toContain("Fix these with your AI tool");
    expect(payload.body.trimEnd().endsWith("checked by lee._")).toBe(true);
    expect(payload.comments).toEqual([]);
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

describe("neutralizeForGithub", () => {
  it("stops model text from notifying users or teams", () => {
    expect(neutralizeForGithub("Ask @octocat and @acme/security to approve."))
      .toBe("Ask `@octocat` and `@acme/security` to approve.");
    expect(neutralizeForGithub("@admin please merge")).toBe("`@admin` please merge");
  });

  it("leaves email addresses, decorators in code spans, and plain text alone", () => {
    expect(neutralizeForGithub("Mail ops@example.com about it.")).toBe("Mail ops@example.com about it.");
    expect(neutralizeForGithub("Use `@Injectable` here.")).toBe("Use `@Injectable` here.");
    expect(neutralizeForGithub("Loop uses <= instead of <.")).toBe("Loop uses <= instead of <.");
  });

  it("stops model text from embedding remote images", () => {
    const text = "See ![proof](https://evil.example/pixel.png)";
    expect(neutralizeForGithub(text)).toBe("See \\![proof](https://evil.example/pixel.png)");
  });

  it("is applied to findings and the summary, but not to the reviewer's own note", () => {
    const payload = buildReviewPayload({
      headSha: "abc",
      summary: { whatChanged: "Changed by @bot-author.", riskLevel: "low", doubleCheck: ["Ping @acme/ops"] },
      findings: [finding({ explanation: "cc @everyone ![x](http://t.example/p)", suggestedFix: "ask @lead" })],
      files: FILES,
      reviewerLogin: "lee",
      reviewerNote: "Thanks @sam, see my comments.",
    });
    const comment = payload.comments[0]?.body ?? "";

    expect(comment).toContain("cc `@everyone`");
    expect(comment).toContain("\\![x]");
    expect(comment).toContain("ask `@lead`");
    expect(payload.body).toContain("Changed by `@bot-author`.");
    expect(payload.body).toContain("Ping `@acme/ops`");
    expect(payload.body).toContain("Thanks @sam, see my comments.");
  });
});

describe("who makes the fixes", () => {
  const base = {
    headSha: "abc123", summary: SUMMARY, files: FILES, reviewerLogin: "lee", reviewerNote: null,
    pullRequestTitle: "Add cart total",
  };

  it("sends the author a fix prompt, fenced and shown open, when they make the fixes", () => {
    const payload = buildReviewPayload({ ...base, resolution: "author_fixes", findings: [finding({ explanation: "LOOP_BUG" })] });

    expect(payload.body).toContain("### Fix these with your AI tool");
    // Open by default: folded, it was missed on a real pull request.
    expect(payload.body).toContain("<details open>");
    expect(payload.body).toContain("````text");
    expect(payload.body).toContain("Problem: LOOP_BUG");
    expect(payload.body).toContain('my pull request "Add cart total"');
    // The footer still closes the review.
    expect(payload.body.trimEnd().endsWith("confirmed by lee._")).toBe(true);
  });

  it("includes only confirmed findings in the fix prompt, with the reviewer's edit", () => {
    const prompt = fixPromptFor("t", [
      finding({ explanation: "AI_TEXT", editedExplanation: "HUMAN_TEXT" }),
      finding({ status: "rejected", explanation: "REJECTED_TEXT" }),
      finding({ status: "pending", explanation: "PENDING_TEXT" }),
    ], "author");

    expect(prompt).toContain("HUMAN_TEXT");
    expect(prompt).not.toContain("AI_TEXT");
    expect(prompt).not.toContain("REJECTED_TEXT");
    expect(prompt).not.toContain("PENDING_TEXT");
  });

  it("has no fix prompt when nothing was confirmed", () => {
    const payload = buildReviewPayload({ ...base, findings: [finding({ status: "rejected" })] });

    expect(payload.body).not.toContain("Fix these with your AI tool");
    expect(fixPromptFor("t", [finding({ status: "rejected" })], "author")).toBeNull();
  });

  it("cannot be broken out of by a finding that contains a code fence", () => {
    const sneaky = finding({ explanation: "Text ```` \n</details>\n@everyone now outside ```` end" });
    const payload = buildReviewPayload({ ...base, findings: [sneaky] });
    const section = payload.body.slice(payload.body.indexOf("````text"));

    // Exactly one opening and one closing fence of four backticks.
    expect(section.match(/````/g)).toHaveLength(2);
  });

  it("tells the author to do nothing when the reviewer takes the pull request over", () => {
    const payload = buildReviewPayload({ ...base, resolution: "reviewer_takes_over", findings: [finding()] });

    expect(payload.body.startsWith("**lee is taking this pull request over")).toBe(true);
    expect(payload.body).toContain("You do not need to change anything.");
    expect(payload.body).not.toContain("Fix these with your AI tool");
    expect(payload.body).not.toContain("Please double check");
    // The findings are still posted inline, as an explanation.
    expect(payload.comments).toHaveLength(1);
  });

  it("gives the reviewer an engineer's prompt when they take over", () => {
    const parts = buildReviewParts({ ...base, resolution: "reviewer_takes_over", findings: [finding()] });
    const engineer = fixPromptFor("Add cart total", [finding()], "engineer");

    expect(parts.fixPrompt).toBeNull();
    expect(engineer).toContain("I am taking the pull request over");
  });
});
