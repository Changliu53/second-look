"use client";

import { useState, type FormEvent } from "react";
import {
  COMMON_REJECT_REASONS,
  FindingShell,
  REASON_CHIP,
  REASON_QUESTION,
} from "@/components/review/finding-view";
import { BUTTON, BUTTON_CONFIRM, INPUT } from "@/components/ui";
import type { Finding } from "@/db/schema";
import { publishedText } from "@/github/publish";
import type { SandboxAction } from "@/sandbox/model";

/**
 * A finding in the playground. Same look and same rules as the dashboard's
 * card, but the buttons change local state instead of calling server
 * actions, because there is no account and nothing is saved.
 */
export function SandboxFindingCard({
  finding,
  onAction,
  locked = false,
}: {
  finding: Finding;
  onAction: (action: SandboxAction) => void;
  /** After the simulated publish, findings can no longer be changed. */
  locked?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const text = publishedText(finding);
  const isHuman = finding.source === "human";

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const explanation = String(form.get("explanation") ?? "").trim();
    const suggestedFix = String(form.get("suggestedFix") ?? "").trim();
    if (explanation === "") {
      return;
    }
    onAction({
      type: "edit",
      id: finding.id,
      explanation,
      suggestedFix: suggestedFix === "" ? null : suggestedFix,
    });
    setEditing(false);
  }

  function submitReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    onAction({ type: "reject", id: finding.id, reason: reason === "" ? null : reason });
  }

  if (locked) {
    return <FindingShell finding={finding} fold={false} />;
  }

  const reasonChips = COMMON_REJECT_REASONS.map((reason) => (
    <button
      key={reason}
      type="button"
      aria-pressed={finding.rejectionReason === reason}
      className={REASON_CHIP}
      onClick={() => onAction({ type: "reject", id: finding.id, reason })}
    >
      {reason}
    </button>
  ));
  // Right after a rejection the reasons are one click away, under the folded
  // line. Once one is chosen the line shows it and the question goes away.
  const askWhy = finding.status === "rejected" && !finding.rejectionReason && (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-ink-soft">{REASON_QUESTION}</span>
      {reasonChips}
    </div>
  );

  return (
    <FindingShell finding={finding} followUp={askWhy || undefined}>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!isHuman && finding.status !== "confirmed" && (
          <button
            data-action="confirm"
            title="Send this finding to the author"
            className={BUTTON_CONFIRM}
            onClick={() => onAction({ type: "confirm", id: finding.id })}
          >
            Confirm
          </button>
        )}
        {/* One click. A reason can be added afterwards and is optional. */}
        {!isHuman && finding.status !== "rejected" && (
          <button
            data-action="reject"
            title="Do not send this finding"
            className={BUTTON}
            onClick={() => onAction({ type: "reject", id: finding.id, reason: null })}
          >
            Reject
          </button>
        )}
        <button data-action="edit" className={BUTTON} onClick={() => setEditing(!editing)}>
          Edit
        </button>
        {isHuman && (
          <button
            data-action="undo"
            className={`${BUTTON} text-ink-soft`}
            onClick={() => onAction({ type: "remove", id: finding.id })}
          >
            Remove
          </button>
        )}
        {!isHuman && finding.status !== "pending" && (
          <button
            data-action="undo"
            title="Back to pending"
            className={`${BUTTON} text-ink-soft`}
            onClick={() => onAction({ type: "undo", id: finding.id })}
          >
            Undo
          </button>
        )}
      </div>

      {finding.status === "rejected" && (
        <form onSubmit={submitReason} className="mt-3 max-w-xl">
          <p className="text-xs text-ink-soft">
            Why? (optional. The author never sees it, and the next review will not raise this
            again.)
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{reasonChips}</div>
          <div className="mt-2 flex gap-2">
            <input
              name="reason"
              maxLength={500}
              placeholder="Or type your own"
              className={INPUT}
              defaultValue={
                finding.rejectionReason && !COMMON_REJECT_REASONS.includes(finding.rejectionReason)
                  ? finding.rejectionReason
                  : ""
              }
            />
            <button className={BUTTON}>Save</button>
          </div>
        </form>
      )}

      {editing && (
        <form onSubmit={submitEdit} className="mt-3 max-w-xl">
          <label className="text-xs text-ink-soft">
            Explanation
            <textarea name="explanation" required rows={4} autoFocus defaultValue={text.explanation} className={`mt-1 ${INPUT}`} />
          </label>
          <label className="mt-2 block text-xs text-ink-soft">
            Suggested fix (optional)
            <textarea name="suggestedFix" rows={3} defaultValue={text.suggestedFix ?? ""} className={`mt-1 ${INPUT}`} />
          </label>
          <button className={`${BUTTON} mt-2`}>{isHuman ? "Save" : "Save and confirm"}</button>
        </form>
      )}
    </FindingShell>
  );
}
