import type { ReviewSummary } from "@/review/schema";
import { RiskBadge } from "./badges";
import { SECTION_LABEL } from "./ui";

/**
 * The first pass's plain-English summary, for the reviewer only. It is
 * written before anyone decides on the findings, so it can mention one the
 * reviewer goes on to reject, and it is never sent to the author.
 */
export function SummaryCard({ summary }: { summary: ReviewSummary }) {
  return (
    <section className="rounded-lg border border-edge bg-surface-raised p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={SECTION_LABEL}>First pass summary</h2>
        <RiskBadge riskLevel={summary.riskLevel} />
      </div>
      <p className="mt-2 text-sm leading-relaxed">{summary.whatChanged}</p>
      {summary.doubleCheck.length > 0 && (
        <>
          <h3 className={`mt-3 ${SECTION_LABEL}`}>Worth checking</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {summary.doubleCheck.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-3 text-xs text-ink-soft">For you. It is not sent to the author.</p>
    </section>
  );
}
