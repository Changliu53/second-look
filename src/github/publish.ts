import type { Finding } from "@/db/schema";
import { commentableLines, hunkIndexOfLine, type FileDiff } from "@/review/diff";
import type { ReviewSummary } from "@/review/schema";
import type { ReviewComment, ReviewPayload } from "./client";

/**
 * Turns confirmed findings into one GitHub review. Pure functions: no network
 * and no database, so the placement rules below are easy to test.
 */

/**
 * Makes model-written text safe to post on GitHub. A finding's text is shaped
 * by the code under review, so a pull request could try to make the reviewer
 * "say" something that GitHub then acts on:
 * - "@someone" or "@org/team" would send notifications. Wrapped in backticks
 *   it is shown as plain text.
 * - "![](https://...)" would load an image from any server when the comment
 *   is viewed. Escaped, it is shown as text.
 * The reviewer's own note is not passed through this: a human wrote it.
 */
export function neutralizeForGithub(text: string): string {
  return text
    .replace(/(^|[^\w`])@([A-Za-z0-9][A-Za-z0-9/-]*)/g, "$1`@$2`")
    .replace(/!\[/g, "\\![");
}

/** The text to publish: the reviewer's rewrite if there is one. */
export function publishedText(finding: Finding): {
  explanation: string;
  suggestedFix: string | null;
} {
  return {
    explanation: finding.editedExplanation ?? finding.explanation,
    suggestedFix:
      finding.editedExplanation !== null
        ? finding.editedSuggestedFix
        : finding.suggestedFix,
  };
}

function formatFinding(finding: Finding): string {
  const text = publishedText(finding);
  const lines = [
    `**${finding.severity} · ${finding.category}**`,
    "",
    neutralizeForGithub(text.explanation),
  ];
  if (text.suggestedFix) {
    lines.push("", `**Suggested fix:** ${neutralizeForGithub(text.suggestedFix)}`);
  }
  return lines.join("\n");
}

/**
 * Decides where a finding can be attached. GitHub rejects the whole review
 * (HTTP 422) if any comment points at a line that is not part of the diff, or
 * if a multi-line comment spans two hunks. Returns null when the finding has
 * no valid inline position; the caller then lists it in the review body.
 */
export function placeComment(finding: Finding, files: FileDiff[]): ReviewComment | null {
  const file = files.find((candidate) => candidate.path === finding.filePath);
  if (!file) {
    return null;
  }

  const lines = commentableLines(file);
  const body = formatFinding(finding);
  const startInDiff = lines.has(finding.startLine);
  const endInDiff = lines.has(finding.endLine);

  const isRange = finding.startLine < finding.endLine;
  const sameHunk =
    hunkIndexOfLine(file, finding.startLine) === hunkIndexOfLine(file, finding.endLine);
  if (isRange && startInDiff && endInDiff && sameHunk) {
    return {
      path: file.path,
      body,
      line: finding.endLine,
      side: "RIGHT",
      start_line: finding.startLine,
      start_side: "RIGHT",
    };
  }

  // Fall back to a single line, preferring where the problem starts.
  if (startInDiff) {
    return { path: file.path, body, line: finding.startLine, side: "RIGHT" };
  }
  if (endInDiff) {
    return { path: file.path, body, line: finding.endLine, side: "RIGHT" };
  }
  return null;
}

function formatSummary(summary: ReviewSummary): string {
  const lines = [
    "## Second Look review",
    "",
    "**What this pull request changes**",
    neutralizeForGithub(summary.whatChanged),
    "",
    `**Risk:** ${summary.riskLevel}`,
  ];
  if (summary.doubleCheck.length > 0) {
    lines.push("", "**Please double check**");
    for (const item of summary.doubleCheck) {
      lines.push(`- ${neutralizeForGithub(item)}`);
    }
  }
  return lines.join("\n");
}

function formatUnplacedFinding(finding: Finding): string {
  const location = `\`${finding.filePath}:${finding.startLine}\``;
  // Indent continuation lines so multi-line text stays inside the list item.
  return `- ${location}\n\n  ${formatFinding(finding).replace(/\n/g, "\n  ")}`;
}

export type PublishInput = {
  headSha: string;
  summary: ReviewSummary;
  /** Every finding of the review. Only confirmed ones are published. */
  findings: Finding[];
  /** The PR diff as GitHub reports it now. */
  files: FileDiff[];
  reviewerLogin: string;
  reviewerNote: string | null;
};

export function buildReviewPayload(input: PublishInput): ReviewPayload {
  const confirmed = input.findings.filter((finding) => finding.status === "confirmed");

  const comments: ReviewComment[] = [];
  const unplaced: Finding[] = [];
  for (const finding of confirmed) {
    const comment = placeComment(finding, input.files);
    if (comment) {
      comments.push(comment);
    } else {
      unplaced.push(finding);
    }
  }

  const sections = [formatSummary(input.summary)];
  if (input.reviewerNote?.trim()) {
    sections.push(`**Note from the reviewer**\n${input.reviewerNote.trim()}`);
  }
  if (unplaced.length > 0) {
    sections.push(
      `**Findings outside the changed lines**\n\n${unplaced.map(formatUnplacedFinding).join("\n\n")}`,
    );
  }
  const count = confirmed.length;
  sections.push(
    `_First pass by Second Look. ${count} finding${count === 1 ? "" : "s"} confirmed by ${input.reviewerLogin}._`,
  );

  return {
    commitId: input.headSha,
    body: sections.join("\n\n"),
    comments,
  };
}
