import { describe, expect, it } from "vitest";
import { normalizeFollowUp, ReviewError, reviewChange } from "@/review/engine";
import { FakeModel, VALID_SUMMARY } from "./helpers/fake-model";

const LIMITS = { maxDiffChars: 2_000, maxContextChars: 500 };

const CART_DIFF = `diff --git a/src/cart.ts b/src/cart.ts
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -10,3 +10,3 @@
   let sum = 0;
-  for (let i = 0; i < items.length; i++) {
+  for (let i = 0; i <= items.length; i++) {
     sum += items[i].price;
`;

const LOCKFILE_DIFF = `diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,1 +1,1 @@
-  "version": "1.0.0"
+  "version": "1.0.1"
`;

function finding(overrides: Record<string, unknown> = {}) {
  return {
    file: "src/cart.ts",
    startLine: 11,
    endLine: 11,
    severity: "warning",
    category: "bug",
    explanation: "Loop runs one step past the end of the list.",
    suggestedFix: "Use i < items.length.",
    confidence: 0.9,
    ...overrides,
  };
}

describe("reviewChange", () => {
  it("returns validated findings, summary, usage and model name", async () => {
    const model = new FakeModel({
      summary: VALID_SUMMARY,
      findings: [finding()],
    });

    const result = await reviewChange({ diff: CART_DIFF }, model, LIMITS);

    expect(result.status).toBe("completed");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.startLine).toBe(11);
    expect(result.summary.riskLevel).toBe("medium");
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(result.model).toBe("fake-model");
  });

  it("rejects model output that does not match the schema", async () => {
    const badOutputs: unknown[] = [
      "I found no problems.",
      { summary: VALID_SUMMARY },
      { summary: VALID_SUMMARY, findings: [finding({ severity: "blocker" })] },
      { summary: VALID_SUMMARY, findings: [finding({ confidence: 1.5 })] },
      { summary: VALID_SUMMARY, findings: [finding({ startLine: "11" })] },
      {
        summary: { ...VALID_SUMMARY, riskLevel: "none" },
        findings: [],
      },
    ];

    for (const output of badOutputs) {
      const attempt = reviewChange(
        { diff: CART_DIFF },
        new FakeModel(output),
        LIMITS,
      );
      await expect(attempt).rejects.toMatchObject({
        name: "ReviewError",
        code: "invalid_model_output",
      });
    }
  });

  it("reviews the riskiest files that fit when the pull request is too large, and says what it left out", async () => {
    const big = (path: string, lines: number) =>
      `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,0 +1,${lines} @@\n` +
      Array.from({ length: lines }, (_, i) => `+line ${i} of ${path}`).join("\n") +
      "\n";
    // Test first in the diff, migration second: the migration still wins.
    const diff = big("tests/cart.test.ts", 20) + big("db/migrations/0042_drop_phone.sql", 20);
    const model = new FakeModel({
      summary: VALID_SUMMARY,
      findings: [
        finding({ file: "db/migrations/0042_drop_phone.sql", startLine: 1, endLine: 1 }),
        // The model was told not to, but a finding on an unseen file is dropped anyway.
        finding({ file: "tests/cart.test.ts", startLine: 1, endLine: 1 }),
      ],
    });

    const result = await reviewChange({ diff }, model, { maxDiffChars: 1_000, maxContextChars: 500 });

    expect(result.status).toBe("completed");
    const user = model.prompts[0]?.user ?? "";
    expect(user).toContain("line 0 of db/migrations/0042_drop_phone.sql");
    expect(user).not.toContain("line 0 of tests/cart.test.ts");
    expect(user).toMatch(/<omitted_files-[0-9a-f]+>\ntests\/cart\.test\.ts\n<\/omitted_files-/);
    expect(result.findings.map((f) => f.file)).toEqual(["db/migrations/0042_drop_phone.sql"]);
    expect(result.summary.doubleCheck[0]).toContain("tests/cart.test.ts");
    expect(result.summary.doubleCheck[0]).toContain("not reviewed automatically");
    expect(result.skippedFiles).toContainEqual({ path: "tests/cart.test.ts", reason: "over_budget" });
  });

  it("does not call the model when not even one file fits", async () => {
    const model = new FakeModel({ summary: VALID_SUMMARY, findings: [] });
    const smallLimit = { maxDiffChars: 50, maxContextChars: 500 };

    const result = await reviewChange({ diff: CART_DIFF }, model, smallLimit);

    expect(result.status).toBe("too_large");
    expect(result.findings).toEqual([]);
    expect(result.summary.whatChanged).toContain("too large");
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(model.prompts).toHaveLength(0);
  });

  it("leaves lockfiles out of the prompt and out of the size count", async () => {
    const model = new FakeModel({ summary: VALID_SUMMARY, findings: [] });

    const result = await reviewChange(
      { diff: CART_DIFF + LOCKFILE_DIFF },
      model,
      LIMITS,
    );

    expect(result.skippedFiles).toEqual([
      { path: "package-lock.json", reason: "lockfile" },
    ]);
    expect(model.prompts[0]?.user).toContain("src/cart.ts");
    expect(model.prompts[0]?.user).not.toContain("package-lock.json");
  });

  it("does not call the model when every changed file is skipped", async () => {
    const model = new FakeModel({ summary: VALID_SUMMARY, findings: [] });

    const result = await reviewChange({ diff: LOCKFILE_DIFF }, model, LIMITS);

    expect(result.status).toBe("completed");
    expect(result.model).toBeNull();
    expect(model.prompts).toHaveLength(0);
  });

  it("drops findings that cite a file which is not in the reviewed diff", async () => {
    const model = new FakeModel({
      summary: VALID_SUMMARY,
      findings: [
        finding(),
        finding({ file: "src/does-not-exist.ts" }),
        finding({ file: "package-lock.json" }),
      ],
    });

    const result = await reviewChange(
      { diff: CART_DIFF + LOCKFILE_DIFF },
      model,
      LIMITS,
    );

    expect(result.findings.map((f) => f.file)).toEqual(["src/cart.ts"]);
  });

  it("fixes reversed line ranges and sorts critical findings first", async () => {
    const model = new FakeModel({
      summary: VALID_SUMMARY,
      findings: [
        finding({ severity: "nit", startLine: 12, endLine: 12 }),
        finding({ severity: "critical", startLine: 12, endLine: 10 }),
        finding({ severity: "warning", startLine: 11, endLine: 11 }),
      ],
    });

    const result = await reviewChange({ diff: CART_DIFF }, model, LIMITS);

    expect(result.findings.map((f) => f.severity)).toEqual([
      "critical",
      "warning",
      "nit",
    ]);
    expect(result.findings[0]).toMatchObject({ startLine: 10, endLine: 12 });
  });

  it("includes file context only while it fits the context budget", async () => {
    const model = new FakeModel({ summary: VALID_SUMMARY, findings: [] });
    const twoFileDiff =
      CART_DIFF +
      `diff --git a/src/big.ts b/src/big.ts
--- a/src/big.ts
+++ b/src/big.ts
@@ -1,1 +1,1 @@
-const a = 1;
+const a = 2;
`;

    await reviewChange(
      {
        diff: twoFileDiff,
        fileContents: [
          { path: "src/cart.ts", content: "SMALL_FILE_BODY" },
          { path: "src/big.ts", content: "B".repeat(600) },
          { path: "src/unrelated.ts", content: "NOT_IN_DIFF_BODY" },
        ],
      },
      model,
      LIMITS,
    );

    const user = model.prompts[0]?.user ?? "";
    expect(user).toContain("SMALL_FILE_BODY");
    expect(user).not.toContain("B".repeat(600));
    expect(user).not.toContain("NOT_IN_DIFF_BODY");
  });

  it("exposes a ReviewError class with a storable code", () => {
    const error = new ReviewError("model_refused", "declined");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("model_refused");
  });
});

