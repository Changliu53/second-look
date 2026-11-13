"use client";

import Link from "next/link";
import { useState } from "react";
import { MarkdownLite } from "@/components/markdown-lite";
import { FixPromptBlock } from "@/components/review/fix-prompt-block";
import { BUTTON, BUTTON_PRIMARY, SECTION_LABEL } from "@/components/ui";
import type { Finding } from "@/db/schema";
import { checkRunFor } from "@/github/check-run";
import {
  buildReviewParts,
  fixPromptFor,
  fixPromptSection,
  type Resolution,
} from "@/github/publish";
import type { FileDiff } from "@/review/diff";
import { PASTED_FILE_NAME } from "@/review/paste";
import type { ReviewSummary } from "@/review/schema";
import { CheckStatus } from "./check-status";

// In the preview text a real reviewer's GitHub login would appear here.
const PREVIEW_REVIEWER = "The reviewer";

/**
 * Step four: what the simulated publish would have put on the pull request.
 * The text is built by `buildReviewParts` and `checkRunFor`, the functions
 * the real publish uses, so this is the real output and not a mock-up of it.
 */
export function AuthorStep({
  title,
  summary,
  findings,
  files,
  resolution,
  note,
  onStartOver,
}: {
  title: string;
  summary: ReviewSummary;
  findings: Finding[];
  files: FileDiff[];
  resolution: Resolution;
  note: string;
  onStartOver: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const confirmed = findings.filter((finding) => finding.status === "confirmed");
  const takenOver = resolution === "reviewer_takes_over";
  const parts = buildReviewParts({
    headSha: "",
    summary,
    findings,
    files,
    reviewerLogin: PREVIEW_REVIEWER,
    reviewerNote: note.trim() === "" ? null : note.trim(),
    resolution,
    pullRequestTitle: title,
  });
  const engineerPrompt = takenOver ? fixPromptFor(title, findings, "engineer") : null;
  const check = checkRunFor({
    kind: "published",
    confirmedCount: confirmed.length,
    confirmedCriticalCount: confirmed.filter((f) => f.severity === "critical").length,
    takenOverBy: takenOver ? PREVIEW_REVIEWER : undefined,
  });

  async function copyMarkdown() {
    const comments = parts.comments.map(
      (comment) => `### ${comment.path}:${comment.line}\n\n${comment.body}`,
    );
    // Same order as the real review: body, fix prompt, footer, then comments.
    const promptSection = parts.fixPrompt ? [fixPromptSection(parts.fixPrompt)] : [];
    await navigator.clipboard.writeText(
      [parts.main, ...promptSection, parts.footer, ...comments].join("\n\n"),
    );
    setCopied(true);
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">What the author gets on GitHub</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Simulated: nothing left your browser. On a real pull request this is the first time the
          author hears from Second Look: one review, written as if by you, with the{" "}
          {confirmed.length} finding{confirmed.length === 1 ? "" : "s"} you confirmed. Rejected
          findings and your reasons stay in Second Look.
        </p>
      </header>

      <CheckStatus check={check} />

      <section className="rounded-lg border border-edge bg-surface-raised">
        <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-2">
          <p className={SECTION_LABEL}>Review on the pull request</p>
          <button className={BUTTON} onClick={copyMarkdown}>
            {copied ? "Copied" : "Copy as Markdown"}
          </button>
        </div>
        <div className="space-y-3 p-4">
          <MarkdownLite text={parts.main} />
          {parts.fixPrompt && (
            <FixPromptBlock
              title="Fix these with your AI tool"
              hint="The author pastes this into the AI tool they used."
              prompt={parts.fixPrompt}
            />
          )}
          <MarkdownLite text={parts.footer} />
        </div>
      </section>

      {parts.comments.length > 0 && (
        <section>
          <p className={SECTION_LABEL}>
            {parts.comments.length} inline comment{parts.comments.length === 1 ? "" : "s"} on the diff
          </p>
          <ul className="mt-2 space-y-2">
            {parts.comments.map((comment, index) => (
              <li key={index} className="rounded-lg border border-edge bg-surface-raised p-3">
                <p className="font-mono text-xs text-ink-soft">
                  {comment.path === PASTED_FILE_NAME ? "line " : `${comment.path}:`}
                  {comment.start_line ? `${comment.start_line}-` : ""}
                  {comment.line}
                </p>
                <div className="mt-1.5">
                  <MarkdownLite text={comment.body} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {engineerPrompt && (
        <FixPromptBlock
          title="Prompt for your coding agent"
          hint="Shown to you in the dashboard after you publish. The author does not get it."
          prompt={engineerPrompt}
        />
      )}

      <section className="rounded-lg border border-edge bg-surface-raised p-4 text-sm">
        <p className={SECTION_LABEL}>What happens next</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 leading-relaxed">
          <li>
            {takenOver
              ? "You check out the branch and make the fixes, with the prompt above if you use a coding agent."
              : "The author pastes the fix prompt into their AI tool and pushes the result."}
          </li>
          <li>
            The push starts a second review. It says which findings are fixed and does not repeat
            what you rejected.
          </li>
          <li>You publish again, and the check turns green when no critical finding is left.</li>
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link href="/example" className={BUTTON_PRIMARY}>
            See round two on real pull requests
          </Link>
          <button className={BUTTON} onClick={onStartOver}>
            Start over
          </button>
        </div>
      </section>
    </div>
  );
}
