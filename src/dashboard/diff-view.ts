import type { Finding } from "@/db/schema";
import { placeComment } from "@/github/publish";
import type { DiffLine, FileDiff } from "@/review/diff";

/**
 * Arranges a diff and its findings for display: each finding is shown under
 * the diff line where its GitHub comment would be attached. Uses the same
 * placement function as publishing, so what the reviewer sees inline is what
 * the author will see inline.
 */

export type DiffRow =
  | { kind: "hunk"; header: string }
  | { kind: "line"; line: DiffLine; findings: Finding[] };

export type FileView = {
  path: string;
  status: FileDiff["status"];
  rows: DiffRow[];
};

export type ReviewView = {
  files: FileView[];
  /** Findings with no line in the diff to attach to. */
  unplaced: Finding[];
};

export function buildReviewView(files: FileDiff[], findings: Finding[]): ReviewView {
  const byAnchor = new Map<string, Finding[]>();
  const unplaced: Finding[] = [];

  for (const finding of findings) {
    const comment = placeComment(finding, files);
    if (!comment) {
      unplaced.push(finding);
      continue;
    }
    const key = `${comment.path}:${comment.line}`;
    byAnchor.set(key, [...(byAnchor.get(key) ?? []), finding]);
  }

  const fileViews = files.map((file) => {
    const rows: DiffRow[] = [];
    for (const hunk of file.hunks) {
      rows.push({ kind: "hunk", header: hunk.header });
      for (const line of hunk.lines) {
        const anchored =
          line.newLine === null ? [] : (byAnchor.get(`${file.path}:${line.newLine}`) ?? []);
        rows.push({ kind: "line", line, findings: anchored });
      }
    }
    return { path: file.path, status: file.status, rows };
  });

  return { files: fileViews, unplaced };
}

/** Lines added and removed in a file, and how many findings sit in it. */
export function fileStats(file: FileView): { added: number; removed: number; findings: number } {
  let added = 0;
  let removed = 0;
  let findings = 0;
  for (const row of file.rows) {
    if (row.kind === "line") {
      if (row.line.kind === "add") added += 1;
      if (row.line.kind === "del") removed += 1;
      findings += row.findings.length;
    }
  }
  return { added, removed, findings };
}

// Above this many diff lines, files without findings start folded.
export const FOLD_QUIET_FILES_AT = 400;

/**
 * In a long diff, a reviewer's time goes to the files with findings first.
 * Files without any start folded, with their size on the folded line, so the
 * page is a list of what needs a decision rather than a wall of code. A short
 * diff is shown whole: folding three files hides more than it saves.
 */
export function shouldFoldQuietFiles(view: ReviewView): boolean {
  if (view.files.length < 2) {
    return false;
  }
  const lines = view.files.reduce(
    (total, file) => total + file.rows.filter((row) => row.kind === "line").length,
    0,
  );
  return lines > FOLD_QUIET_FILES_AT;
}