describe("follow-up on an earlier review", () => {
  const earlier = {
    confirmed: [
      { id: "P1", file: "src/cart.ts", startLine: 11, endLine: 11, explanation: "CONFIRMED_LOOP_BUG" },
      { id: "P2", file: "src/cart.ts", startLine: 12, endLine: 12, explanation: "CONFIRMED_OTHER" },
    ],
    rejected: [
      { id: "R3", file: "src/cart.ts", startLine: 10, endLine: 10, explanation: "REJECTED_STYLE", reason: "Team style allows it" },
    ],
  };

  it("tells the model what the reviewer decided last time, inside a tagged section", async () => {
    const model = new FakeModel({ summary: VALID_SUMMARY, findings: [], followUp: [] });

    await reviewChange({ diff: CART_DIFF, earlier }, model, LIMITS, "nonce123");
    const user = model.prompts[0]?.user ?? "";
    const section = user.slice(user.indexOf("<earlier_review-nonce123>"), user.indexOf("</earlier_review-nonce123>"));

    expect(section).toContain("[P1] src/cart.ts, line 11: CONFIRMED_LOOP_BUG");
    expect(section).toContain("[R3] src/cart.ts, line 10: REJECTED_STYLE Reviewer's reason: Team style allows it");
    expect(user).toContain("Do not report a rejected finding again.");
  });

  it("says nothing about an earlier review when there was none", async () => {
    const model = new FakeModel({ summary: VALID_SUMMARY, findings: [] });

    const result = await reviewChange({ diff: CART_DIFF }, model, LIMITS);

    expect(model.prompts[0]?.user).not.toContain("earlier_review");
    expect(result.followUp).toEqual([]);
  });

  it("returns one verdict per earlier confirmed finding", async () => {
    const model = new FakeModel({
      summary: VALID_SUMMARY,
      findings: [],
      followUp: [
        { id: "P1", status: "fixed", note: "The loop now uses <." },
        { id: "P999", status: "fixed", note: "An id the model made up." },
        { id: "R3", status: "fixed", note: "Rejected findings get no verdict." },
      ],
    });

    const result = await reviewChange({ diff: CART_DIFF, earlier }, model, LIMITS);

    expect(result.followUp).toEqual([
      { id: "P1", status: "fixed", note: "The loop now uses <." },
      // The model skipped P2, so the reviewer is told it is unknown, not fixed.
      { id: "P2", status: "unclear", note: "The reviewer model did not say whether this was fixed." },
    ]);
  });

  it("ignores verdicts when there was no earlier review", () => {
    expect(normalizeFollowUp([{ id: "P1", status: "fixed", note: "x" }], undefined)).toEqual([]);
  });

  it("rejects output without a followUp list, like any other schema mismatch", async () => {
    const raw = { name: "raw", generate: async () => ({ output: { summary: VALID_SUMMARY, findings: [] }, usage: { inputTokens: 1, outputTokens: 1 } }) };
    await expect(reviewChange({ diff: CART_DIFF }, raw, LIMITS)).rejects.toMatchObject({ code: "invalid_model_output" });
  });
});
