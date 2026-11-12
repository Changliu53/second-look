import type { DiffRow, FileView } from "@/dashboard/diff-view";
import { FindingCard } from "./finding-card";

const LINE_STYLES = {
  add: "bg-green-50",
  del: "bg-red-50",
  context: "",
} as const;

const MARKERS = { add: "+", del: "-", context: " " } as const;

function Row({ row, locked }: { row: DiffRow; locked: boolean }) {
  if (row.kind === "hunk") {
    return <div className="bg-slate-100 px-2 py-1 text-slate-500">{row.header}</div>;
  }
  const { line, findings } = row;
  return (
    <>
      <div className={`flex ${LINE_STYLES[line.kind]}`}>
        <span className="w-12 shrink-0 select-none pr-2 text-right text-slate-400">
          {line.newLine ?? ""}
        </span>
        <span className="w-4 shrink-0 select-none text-slate-500">{MARKERS[line.kind]}</span>
        <span className="whitespace-pre-wrap break-all">{line.text}</span>
      </div>
      {findings.length > 0 && (
        <div className="border-y border-slate-200 bg-slate-50 px-3 py-1">
          {findings.map((finding) => (
            <FindingCard key={finding.id} finding={finding} locked={locked} />
          ))}
        </div>
      )}
    </>
  );
}

export function DiffFile({ file, locked }: { file: FileView; locked: boolean }) {
  return (
    <section className="mt-6 overflow-hidden rounded border border-slate-200">
      <h3 className="border-b border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-medium">
        {file.path} <span className="font-normal text-slate-500">({file.status})</span>
      </h3>
      <div className="font-mono text-xs leading-5">
        {file.rows.map((row, index) => (
          <Row key={index} row={row} locked={locked} />
        ))}
      </div>
    </section>
  );
}
