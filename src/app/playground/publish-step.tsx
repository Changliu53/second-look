"use client";

import { useState } from "react";
import { ReasonTip } from "@/components/reason-tip";
import { FixPromptBlock } from "@/components/review/fix-prompt-block";
import { BUTTON_PRIMARY, INPUT, LINK, SECTION_LABEL } from "@/components/ui";
import type { Finding } from "@/db/schema";
import { fixPromptFor, type Resolution } from "@/github/publish";

const MODES: Array<{ value: Resolution; label: string; detail: string }> = [
  {
    value: "author_fixes",
    label: "Send back to the author",
    detail: "They get your comments and a prompt to paste into their AI tool, which tells it to fix these findings and nothing else.",
  },
  {
    value: "reviewer_takes_over",
    label: "I will fix it myself",
    detail: "The author is told they do not need to do anything. You get a prompt for your own coding agent.",
  },
];

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Step three: the dashboard's publish form. The same choices in the same
 * order: who makes the fixes, the fix prompt, a note to the author, Publish.
 * Here Publish posts nothing; it moves on to what the author would get.
 */
export function PublishStep({
  title,
  findings,
  blocked,
  published,
  note,
  onNote,
  onPublish,
  onSeeAuthor,
}: {
  /** Stands in for the pull request title in the fix prompt. */
  title: string;
  findings: Finding[];
  /** Why publishing is unavailable, or null. */
  blocked: string | null;
  published: Resolution | null;
  note: string;
  onNote: (note: string) => void;
  onPublish: (resolution: Resolution) => void;
  onSeeAuthor: () => void;
}) {
  const [chosen, setChosen] = useState<Resolution>("author_fixes");
  // Once published, the mode that was used is shown and cannot be changed.
  const resolution = published ?? chosen;
  const confirmed = findings.filter((finding) => finding.status === "confirmed");
  const rejected = findings.filter((finding) => finding.status === "rejected").length;
  const critical = confirmed.filter((finding) => finding.severity === "critical").length;
  const authorPrompt = fixPromptFor(title, findings, "author");

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">Publish the review</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Until now nothing has reached the author. Publishing posts the summary and{" "}
          {plural(confirmed.length, "confirmed finding")} to the pull request as one review.{" "}
          {rejected > 0 &&
            `The ${plural(rejected, "rejected finding")} ${rejected === 1 ? "is" : "are"} not shown to the author. `}
          The check will then{" "}
          {critical > 0 ? (
            <strong className="text-red-700">require action ({critical} critical)</strong>
          ) : (
            <strong className="text-green-700">pass</strong>
          )}
          .
        </p>
      </header>

      {published && (
        <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-950">
          Published (simulated), so these choices are fixed.{" "}
          <button className={LINK} onClick={onSeeAuthor}>
            See what the author gets
          </button>
        </p>
      )}

      {confirmed.length > 0 && (
        <fieldset>
          <legend className={SECTION_LABEL}>Who makes the fixes?</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {MODES.map((mode) => (
              <label
                key={mode.value}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-edge bg-surface-raised p-3 transition hover:border-slate-400 has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:disabled]:cursor-default"
              >
                <input
                  type="radio"
                  name="resolution"
                  className="mt-1 shrink-0"
                  checked={resolution === mode.value}
                  disabled={published !== null}
                  onChange={() => setChosen(mode.value)}
                />
                <span>
                  <span className="block text-sm font-medium">{mode.label}</span>
                  <span className="block text-xs leading-relaxed text-ink-soft">{mode.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {authorPrompt && resolution === "author_fixes" && (
        <FixPromptBlock
          title="Fix prompt"
          hint="Goes to the author with the review. It follows what you confirmed and edited."
          prompt={authorPrompt}
        />
      )}

      <label className="block text-sm">
        Note to the author (optional)
        <textarea
          rows={2}
          maxLength={2000}
          value={note}
          readOnly={published !== null}
          onChange={(event) => onNote(event.target.value)}
          className={`mt-1 ${INPUT}`}
        />
      </label>

      {!published && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-edge bg-surface-raised p-4">
          <ReasonTip reason={blocked}>
            <button
              className={BUTTON_PRIMARY}
              disabled={blocked !== null}
              onClick={() => onPublish(resolution)}
            >
              Publish review
            </button>
          </ReasonTip>
          <span className="text-xs leading-relaxed text-ink-soft">
            This is the playground, so nothing is posted. The next step shows what the author
            would get on GitHub.
          </span>
        </div>
      )}
    </div>
  );
}
