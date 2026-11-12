import type { ReviewSummary } from "@/review/schema";
import { RiskBadge } from "./badges";

export function SummaryCard({ summary }: { summary: ReviewSummary }) {
  return (
    <section className="rounded border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Summary for the author</h2>
        <RiskBadge riskLevel={summary.riskLevel} />
      </div>
      <p className="mt-2 text-sm text-slate-800">{summary.whatChanged}</p>
      {summary.doubleCheck.length > 0 && (
        <>
          <h3 className="mt-3 text-sm font-medium">Double check</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-slate-800">
            {summary.doubleCheck.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
