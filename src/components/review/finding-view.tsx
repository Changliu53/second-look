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

/** Reasons a reviewer rejects a finding most often, offered as suggestions. */
export const COMMON_REJECT_REASONS = [
  "Not a real problem here",
  "Handled elsewhere in the codebase",
  "Intended behaviour",
  "Out of scope for this pull request",
  "Too minor to send",
];
