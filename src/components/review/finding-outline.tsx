import { SeverityBadge } from "@/components/badges";
import { InlineText } from "@/components/markdown-lite";
import type { Finding } from "@/db/schema";
import { publishedText } from "@/github/publish";
import { lineLabel } from "./finding-view";

const SEVERITY_ORDER = { critical: 0, warning: 1, nit: 2 } as const;

const STATUS_MARK: Record<Finding["status"], { text: string; className: string }> = {
  pending: { text: "pending", className: "text-ink-soft" },
  confirmed: { text: "confirmed", className: "text-green-700" },
  rejected: { text: "rejected", className: "text-ink-soft line-through" },
};

/**
 * A table of contents for a review: every finding on one line, worst first,
 * each linking to its place in the diff. Answers "how bad is this pull
 * request?" before the reviewer starts scrolling.
 */
export function FindingOutline({ findings }: { findings: Finding[] }) {
  const ordered = [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.startLine - b.startLine,
  );

  return (
    <ol className="divide-y divide-edge overflow-hidden rounded-lg border border-edge bg-surface-raised">
      {ordered.map((finding) => (
        <li key={finding.id}>
          <a
            href={`#finding-${finding.id}`}
            className="flex items-center gap-3 px-3 py-2 text-sm transition hover:bg-accent-soft"
          >
            <span className="w-[4.5rem] shrink-0">
              <SeverityBadge severity={finding.severity} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              <InlineText text={publishedText(finding).explanation} />
            </span>
            <span className="hidden shrink-0 font-mono text-xs text-ink-soft sm:inline">
              {lineLabel(finding)}
            </span>
            <span className={`w-16 shrink-0 text-right text-xs ${STATUS_MARK[finding.status].className}`}>
              {STATUS_MARK[finding.status].text}
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}
