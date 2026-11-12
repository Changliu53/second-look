/**
 * A small unified-diff parser. We need three things from a diff that off-the-shelf
 * parsers do not give us directly: the new-file line number of every line (so the
 * model can cite lines), the set of lines GitHub lets us comment on, and which
 * hunk a line belongs to (multi-line comments must stay inside one hunk).
 */

export type DiffLineKind = "add" | "del" | "context";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  /** Line number in the old file. Null for added lines. */
  oldLine: number | null;
  /** Line number in the new file. Null for deleted lines. */
  newLine: number | null;
};

export type Hunk = {
  header: string;
  lines: DiffLine[];
};

export type FileStatus = "added" | "deleted" | "modified" | "renamed";

export type FileDiff = {
  /** Path in the new version of the repo (old path for deleted files). */
  path: string;
  oldPath: string | null;
  status: FileStatus;
  isBinary: boolean;
  hunks: Hunk[];
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const GIT_HEADER = /^diff --git a\/(.+) b\/(.+)$/;

/** Strips the "a/" or "b/" prefix git puts in front of paths. */
function cleanPath(raw: string): string | null {
  // Git appends a tab and a timestamp in some diff formats.
  const path = raw.split("\t")[0]?.trim() ?? "";
  if (path === "/dev/null" || path === "") {
    return null;
  }
  return path.replace(/^[ab]\//, "");
}

function newFile(path: string, oldPath: string | null): FileDiff {
  return { path, oldPath, status: "modified", isBinary: false, hunks: [] };
}

/**
 * Parses the body of one hunk, starting at `startIndex`. The header tells us how
 * many old and new lines to expect; we count them down instead of looking for
 * the next header, because a deleted line may itself start with "--- ".
 */
function parseHunk(
  lines: string[],
  startIndex: number,
  header: RegExpExecArray,
): { hunk: Hunk; nextIndex: number } {
  let oldLine = Number(header[1]);
  let oldRemaining = header[2] === undefined ? 1 : Number(header[2]);
  let newLine = Number(header[3]);
  let newRemaining = header[4] === undefined ? 1 : Number(header[4]);

  const hunk: Hunk = { header: lines[startIndex - 1] ?? "", lines: [] };
  let index = startIndex;

  while (index < lines.length && (oldRemaining > 0 || newRemaining > 0)) {
    const line = lines[index] ?? "";
    const marker = line[0];
    const text = line.slice(1);

    if (marker === "+") {
      hunk.lines.push({ kind: "add", text, oldLine: null, newLine });
      newLine += 1;
      newRemaining -= 1;
    } else if (marker === "-") {
      hunk.lines.push({ kind: "del", text, oldLine, newLine: null });
      oldLine += 1;
      oldRemaining -= 1;
    } else if (marker === "\\") {
      // "\ No newline at end of file" carries no content.
    } else {
      // A context line. Some tools strip the leading space from empty lines.
      hunk.lines.push({ kind: "context", text, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
      oldRemaining -= 1;
      newRemaining -= 1;
    }
    index += 1;
  }

  return { hunk, nextIndex: index };
}

export function parseUnifiedDiff(diffText: string): FileDiff[] {
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";

    const gitHeader = GIT_HEADER.exec(line);
    if (gitHeader) {
      current = newFile(gitHeader[2] ?? "", gitHeader[1] ?? null);
      files.push(current);
      index += 1;
      continue;
    }

    // A plain `diff -u` has no "diff --git" line, only "---" then "+++".
    const startsPlainFile =
      line.startsWith("--- ") &&
      nextLine.startsWith("+++ ") &&
      (current === null || current.hunks.length > 0);
    if (startsPlainFile) {
      current = newFile("", null);
      files.push(current);
    }

    if (current === null) {
      index += 1;
      continue;
    }

    const hunkHeader = HUNK_HEADER.exec(line);
    if (hunkHeader) {
      const { hunk, nextIndex } = parseHunk(lines, index + 1, hunkHeader);
      current.hunks.push(hunk);
      index = nextIndex;
      continue;
    }

    applyFileHeaderLine(current, line);
    index += 1;
  }

  return files.filter((file) => file.path !== "");
}

/** Updates file metadata from one of the header lines between files and hunks. */
function applyFileHeaderLine(file: FileDiff, line: string): void {
  if (line.startsWith("--- ")) {
    const oldPath = cleanPath(line.slice(4));
    file.oldPath = oldPath;
    if (oldPath === null) {
      file.status = "added";
    }
  } else if (line.startsWith("+++ ")) {
    const path = cleanPath(line.slice(4));
    if (path === null) {
      file.status = "deleted";
      file.path = file.oldPath ?? file.path;
    } else {
      file.path = path;
    }
  } else if (line.startsWith("new file mode")) {
    file.status = "added";
    file.oldPath = null;
  } else if (line.startsWith("deleted file mode")) {
    file.status = "deleted";
  } else if (line.startsWith("rename from ")) {
    file.status = "renamed";
    file.oldPath = line.slice("rename from ".length);
  } else if (line.startsWith("rename to ")) {
    file.status = "renamed";
    file.path = line.slice("rename to ".length);
  } else if (
    line.startsWith("Binary files ") ||
    line.startsWith("GIT binary patch")
  ) {
    file.isBinary = true;
  }
}

/**
 * New-file line numbers that appear in the diff (added or context lines).
 * GitHub only accepts inline review comments on these lines.
 */
export function commentableLines(file: FileDiff): Set<number> {
  const result = new Set<number>();
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.newLine !== null) {
        result.add(line.newLine);
      }
    }
  }
  return result;
}

/** Index of the hunk that contains the given new-file line, or -1. */
export function hunkIndexOfLine(file: FileDiff, newLine: number): number {
  return file.hunks.findIndex((hunk) =>
    hunk.lines.some((line) => line.newLine === newLine),
  );
}

/** Number of characters of actual diff content, used for the size limit. */
export function countDiffChars(files: FileDiff[]): number {
  let total = 0;
  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        total += line.text.length + 1;
      }
    }
  }
  return total;
}

/**
 * Renders a file diff with an explicit new-file line number on every line.
 * Models are unreliable at counting lines from hunk headers; printing the
 * number next to each line lets them cite lines accurately.
 */
export function renderFileDiff(file: FileDiff): string {
  const output: string[] = [`=== File: ${file.path} (${file.status}) ===`];
  if (file.status === "renamed" && file.oldPath) {
    output.push(`(renamed from ${file.oldPath})`);
  }
  for (const hunk of file.hunks) {
    output.push(hunk.header);
    for (const line of hunk.lines) {
      const number = line.newLine === null ? "" : String(line.newLine);
      const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      output.push(`${number.padStart(5)} ${marker} | ${line.text}`);
    }
  }
  return output.join("\n");
}
