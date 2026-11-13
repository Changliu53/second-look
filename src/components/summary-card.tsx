import type { ReviewSummary } from "@/review/schema";
import { RiskBadge } from "./badges";
import { SECTION_LABEL } from "./ui";

/** The plain-English summary the tool writes for the PR author. */
export function SummaryCard({ summary }: { summary: ReviewSummary }) {
  return (
    <section className="rounded-lg border border-edge bg-surface-raised p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={SECTION_LABEL}>Summary for the author</h2>
        <RiskBadge riskLevel={summary.riskLevel} />
      </div>
      <p className="mt-2 text-sm leading-relaxed">{summary.whatChanged}</p>
      {summary.doubleCheck.length > 0 && (
        <>
          <h3 className={`mt-3 ${SECTION_LABEL}`}>Ask them to double check</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {summary.doubleCheck.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
