import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commentableLines, parseUnifiedDiff } from "@/review/diff";
import type { ReviewFinding } from "@/review/schema";
import { evalCaseSchema, scoreCase, sumScores } from "../eval/score";

const CASES_DIR = path.join(__dirname, "..", "eval", "cases");

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    file: "src/a.ts",
    startLine: 10,
    endLine: 10,
    severity: "warning",
    category: "bug",
    explanation: "x",
    suggestedFix: null,
    confidence: 0.8,
    ...overrides,
  };
}

const CASE = evalCaseSchema.parse({
  title: "t",
  description: "d",
  plantedBug: "b",
  expected: [
    { file: "src/a.ts", startLine: 10, endLine: 12, categories: ["bug", "logic"] },
  ],
  allowed: [
    { file: "src/a.ts", startLine: 2, endLine: 3, categories: ["security"] },
  ],
  ignoreCategories: ["missing-tests"],
  forbiddenRiskLevels: ["low"],
});

describe("scoreCase", () => {
  it("counts a planted bug as found when file, lines and category match", () => {
    const score = scoreCase(CASE, [finding({ startLine: 12, endLine: 14 })], "high");
    expect(score.plantedFound).toBe(1);
    expect(score.falsePositives).toEqual([]);
  });

  it("does not count a finding in the wrong file, category, or place", () => {
    const wrong = [
      finding({ file: "src/b.ts" }),
      finding({ category: "style" }),
      finding({ startLine: 30, endLine: 31 }),
    ];
    const score = scoreCase(CASE, wrong, "high");
    expect(score.plantedFound).toBe(0);
    expect(score.falsePositives).toHaveLength(3);
  });

  it("counts two findings on the same planted bug once, with no false positive", () => {
    const score = scoreCase(CASE, [finding(), finding({ category: "logic" })], "high");
    expect(score.plantedFound).toBe(1);
    expect(score.falsePositives).toEqual([]);
  });

  it("ignores allowed findings and ignored categories", () => {
    const extras = [
      finding({ startLine: 2, endLine: 2, category: "security" }),
      finding({ startLine: 40, endLine: 40, category: "missing-tests" }),
    ];
    const score = scoreCase(CASE, extras, "high");
    expect(score.falsePositives).toEqual([]);
    expect(score.extraNits).toEqual([]);
  });

  it("separates unmatched nits from false positives", () => {
    const score = scoreCase(
      CASE,
      [finding({ startLine: 50, endLine: 50, severity: "nit" })],
      "high",
    );
    expect(score.falsePositives).toEqual([]);
    expect(score.extraNits).toHaveLength(1);
  });

  it("flags a forbidden risk level", () => {
    expect(scoreCase(CASE, [], "low").riskLevelViolation).toBe(true);
    expect(scoreCase(CASE, [], "medium").riskLevelViolation).toBe(false);
  });
});

describe("sumScores", () => {
  it("computes recall and precision over all cases", () => {
    const found = scoreCase(CASE, [finding()], "high");
    const missedWithNoise = scoreCase(
      CASE,
      [finding({ startLine: 80, endLine: 80 })],
      "high",
    );
    const totals = sumScores([found, missedWithNoise]);

    expect(totals.plantedFound).toBe(1);
    expect(totals.plantedTotal).toBe(2);
    expect(totals.falsePositives).toBe(1);
    expect(totals.recall).toBe(0.5);
    expect(totals.precision).toBe(0.5);
  });
});

describe("eval case files", () => {
  const names = readdirSync(CASES_DIR);

  it("has at least 8 planted-bug cases and at least 1 clean case", () => {
    const specs = names.map((name) =>
      evalCaseSchema.parse(
        JSON.parse(readFileSync(path.join(CASES_DIR, name, "case.json"), "utf8")),
      ),
    );
    expect(specs.filter((s) => s.expected.length > 0).length).toBeGreaterThanOrEqual(8);
    expect(specs.filter((s) => s.expected.length === 0).length).toBeGreaterThanOrEqual(1);
  });

  // Guards against a typo in case.json making a planted bug impossible to find.
  it.each(names)("%s: every expected location is on lines the diff adds or shows", (name) => {
    const dir = path.join(CASES_DIR, name);
    const spec = evalCaseSchema.parse(
      JSON.parse(readFileSync(path.join(dir, "case.json"), "utf8")),
    );
    const files = parseUnifiedDiff(readFileSync(path.join(dir, "diff.patch"), "utf8"));

    expect(files.length).toBeGreaterThan(0);
    for (const location of [...spec.expected, ...spec.allowed]) {
      const file = files.find((f) => f.path === location.file);
      expect(file, `${location.file} missing from diff`).toBeDefined();
      const lines = commentableLines(file!);
      expect(lines.has(location.startLine)).toBe(true);
      expect(lines.has(location.endLine)).toBe(true);
    }
  });
});
