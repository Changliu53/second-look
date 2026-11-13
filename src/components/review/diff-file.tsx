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

/**
 * Hooks for adding a finding on a line. `lineNumber` replaces the plain
 * number (with a link or a button), and `afterLine` puts something under a
 * line, which is where the form for a new finding opens.
 */
/**
 * What goes in the gutter of a line that can take a new finding: a "+" that
 * appears when the line is hovered or focused, then the line number. The
 * caller wraps it in a link or a button.
 */
export function AddOnLine({ line }: { line: number }) {
  return (
    <span className="flex items-center justify-end gap-1.5">
      <span
        aria-hidden
        // Faint on every line, so it can be found without knowing to hover;
        // full on the hovered line; full everywhere on a touch screen,
        // which has no hover.
        className="grid size-4 place-items-center rounded bg-accent text-[0.6875rem] font-bold leading-none text-white opacity-20 transition-opacity group-hover/line:opacity-100 group-focus-within/line:opacity-100 [@media(hover:none)]:opacity-100"
      >
        +
      </span>
      {line}
    </span>
  );
}

export type LineSlots = {
  lineNumber?: (newLine: number) => React.ReactNode;
  afterLine?: (newLine: number) => React.ReactNode;
};

function Row({
  row,
  plain,
  renderFinding,
  slots,
}: {
  row: DiffRow;
  plain: boolean;
  renderFinding: RenderFinding;
  slots: LineSlots;
}) {
  if (row.kind === "hunk") {
    return plain ? null : (
      <div className="border-y border-edge bg-slate-50 px-3 py-1 text-ink-soft">{row.header}</div>
    );
  }
  const { line, findings } = row;
  return (
    <>
      <div className={`group/line flex ${plain ? "" : LINE_STYLES[line.kind]}`}>
        <span className={`${slots.lineNumber ? "w-16" : "w-12"} shrink-0 select-none pr-3 text-right text-slate-500`}>
          {line.newLine === null ? "" : (slots.lineNumber?.(line.newLine) ?? line.newLine)}
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
      {line.newLine !== null && slots.afterLine?.(line.newLine)}
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
  foldedNote,
  githubHref,
  slots = {},
}: {
  file: FileView;
  renderFinding: RenderFinding;
  plain?: boolean;
  title?: string;
  /** Set for files the AI did not review, which start folded away. */
  skippedAs?: string;
  /**
   * Set to start a reviewed file folded, with this note on its folded line.
   * Used for files without findings in a long diff.
   */
  foldedNote?: string;
  /** The file at the reviewed commit on GitHub, for reading it whole. */
  githubHref?: string;
  slots?: LineSlots;
}) {
  const foldNote = skippedAs ? `${skippedAs} file, not reviewed. Click to show.` : foldedNote;
  if (foldNote) {
    return (
      <details className="mt-5 overflow-hidden rounded-lg border border-edge bg-surface-raised">
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 bg-slate-50 px-3 py-2 font-mono text-xs">
          <span className="break-all">{file.path}</span>
          <span className="font-sans text-ink-soft">{foldNote}</span>
        </summary>
        <div className="border-t border-edge font-mono text-xs leading-5">
          {file.rows.map((row, index) => (
            <Row key={index} row={row} plain={false} renderFinding={renderFinding} slots={slots} />
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
        {githubHref && file.status !== "deleted" && (
          <a
            href={githubHref}
            target="_blank"
            rel="noreferrer"
            className="ml-auto shrink-0 font-sans font-normal text-accent underline-offset-2 hover:underline"
          >
            Whole file on GitHub
          </a>
        )}
      </h3>
      <div className={`font-mono text-xs leading-5 ${plain ? "py-1" : ""}`}>
        {file.rows.map((row, index) => (
          <Row key={index} row={row} plain={plain} renderFinding={renderFinding} slots={slots} />
        ))}
      </div>
    </section>
  );
}
