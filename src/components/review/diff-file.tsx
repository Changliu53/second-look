import type { DiffRow, FileView } from "@/dashboard/diff-view";
import type { Finding } from "@/db/schema";

const LINE_STYLES = {
  add: "bg-green-50/70",
  del: "bg-red-50/70",
  context: "",
} as const;

const MARKER_STYLES = {
  add: "text-green-700",
  del: "text-red-700",
  context: "text-slate-300",
} as const;

const MARKERS = { add: "+", del: "-", context: " " } as const;

type RenderFinding = (finding: Finding) => React.ReactNode;

function Row({
  row,
  plain,
  renderFinding,
}: {
  row: DiffRow;
  plain: boolean;
  renderFinding: RenderFinding;
}) {
  if (row.kind === "hunk") {
    return plain ? null : (
      <div className="border-y border-edge bg-slate-50 px-3 py-1 text-ink-soft">{row.header}</div>
    );
  }
  const { line, findings } = row;
  return (
    <>
      <div className={`flex ${plain ? "" : LINE_STYLES[line.kind]}`}>
        <span className="w-12 shrink-0 select-none pr-3 text-right text-slate-400">
          {line.newLine ?? ""}
        </span>
        {!plain && (
          <span className={`w-4 shrink-0 select-none ${MARKER_STYLES[line.kind]}`}>
            {MARKERS[line.kind]}
          </span>
        )}
        <span className="whitespace-pre-wrap break-all pr-3">{line.text}</span>
      </div>
      {findings.length > 0 && (
        <div className="border-y border-edge bg-slate-50 px-3 py-1">
          {findings.map((finding) => (
            <div key={finding.id}>{renderFinding(finding)}</div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * One file of a diff, with each finding shown under the line it points at.
 * `plain` is for a pasted snippet: it is not a change to anything, so the
 * "+" markers, green background, and hunk header would only be noise.
 */
export function DiffFile({
  file,
  renderFinding,
  plain = false,
  title,
  skippedAs,
}: {
  file: FileView;
  renderFinding: RenderFinding;
  plain?: boolean;
  title?: string;
  /** Set for files the AI did not review, which start folded away. */
  skippedAs?: string;
}) {
  if (skippedAs) {
    return (
      <details className="mt-5 overflow-hidden rounded-lg border border-edge bg-surface-raised">
        <summary className="flex cursor-pointer items-center gap-2 bg-slate-50 px-3 py-2 font-mono text-xs">
          <span className="break-all">{file.path}</span>
          <span className="font-sans text-ink-soft">
            {skippedAs} file, not reviewed. Click to show.
          </span>
        </summary>
        <div className="border-t border-edge font-mono text-xs leading-5">
          {file.rows.map((row, index) => (
            <Row key={index} row={row} plain={false} renderFinding={renderFinding} />
          ))}
        </div>
      </details>
    );
  }
  return (
    <section className="mt-5 overflow-hidden rounded-lg border border-edge bg-surface-raised">
      <h3 className="flex items-center gap-2 border-b border-edge bg-slate-50 px-3 py-2 font-mono text-xs font-medium">
        <span className="break-all">{title ?? file.path}</span>
        {!plain && <span className="font-sans font-normal text-ink-soft">{file.status}</span>}
      </h3>
      <div className={`font-mono text-xs leading-5 ${plain ? "py-1" : ""}`}>
        {file.rows.map((row, index) => (
          <Row key={index} row={row} plain={plain} renderFinding={renderFinding} />
        ))}
      </div>
    </section>
  );
}
