import { SeverityBadge } from "@/components/badges";
import { InlineText } from "@/components/markdown-lite";
import { SECTION_LABEL } from "@/components/ui";
import type { FollowUpEntry } from "@/db/schema";

const STATUS: Record<FollowUpEntry["status"], { label: string; className: string; mark: string }> = {
  fixed: { label: "Fixed", className: "text-green-700", mark: "✓" },
  still_present: { label: "Still there", className: "text-red-700", mark: "✗" },
  unclear: { label: "Cannot tell", className: "text-amber-700", mark: "?" },
};

/**
 * Shown on a review of a pull request that was reviewed before: what became
 * of each finding the reviewer sent last time. This is the verification pass,
 * so the reviewer does not have to compare the two commits by hand.
 */
export function FollowUpPanel({ entries }: { entries: FollowUpEntry[] }) {
  const fixed = entries.filter((entry) => entry.status === "fixed").length;
  // What still needs attention comes first.
  const order = { still_present: 0, unclear: 1, fixed: 2 } as const;
  const sorted = [...entries].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <section className="mt-4 rounded-lg border border-edge bg-surface-raised p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className={SECTION_LABEL}>Since the last review</h2>
        <span className="text-sm">
          <span className="font-semibold">{fixed}</span> of {entries.length} sent finding
          {entries.length === 1 ? "" : "s"} fixed
        </span>
      </div>
      <ul className="mt-3 space-y-2.5">
        {sorted.map((entry) => (
          <li key={entry.previousFindingId} className="flex gap-3 text-sm">
            <span className={`w-24 shrink-0 font-semibold ${STATUS[entry.status].className}`}>
              {STATUS[entry.status].mark} {STATUS[entry.status].label}
            </span>
            <span className="min-w-0">
              <span className="mr-2 align-middle">
                <SeverityBadge severity={entry.severity} />
              </span>
              {/* A fixed finding needs one line; one that is still there is shown in full. */}
              <span className={entry.status === "fixed" ? "line-clamp-1 text-ink-soft" : ""}>
                <InlineText text={entry.explanation} />
              </span>
              <span className="mt-0.5 block text-xs text-ink-soft">
                <InlineText text={entry.note} />
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-soft">
        This is the model&apos;s reading of the new commit. Findings you rejected last time were
        not raised again.
      </p>
    </section>
  );
}
