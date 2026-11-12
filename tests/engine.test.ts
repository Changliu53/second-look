import { describe, expect, it } from "vitest";
import { ReviewError, reviewChange } from "@/review/engine";
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

  it("does not call the model when the diff is over the size limit", async () => {
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
