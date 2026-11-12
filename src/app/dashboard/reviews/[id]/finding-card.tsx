import { CategoryBadge, SeverityBadge } from "@/components/badges";
import type { Finding } from "@/db/schema";
import { publishedText } from "@/github/publish";
import {
  confirmFindingAction,
  editFindingAction,
  rejectFindingAction,
  resetFindingAction,
} from "../../actions";

const STATUS_STYLES: Record<Finding["status"], string> = {
  pending: "border-l-slate-400",
  confirmed: "border-l-green-600",
  rejected: "border-l-slate-300 opacity-60",
};

const BUTTON = "rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium hover:bg-slate-50";
const INPUT = "mt-1 block w-full rounded border border-slate-300 p-1 text-xs";

function Ids({ finding }: { finding: Finding }) {
  return (
    <>
      <input type="hidden" name="reviewId" value={finding.reviewId} />
      <input type="hidden" name="findingId" value={finding.id} />
    </>
  );
}

function lineLabel(finding: Finding): string {
  return finding.startLine === finding.endLine
    ? `${finding.filePath}:${finding.startLine}`
    : `${finding.filePath}:${finding.startLine}-${finding.endLine}`;
}

/**
 * One finding with its Confirm / Reject / Edit controls. Plain HTML forms and
 * <details> elements posting to server actions, so there is no client-side
 * state to keep in sync with the database.
 */
export function FindingCard({ finding, locked }: { finding: Finding; locked: boolean }) {
  const text = publishedText(finding);
  const wasEdited = finding.editedExplanation !== null;

  return (
    <div className={`my-2 rounded border border-l-4 border-slate-200 bg-white p-3 font-sans text-sm ${STATUS_STYLES[finding.status]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={finding.severity} />
        <CategoryBadge category={finding.category} />
        <span className="font-mono text-xs text-slate-600">{lineLabel(finding)}</span>
        <span className="text-xs text-slate-500">
          confidence {Math.round(finding.confidence * 100)}%
        </span>
        <span className="ml-auto text-xs font-medium uppercase text-slate-600">
          {finding.status}
          {finding.decidedBy && ` by ${finding.decidedBy}`}
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap">{text.explanation}</p>
      {text.suggestedFix && (
        <p className="mt-2 whitespace-pre-wrap text-slate-700">
          <span className="font-medium">Suggested fix: </span>
          {text.suggestedFix}
        </p>
      )}
      {wasEdited && (
        <details className="mt-2 text-xs text-slate-500">
          <summary className="cursor-pointer">Edited. Show the original AI text</summary>
          <p className="mt-1 whitespace-pre-wrap">{finding.explanation}</p>
        </details>
      )}
      {finding.status === "rejected" && finding.rejectionReason && (
        <p className="mt-2 text-xs text-slate-600">Reason: {finding.rejectionReason}</p>
      )}

      {!locked && (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {finding.status !== "confirmed" && (
            <form action={confirmFindingAction}>
              <Ids finding={finding} />
              <button className={`${BUTTON} border-green-600 text-green-800`}>Confirm</button>
            </form>
          )}

          {finding.status !== "rejected" && (
            <details>
              <summary className={`${BUTTON} inline-block cursor-pointer list-none`}>Reject</summary>
              <form action={rejectFindingAction} className="mt-2 w-72">
                <Ids finding={finding} />
                <label className="text-xs text-slate-600">
                  Reason (optional)
                  <input name="reason" maxLength={500} className={INPUT} />
                </label>
                <button className={`${BUTTON} mt-2`}>Reject finding</button>
              </form>
            </details>
          )}

          <details>
            <summary className={`${BUTTON} inline-block cursor-pointer list-none`}>Edit</summary>
            <form action={editFindingAction} className="mt-2 w-96 max-w-full">
              <Ids finding={finding} />
              <label className="text-xs text-slate-600">
                Explanation
                <textarea name="explanation" required rows={4} defaultValue={text.explanation} className={INPUT} />
              </label>
              <label className="mt-2 block text-xs text-slate-600">
                Suggested fix (optional)
                <textarea name="suggestedFix" rows={3} defaultValue={text.suggestedFix ?? ""} className={INPUT} />
              </label>
              <button className={`${BUTTON} mt-2`}>Save and confirm</button>
            </form>
          </details>

          {finding.status !== "pending" && (
            <form action={resetFindingAction}>
              <Ids finding={finding} />
              <button className={`${BUTTON} text-slate-600`}>Undo</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
