import { CategoryBadge, SeverityBadge } from "@/components/badges";
import { InlineText } from "@/components/markdown-lite";
import type { Finding } from "@/db/schema";
import { publishedText } from "@/github/publish";
import { PASTED_FILE_NAME } from "@/review/paste";

/**
 * The read-only parts of a finding. The reviewer's dashboard and the home
 * page sandbox wrap this with different controls: server actions in one,
 * local state in the other.
 */

const STATUS_BORDER: Record<Finding["status"], string> = {
  pending: "border-l-slate-400",
  confirmed: "border-l-green-600",
  rejected: "border-l-slate-300",
};

const STATUS_TEXT: Record<Finding["status"], string> = {
  pending: "text-ink-soft",
  confirmed: "text-green-700",
  rejected: "text-ink-soft",
};

export function lineLabel(finding: Finding): string {
  const name = finding.filePath.split("/").pop() ?? finding.filePath;
  // A pasted snippet has no file name worth showing.
  const file = name === PASTED_FILE_NAME ? "line" : name;
  return finding.startLine === finding.endLine
    ? `${file}${file === "line" ? " " : ":"}${finding.startLine}`
    : `${file}${file === "line" ? "s " : ":"}${finding.startLine}-${finding.endLine}`;
}

export function FindingFrame({
  finding,
  active = false,
  children,
}: {
  finding: Finding;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article
      id={`finding-${finding.id}`}
      data-finding={finding.id}
      data-status={finding.status}
      data-active={active}
      className={`my-2 rounded-md border border-l-4 border-edge bg-surface-raised p-3 font-sans text-sm shadow-xs ${STATUS_BORDER[finding.status]}`}
    >
      {children}
    </article>
  );
}

export function FindingHeader({ finding }: { finding: Finding }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SeverityBadge severity={finding.severity} />
      <CategoryBadge category={finding.category} />
      <span className="font-mono text-xs text-ink-soft" title={finding.filePath}>
        {lineLabel(finding)}
      </span>
      {finding.source === "human" ? (
        <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-white">
          Added by reviewer
        </span>
      ) : (
        <span className="text-xs text-ink-soft">{Math.round(finding.confidence * 100)}% sure</span>
      )}
      <span className={`ml-auto text-[0.6875rem] font-semibold uppercase tracking-wide ${STATUS_TEXT[finding.status]}`}>
        {finding.source === "human" ? "written" : finding.status}
        {finding.decidedBy && ` by ${finding.decidedBy}`}
      </span>
    </div>
  );
}

export function FindingText({ finding }: { finding: Finding }) {
  const text = publishedText(finding);
  const wasEdited = finding.editedExplanation !== null;
  const dimmed = finding.status === "rejected" ? "opacity-60" : "";

  return (
    <div className={dimmed}>
      <p className="mt-2 whitespace-pre-wrap leading-relaxed">
        <InlineText text={text.explanation} />
      </p>
      {text.suggestedFix && (
        <p className="mt-2 whitespace-pre-wrap rounded bg-slate-50 px-2.5 py-2 leading-relaxed text-slate-800">
          <span className="font-semibold">Suggested fix: </span>
          <InlineText text={text.suggestedFix} />
        </p>
      )}
      {wasEdited && (
        <details className="mt-2 text-xs text-ink-soft">
          <summary className="cursor-pointer">Edited by the reviewer. Show the original AI text</summary>
          <p className="mt-1 whitespace-pre-wrap">{finding.explanation}</p>
        </details>
      )}
      {finding.status === "rejected" && finding.rejectionReason && (
        <p className="mt-2 text-xs text-ink-soft">
          <span className="font-semibold">Why rejected:</span> {finding.rejectionReason}
        </p>
      )}
    </div>
  );
}

const DECIDED_MARK: Record<"confirmed" | "rejected" | "human", { mark: string; label: string; className: string }> = {
  confirmed: { mark: "✓", label: "Confirmed", className: "text-green-700" },
  rejected: { mark: "✕", label: "Rejected", className: "text-ink-soft" },
  human: { mark: "✎", label: "Yours", className: "text-green-700" },
};

