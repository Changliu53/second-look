import type { Finding } from "@/db/schema";
import { commentableLines, hunkIndexOfLine, type FileDiff } from "@/review/diff";
import { buildFixPrompt, type FixPromptAudience } from "@/review/fix-prompt";
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

/** Who makes the fixes after a review is published. */
export type Resolution = "author_fixes" | "reviewer_takes_over";

/** The fix prompt for the confirmed findings of a review, or null if there are none. */
export function fixPromptFor(
  pullRequestTitle: string,
  findings: Finding[],
  audience: FixPromptAudience,
): string | null {
  const confirmed = findings.filter((finding) => finding.status === "confirmed");
  if (confirmed.length === 0) {
    return null;
  }
  return buildFixPrompt({
    pullRequestTitle,
    audience,
    findings: confirmed.map((finding) => ({
      filePath: finding.filePath,
      startLine: finding.startLine,
      endLine: finding.endLine,
      severity: finding.severity,
      category: finding.category,
      ...publishedText(finding),
    })),
  });
}

// Four backticks, so a finding that quotes a three-backtick block cannot end
// the fence early. Any longer run inside the prompt is shortened to three.
const FENCE = "````";

/**
 * The fix prompt as it appears in the GitHub review: under its own heading,
 * in a code fence, and open. It was folded at first, and a reviewer looking
 * for it on the pull request did not find it. It can still be folded by the
 * reader, since it is long.
 */
export function fixPromptSection(prompt: string): string {
  const safe = prompt.replace(/`{4,}/g, "```");
  return [
    "### Fix these with your AI tool",
    "",
    "1. Copy the text in the box below. Hovering the box shows a copy button in its corner.",
    "2. Paste it into the AI tool you used, in the same project, and let it make the changes.",
    "3. Push the changes to this same branch. Do not open a new pull request.",
    "",
    "Second Look reviews the new commit by itself and checks each of the problems below again. The reviewer then tells you whether anything is left.",
    "",
    "<details open>",
    "<summary>Fix prompt</summary>",
    "",
    `${FENCE}text`,
    safe,
    FENCE,
    "",
    "</details>",
  ].join("\n");
}

function noChangesNotice(reviewerLogin: string): string {
  return `**No changes needed.** ${reviewerLogin} reviewed this pull request and has nothing for you to fix.`;
}

function takeOverNotice(reviewerLogin: string): string {
  return `**${reviewerLogin} is taking this pull request over and will make the fixes.** You do not need to change anything. The comments explain what was found, so the same problems are easier to avoid next time.`;
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
  /** Who makes the fixes. Defaults to the author. */
  resolution?: Resolution;
  /** Needed for the fix prompt when the author makes the fixes. */
  pullRequestTitle?: string;
};

/**
 * The parts of a review before they are joined into GitHub Markdown. The
 * playground shows the fix prompt in its own box, so it needs them separate.
 */
export type ReviewParts = {
  /** Take-over notice, summary, reviewer note, and findings without a line. */
  main: string;
  /** Null when the reviewer fixes it, or when nothing was confirmed. */
  fixPrompt: string | null;
  footer: string;
  comments: ReviewComment[];
};

export function buildReviewParts(input: PublishInput): ReviewParts {
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

  // Nothing confirmed is an approval, whichever mode was picked: there is
  // nothing to fix, so nobody is fixing it.
  const nothingToFix = confirmed.length === 0;
  const takenOver = !nothingToFix && input.resolution === "reviewer_takes_over";
  const sections: string[] = [];
  if (nothingToFix) {
    sections.push(noChangesNotice(input.reviewerLogin));
  } else if (takenOver) {
    sections.push(takeOverNotice(input.reviewerLogin));
  }
  // An approval leaves the first pass's summary out. It is written before
  // the reviewer decides, and often names the very problems the reviewer
  // turned down, which reads as a contradiction under "No changes needed".
  if (!nothingToFix) {
    // When the reviewer fixes it, the author has nothing to double check.
    sections.push(formatSummary(takenOver ? { ...input.summary, doubleCheck: [] } : input.summary));
  }
  if (input.reviewerNote?.trim()) {
    sections.push(`**Note from the reviewer**\n${input.reviewerNote.trim()}`);
  }
  if (unplaced.length > 0) {
    sections.push(
      `**Findings outside the changed lines**\n\n${unplaced.map(formatUnplacedFinding).join("\n\n")}`,
    );
  }

  const count = confirmed.length;
  return {
    main: sections.join("\n\n"),
    fixPrompt: takenOver
      ? null
      : fixPromptFor(input.pullRequestTitle ?? "this pull request", input.findings, "author"),
    footer: nothingToFix
      ? `_First pass by Second Look, checked by ${input.reviewerLogin}._`
      : `_First pass by Second Look. ${count} finding${count === 1 ? "" : "s"} confirmed by ${input.reviewerLogin}._`,
    comments,
  };
}

export function buildReviewPayload(input: PublishInput): ReviewPayload {
  const parts = buildReviewParts(input);
  const sections = [parts.main];
  if (parts.fixPrompt) {
    sections.push(fixPromptSection(parts.fixPrompt));
  }
  sections.push(parts.footer);

  return {
    commitId: input.headSha,
    body: sections.join("\n\n"),
    comments: parts.comments,
  };
}
