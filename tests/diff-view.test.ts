import { describe, expect, it } from "vitest";
import { buildReviewView, fileStats, FOLD_QUIET_FILES_AT, shouldFoldQuietFiles } from "@/dashboard/diff-view";
import type { Finding } from "@/db/schema";
import { parseUnifiedDiff } from "@/review/diff";

const FILES = parseUnifiedDiff(`diff --git a/src/cart.ts b/src/cart.ts
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -10,3 +10,4 @@
   let sum = 0;
-  for (let i = 0; i < n; i++) {
+  for (let i = 0; i <= n; i++) {
+    // add
     sum += items[i].price;
`);

function finding(id: number, startLine: number, endLine: number, filePath = "src/cart.ts"): Finding {
  return {
    id, reviewId: 1, source: "ai", filePath, startLine, endLine,
    severity: "warning", category: "bug", explanation: "x", suggestedFix: null,
    confidence: 0.5, status: "pending", editedExplanation: null, editedSuggestedFix: null,
    rejectionReason: null, decidedBy: null, decidedAt: null, createdAt: new Date(),
  };
}

function findingIdsByLine(view: ReturnType<typeof buildReviewView>) {
  const result: Record<number, number[]> = {};
  for (const row of view.files[0]?.rows ?? []) {
    if (row.kind === "line" && row.findings.length > 0 && row.line.newLine !== null) {
      result[row.line.newLine] = row.findings.map((f) => f.id);
    }
  }
  return result;
}

describe("buildReviewView", () => {
  it("shows each finding under the line its GitHub comment will be on", () => {
    const view = buildReviewView(FILES, [finding(1, 11, 11), finding(2, 11, 12), finding(3, 12, 12)]);

    // A range is anchored at its last line, like a multi-line GitHub comment.
    expect(findingIdsByLine(view)).toEqual({ 11: [1], 12: [2, 3] });
    expect(view.unplaced).toEqual([]);
  });

  it("never attaches a finding to a deleted line", () => {
    const view = buildReviewView(FILES, [finding(1, 11, 11)]);
    const deleted = view.files[0]?.rows.find((row) => row.kind === "line" && row.line.kind === "del");

    expect(deleted).toMatchObject({ findings: [] });
  });

  it("collects findings with no line in the diff instead of hiding them", () => {
    const view = buildReviewView(FILES, [finding(1, 90, 90), finding(2, 1, 1, "src/missing.ts")]);

    expect(view.unplaced.map((f) => f.id)).toEqual([1, 2]);
    expect(findingIdsByLine(view)).toEqual({});
  });

  it("lists every finding as unplaced when the diff is unavailable", () => {
    const view = buildReviewView([], [finding(1, 11, 11)]);

    expect(view.files).toEqual([]);
    expect(view.unplaced).toHaveLength(1);
  });

  it("starts each hunk with its header row", () => {
    const view = buildReviewView(FILES, []);
    expect(view.files[0]?.rows[0]).toEqual({ kind: "hunk", header: "@@ -10,3 +10,4 @@" });
  });
});

describe("folding quiet files in a long diff", () => {
  const longFile = (path: string, lines: number) =>
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,${lines} @@\n-old\n` +
    Array.from({ length: lines }, (_, i) => `+line ${i}`).join("\n") +
    "\n";

  it("counts added and removed lines and the findings in a file", () => {
    const view = buildReviewView(parseUnifiedDiff(longFile("a.ts", 3)), []);
    expect(fileStats(view.files[0]!)).toEqual({ added: 3, removed: 1, findings: 0 });
  });

  it("folds only when the diff is long and has more than one file", () => {
    const short = buildReviewView(parseUnifiedDiff(longFile("a.ts", 10) + longFile("b.ts", 10)), []);
    const oneLongFile = buildReviewView(parseUnifiedDiff(longFile("a.ts", FOLD_QUIET_FILES_AT + 50)), []);
    const long = buildReviewView(
      parseUnifiedDiff(longFile("a.ts", FOLD_QUIET_FILES_AT) + longFile("b.ts", 10)),
      [],
    );
    expect(shouldFoldQuietFiles(short)).toBe(false);
    expect(shouldFoldQuietFiles(oneLongFile)).toBe(false);
    expect(shouldFoldQuietFiles(long)).toBe(true);
  });
});