/** Changes whenever the reviewer decides, re-decides, or rewrites a finding. */
function decisionKey(finding: Finding): string {
  const decidedAt = finding.decidedAt ? new Date(finding.decidedAt).getTime() : 0;
  return `${finding.status}:${decidedAt}:${finding.editedExplanation?.length ?? 0}:${finding.rejectionReason ?? ""}`;
}

/**
 * The whole card for a finding: header, text, and whatever controls the
 * caller passes as children.
 *
 * A pending finding is shown in full, because it needs a decision. Once it is
 * decided it folds to one line, so a long review shrinks as the reviewer
 * works through it and what is left to do stands out. Opening the line shows
 * everything again, including the controls to change the decision.
 *
 * `followUp` is shown under the folded line and hidden once the card is
 * opened. It is for the one question worth asking right after a decision
 * (why was this rejected?) without making the reviewer open the card.
 *
 * Folding is for someone working through a review. A published review is
 * read, not worked through, so there `fold` is false and every finding is
 * shown in full.
 */
export function FindingShell({
  finding,
  fold = true,
  followUp,
  children,
}: {
  finding: Finding;
  fold?: boolean;
  followUp?: React.ReactNode;
  children?: React.ReactNode;
}) {
  if (finding.status === "pending" || !fold) {
    return (
      <FindingFrame finding={finding}>
        <FindingHeader finding={finding} />
        <FindingText finding={finding} />
        {children}
      </FindingFrame>
    );
  }

  const decided = DECIDED_MARK[finding.source === "human" ? "human" : finding.status];
  return (
    <FindingFrame finding={finding}>
      {/* The key changes with every decision, so a card the reviewer opened
          to change their mind folds again once they have, the same as after
          a first decision. Without it the browser keeps the old <details>
          open, and a reject made from an open card showed no reasons. */}
      <details key={decisionKey(finding)} data-collapsible className="peer group/fold">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
          <span className={`shrink-0 text-xs font-semibold sm:w-24 ${decided.className}`}>
            {decided.mark} {decided.label}
          </span>
          <SeverityBadge severity={finding.severity} />
          <span className={`min-w-0 flex-1 truncate ${finding.status === "rejected" ? "text-ink-soft line-through" : ""}`}>
            <InlineText text={publishedText(finding).explanation} />
          </span>
          {finding.status === "rejected" && finding.rejectionReason && (
            <span
              className="hidden max-w-56 shrink-0 truncate rounded-full bg-slate-100 px-2 py-0.5 text-xs text-ink-soft sm:inline"
              title={`Why rejected: ${finding.rejectionReason}`}
            >
              {finding.rejectionReason}
            </span>
          )}
          <span className="shrink-0 text-xs text-accent group-open/fold:hidden">Open</span>
          <span className="hidden shrink-0 text-xs text-accent group-open/fold:inline">Close</span>
        </summary>
        <div className="mt-3 border-t border-edge pt-3">
          <FindingHeader finding={finding} />
          <FindingText finding={finding} />
          {children}
        </div>
      </details>
      {followUp && <div className="mt-2 peer-open:hidden">{followUp}</div>}
    </FindingFrame>
  );
}

/** A suggested rejection reason, one click to choose. */
export const REASON_CHIP =
  "rounded-full border border-edge px-2 py-0.5 text-xs text-ink-soft transition hover:border-slate-400 hover:text-ink aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-ink";

/** Asked right after a rejection. The answer is optional. */
export const REASON_QUESTION = "Why? (optional)";

/** Reasons a reviewer rejects a finding most often, offered as suggestions. */
export const COMMON_REJECT_REASONS = [
  "Not a real problem here",
  "Handled elsewhere in the codebase",
  "Intended behaviour",
  "Out of scope for this pull request",
  "Too minor to send",
];
