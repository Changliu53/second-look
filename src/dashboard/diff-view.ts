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
