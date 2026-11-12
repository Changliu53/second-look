import { describe, expect, it } from "vitest";
import {
  commentableLines,
  countDiffChars,
  hunkIndexOfLine,
  parseUnifiedDiff,
  renderFileDiff,
} from "@/review/diff";

const MODIFIED_FILE_DIFF = `diff --git a/src/cart.ts b/src/cart.ts
index 1111111..2222222 100644
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -10,4 +10,5 @@ export function total(items) {
   let sum = 0;
-  for (let i = 0; i < items.length; i++) {
+  for (let i = 0; i <= items.length; i++) {
+    // add price
     sum += items[i].price;
   }
@@ -40,2 +41,3 @@ export function clear() {
   items = [];
+  log("cleared");
 }
`;

describe("parseUnifiedDiff", () => {
  it("assigns old and new line numbers to every line of a hunk", () => {
    const [file] = parseUnifiedDiff(MODIFIED_FILE_DIFF);
    const lines = file?.hunks[0]?.lines ?? [];

    expect(file?.path).toBe("src/cart.ts");
    expect(file?.status).toBe("modified");
    expect(lines.map((l) => [l.kind, l.oldLine, l.newLine])).toEqual([
      ["context", 10, 10],
      ["del", 11, null],
      ["add", null, 11],
      ["add", null, 12],
      ["context", 12, 13],
      ["context", 13, 14],
    ]);
  });

  it("starts the second hunk at the line number from its header", () => {
    const [file] = parseUnifiedDiff(MODIFIED_FILE_DIFF);
    const added = file?.hunks[1]?.lines.find((l) => l.kind === "add");

    expect(added?.newLine).toBe(42);
    expect(added?.text).toBe('  log("cleared");');
  });

  it("detects added, deleted, renamed and binary files", () => {
    const diff = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+const a = 1;
+const b = 2;
diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-const gone = true;
diff --git a/lib/a.ts b/lib/b.ts
similarity index 100%
rename from lib/a.ts
rename to lib/b.ts
diff --git a/logo.png b/logo.png
index 1111111..2222222 100644
Binary files a/logo.png and b/logo.png differ
`;
    const files = parseUnifiedDiff(diff);

    expect(files.map((f) => [f.path, f.status, f.isBinary])).toEqual([
      ["new.ts", "added", false],
      ["old.ts", "deleted", false],
      ["lib/b.ts", "renamed", false],
      ["logo.png", "modified", true],
    ]);
    expect(files[2]?.oldPath).toBe("lib/a.ts");
  });

  it("does not mistake a deleted line starting with '-- ' for a file header", () => {
    // The deleted SQL comment renders as "--- old comment" in the diff.
    const diff = `diff --git a/q.sql b/q.sql
--- a/q.sql
+++ b/q.sql
@@ -1,2 +1,2 @@
--- old comment
+++ new comment
 select 1;
`;
    const files = parseUnifiedDiff(diff);

    expect(files).toHaveLength(1);
    expect(files[0]?.hunks[0]?.lines.map((l) => l.text)).toEqual([
      "-- old comment",
      "++ new comment",
      "select 1;",
    ]);
  });

  it("parses a plain diff without 'diff --git' headers", () => {
    const diff = `--- a/one.txt
+++ b/one.txt
@@ -1 +1 @@
-a
+b
--- a/two.txt
+++ b/two.txt
@@ -1 +1 @@
-c
+d
`;
    expect(parseUnifiedDiff(diff).map((f) => f.path)).toEqual([
      "one.txt",
      "two.txt",
    ]);
  });

  it("returns no files for text that is not a diff", () => {
    expect(parseUnifiedDiff("const x = 1;\nconsole.log(x);")).toEqual([]);
  });
});

describe("diff helpers", () => {
  it("lists only new-side lines as commentable", () => {
    const [file] = parseUnifiedDiff(MODIFIED_FILE_DIFF);
    const lines = commentableLines(file!);

    expect([...lines].sort((a, b) => a - b)).toEqual([
      10, 11, 12, 13, 14, 41, 42, 43,
    ]);
  });

  it("finds which hunk a line belongs to", () => {
    const [file] = parseUnifiedDiff(MODIFIED_FILE_DIFF);

    expect(hunkIndexOfLine(file!, 12)).toBe(0);
    expect(hunkIndexOfLine(file!, 42)).toBe(1);
    expect(hunkIndexOfLine(file!, 30)).toBe(-1);
  });

  it("prints the new line number next to each line", () => {
    const [file] = parseUnifiedDiff(MODIFIED_FILE_DIFF);
    const rendered = renderFileDiff(file!);

    expect(rendered).toContain("=== File: src/cart.ts (modified) ===");
    expect(rendered).toContain(
      "   11 + |   for (let i = 0; i <= items.length; i++) {",
    );
    // Deleted lines have no new line number.
    expect(rendered).toContain(
      "      - |   for (let i = 0; i < items.length; i++) {",
    );
  });

  it("counts characters of diff content, not headers", () => {
    const files = parseUnifiedDiff(`--- a/x\n+++ b/x\n@@ -1 +1 @@\n-ab\n+abcd\n`);
    // "ab" + newline, "abcd" + newline
    expect(countDiffChars(files)).toBe(8);
  });
});
