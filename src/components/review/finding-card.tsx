import {
  confirmFindingAction,
  editFindingAction,
  rejectFindingAction,
  resetFindingAction,
} from "@/app/dashboard/actions";
import { BUTTON, BUTTON_CONFIRM, INPUT } from "@/components/ui";
import type { Finding } from "@/db/schema";
import { publishedText } from "@/github/publish";
import {
  COMMON_REJECT_REASONS,
  FindingFrame,
  FindingHeader,
  FindingText,
} from "./finding-view";

function Ids({ finding }: { finding: Finding }) {
  return (
    <>
      <input type="hidden" name="reviewId" value={finding.reviewId} />
      <input type="hidden" name="findingId" value={finding.id} />
    </>
  );
}

/**
 * One finding with its Confirm / Reject / Edit controls. Plain HTML forms and
 * <details> elements posting to server actions, so the page works without
 * JavaScript and there is no client state to keep in sync with the database.
 * The data-action attributes are what the keyboard shortcuts press.
 */
export function FindingCard({ finding, locked }: { finding: Finding; locked: boolean }) {
  const text = publishedText(finding);
  const reasonsId = `reasons-${finding.id}`;

  return (
    <FindingFrame finding={finding}>
      <FindingHeader finding={finding} />
      <FindingText finding={finding} />

      {!locked && (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {finding.status !== "confirmed" && (
            <form action={confirmFindingAction}>
              <Ids finding={finding} />
              <button data-action="confirm" className={BUTTON_CONFIRM}>
                Confirm
              </button>
            </form>
          )}

          {finding.status !== "rejected" && (
            <details data-action="reject">
              <summary className={`${BUTTON} cursor-pointer list-none`}>Reject</summary>
              <form action={rejectFindingAction} className="mt-2 w-80 max-w-full">
                <Ids finding={finding} />
                <label className="text-xs text-ink-soft">
                  Reason (optional, the author never sees it)
                  <input name="reason" maxLength={500} list={reasonsId} className={`mt-1 ${INPUT}`} />
                </label>
                <datalist id={reasonsId}>
                  {COMMON_REJECT_REASONS.map((reason) => (
                    <option key={reason} value={reason} />
                  ))}
                </datalist>
                <button className={`${BUTTON} mt-2`}>Reject finding</button>
              </form>
            </details>
          )}

          <details data-action="edit">
            <summary className={`${BUTTON} cursor-pointer list-none`}>Edit</summary>
            <form action={editFindingAction} className="mt-2 w-[28rem] max-w-full">
              <Ids finding={finding} />
              <label className="text-xs text-ink-soft">
                Explanation
                <textarea name="explanation" required rows={4} defaultValue={text.explanation} className={`mt-1 ${INPUT}`} />
              </label>
              <label className="mt-2 block text-xs text-ink-soft">
                Suggested fix (optional)
                <textarea name="suggestedFix" rows={3} defaultValue={text.suggestedFix ?? ""} className={`mt-1 ${INPUT}`} />
              </label>
              <button className={`${BUTTON} mt-2`}>Save and confirm</button>
            </form>
          </details>

          {finding.status !== "pending" && (
            <form action={resetFindingAction}>
              <Ids finding={finding} />
              <button data-action="undo" className={`${BUTTON} text-ink-soft`}>
                Undo
              </button>
            </form>
          )}
        </div>
      )}
    </FindingFrame>
  );
}
