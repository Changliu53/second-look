import { describe, expect, it } from "vitest";
import { commentableLines, parseUnifiedDiff } from "@/review/diff";
import { PASTED_FILE_NAME, toReviewableDiff } from "@/review/paste";

describe("toReviewableDiff", () => {
  it("wraps plain code as one added file with matching line numbers", () => {
    const code = "function add(a, b) {\n  return a - b;\n}\n";
    const files = parseUnifiedDiff(toReviewableDiff(code));

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(PASTED_FILE_NAME);
    expect(files[0]?.status).toBe("added");
    const lines = files[0]?.hunks[0]?.lines ?? [];
    expect(lines.map((l) => [l.newLine, l.text])).toEqual([
      [1, "function add(a, b) {"],
      [2, "  return a - b;"],
      [3, "}"],
    ]);
  });

  it("keeps blank lines inside pasted code so line numbers stay correct", () => {
    const files = parseUnifiedDiff(toReviewableDiff("a\n\nb"));
    expect([...commentableLines(files[0]!)]).toEqual([1, 2, 3]);
  });

  it("passes a real diff through unchanged", () => {
    const diff = "--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-old\n+new\n";
    expect(toReviewableDiff(diff)).toBe(diff);
  });

  it("treats code that merely contains '@@' as code, not a diff", () => {
    const code = 'const marker = "@@ -1 +1 @@";';
    const files = parseUnifiedDiff(toReviewableDiff(code));
    expect(files[0]?.path).toBe(PASTED_FILE_NAME);
  });
});
