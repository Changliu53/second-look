import {
  confirmFindingAction,
  editFindingAction,
  rejectFindingAction,
  removeFindingAction,
  resetFindingAction,
} from "@/app/dashboard/actions";
import { SubmitButton } from "@/components/submit-button";
import { BUTTON, BUTTON_CONFIRM, INPUT } from "@/components/ui";
import type { Finding } from "@/db/schema";
import { publishedText } from "@/github/publish";
import { COMMON_REJECT_REASONS, FindingShell, REASON_CHIP, REASON_QUESTION } from "./finding-view";

// An open Edit panel moves to its own full-width row under the buttons,
// instead of pushing the other buttons sideways.
const PANEL = "open:order-last open:basis-full";

function Ids({ finding }: { finding: Finding }) {
  return (
    <>
      <input type="hidden" name="reviewId" value={finding.reviewId} />
      <input type="hidden" name="findingId" value={finding.id} />
    </>
  );
}

/** Shown on a rejected finding: say why, now or later. Never required. */
function RejectionReason({ finding }: { finding: Finding }) {
  const reasonsId = `reasons-${finding.id}`;
  return (
    <form action={rejectFindingAction} className="mt-3 flex max-w-xl flex-wrap items-end gap-2">
      <Ids finding={finding} />
      <label className="min-w-0 flex-1 text-xs text-ink-soft">
        Why? (optional. The author never sees it, and the next review will not raise this again.)
        <input
          name="reason"
          maxLength={500}
          list={reasonsId}
          defaultValue={finding.rejectionReason ?? ""}
          placeholder="Pick a common reason or type your own"
          className={`mt-1 ${INPUT}`}
        />
      </label>
      <datalist id={reasonsId}>
        {COMMON_REJECT_REASONS.map((reason) => (
          <option key={reason} value={reason} />
        ))}
      </datalist>
      <SubmitButton className={BUTTON}>Save reason</SubmitButton>
    </form>
  );
}

/**
 * Shown under a finding that was just rejected: the common reasons, one
 * click each. Every chip is a submit button carrying its reason, so this
 * needs no JavaScript.
 */
function QuickReasons({ finding }: { finding: Finding }) {
  return (
    <form action={rejectFindingAction} className="flex flex-wrap items-center gap-1.5">
      <Ids finding={finding} />
      <span className="text-xs text-ink-soft">{REASON_QUESTION}</span>
      {COMMON_REJECT_REASONS.map((reason) => (
        <SubmitButton key={reason} name="reason" value={reason} className={REASON_CHIP}>
          {reason}
        </SubmitButton>
      ))}
    </form>
  );
}

/**
 * One finding with its controls. Plain HTML forms posting to server actions,
 * so the page works without JavaScript and there is no client state to keep
 * in sync with the database. The data-action attributes are what the keyboard
 * shortcuts press.
 *
 * Confirm and Reject are one click each. A reason for rejecting is asked for
 * afterwards and is optional, so the common case stays fast.
 */
export function FindingCard({ finding, locked }: { finding: Finding; locked: boolean }) {
  const text = publishedText(finding);
  const isHuman = finding.source === "human";
  const askWhy = !locked && finding.status === "rejected" && !finding.rejectionReason;

  return (
    <FindingShell
      finding={finding}
      fold={!locked}
      followUp={askWhy ? <QuickReasons finding={finding} /> : undefined}
    >
      {!locked && (
        <>
          <div className="mt-3 flex flex-wrap items-start gap-2">
            {/* A finding the reviewer wrote is not confirmed or rejected: it
                is edited or removed. */}
            {!isHuman && finding.status !== "confirmed" && (
              <form action={confirmFindingAction}>
                <Ids finding={finding} />
                <SubmitButton data-action="confirm" title="Send this finding to the author" className={BUTTON_CONFIRM}>
                  Confirm
                </SubmitButton>
              </form>
            )}

            {!isHuman && finding.status !== "rejected" && (
              <form action={rejectFindingAction}>
                <Ids finding={finding} />
                <SubmitButton data-action="reject" title="Do not send this finding" className={BUTTON}>
                  Reject
                </SubmitButton>
              </form>
            )}

            <details data-action="edit" className={PANEL}>
              <summary className={`${BUTTON} cursor-pointer list-none`}>Edit</summary>
              <form action={editFindingAction} className="mt-2 max-w-2xl">
                <Ids finding={finding} />
                <label className="text-xs text-ink-soft">
                  Explanation
                  <textarea name="explanation" required rows={4} defaultValue={text.explanation} className={`mt-1 ${INPUT}`} />
                </label>
                <label className="mt-2 block text-xs text-ink-soft">
                  Suggested fix (optional)
                  <textarea name="suggestedFix" rows={3} defaultValue={text.suggestedFix ?? ""} className={`mt-1 ${INPUT}`} />
                </label>
                <SubmitButton className={`${BUTTON} mt-2`}>{isHuman ? "Save" : "Save and confirm"}</SubmitButton>
              </form>
            </details>

            {isHuman && (
              <form action={removeFindingAction}>
                <Ids finding={finding} />
                <SubmitButton data-action="undo" className={`${BUTTON} text-ink-soft`}>
                  Remove
                </SubmitButton>
              </form>
            )}

            {!isHuman && finding.status !== "pending" && (
              <form action={resetFindingAction}>
                <Ids finding={finding} />
                <SubmitButton data-action="undo" title="Back to pending" className={`${BUTTON} text-ink-soft`}>
                  Undo
                </SubmitButton>
              </form>
            )}
          </div>

          {finding.status === "rejected" && <RejectionReason finding={finding} />}
        </>
      )}
    </FindingShell>
  );
}
