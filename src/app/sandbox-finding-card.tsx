"use client";

import { useState, type FormEvent } from "react";
import {
  COMMON_REJECT_REASONS,
  FindingFrame,
  FindingHeader,
  FindingText,
} from "@/components/review/finding-view";
import { BUTTON, BUTTON_CONFIRM, INPUT } from "@/components/ui";
import type { Finding } from "@/db/schema";
import { publishedText } from "@/github/publish";
import type { SandboxAction } from "@/sandbox/model";

type Panel = "none" | "reject" | "edit";

/**
 * A finding in the home page sandbox. Same look and same rules as the
 * dashboard's card, but the buttons change local state instead of calling
 * server actions, because there is no account and nothing is saved.
 */
export function SandboxFindingCard({
  finding,
  onAction,
}: {
  finding: Finding;
  onAction: (action: SandboxAction) => void;
}) {
  const [panel, setPanel] = useState<Panel>("none");
  const text = publishedText(finding);

  function close(action: SandboxAction) {
    onAction(action);
    setPanel("none");
  }

  function submitReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    close({ type: "reject", id: finding.id, reason: reason === "" ? null : reason });
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const explanation = String(form.get("explanation") ?? "").trim();
    const suggestedFix = String(form.get("suggestedFix") ?? "").trim();
    if (explanation === "") {
      return;
    }
    close({
      type: "edit",
      id: finding.id,
      explanation,
      suggestedFix: suggestedFix === "" ? null : suggestedFix,
    });
  }

  return (
    <FindingFrame finding={finding}>
      <FindingHeader finding={finding} />
      <FindingText finding={finding} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {finding.status !== "confirmed" && (
          <button data-action="confirm" className={BUTTON_CONFIRM} onClick={() => close({ type: "confirm", id: finding.id })}>
            Confirm
          </button>
        )}
        {finding.status !== "rejected" && (
          <button data-action="reject" className={BUTTON} onClick={() => setPanel(panel === "reject" ? "none" : "reject")}>
            Reject
          </button>
        )}
        <button data-action="edit" className={BUTTON} onClick={() => setPanel(panel === "edit" ? "none" : "edit")}>
          Edit
        </button>
        {finding.status !== "pending" && (
          <button data-action="undo" className={`${BUTTON} text-ink-soft`} onClick={() => close({ type: "undo", id: finding.id })}>
            Undo
          </button>
        )}
      </div>

      {panel === "reject" && (
        <form onSubmit={submitReject} className="mt-3 max-w-md">
          <label className="text-xs text-ink-soft">
            Reason (optional, the author never sees it)
            <input name="reason" maxLength={500} autoFocus className={`mt-1 ${INPUT}`} />
          </label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {COMMON_REJECT_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                className="rounded-full border border-edge px-2 py-0.5 text-xs text-ink-soft transition hover:border-slate-400 hover:text-ink"
                onClick={() => close({ type: "reject", id: finding.id, reason })}
              >
                {reason}
              </button>
            ))}
          </div>
          <button className={`${BUTTON} mt-2`}>Reject finding</button>
        </form>
      )}

      {panel === "edit" && (
        <form onSubmit={submitEdit} className="mt-3 max-w-xl">
          <label className="text-xs text-ink-soft">
            Explanation
            <textarea name="explanation" required rows={4} autoFocus defaultValue={text.explanation} className={`mt-1 ${INPUT}`} />
          </label>
          <label className="mt-2 block text-xs text-ink-soft">
            Suggested fix (optional)
            <textarea name="suggestedFix" rows={3} defaultValue={text.suggestedFix ?? ""} className={`mt-1 ${INPUT}`} />
          </label>
          <button className={`${BUTTON} mt-2`}>Save and confirm</button>
        </form>
      )}
    </FindingFrame>
  );
}
