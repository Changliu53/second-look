import type { Finding, FindingEvent } from "@/db/schema";
import { SECTION_LABEL } from "@/components/ui";

const VERBS: Record<FindingEvent["action"], string> = {
  confirmed: "confirmed",
  rejected: "rejected",
  reset: "moved back to pending",
  edited: "rewrote",
  added: "added",
  removed: "removed",
};

/** "WorkOrdersController.cs:70", or a plain description for a deleted finding. */
function describe(event: FindingEvent, byId: Map<number, Finding>): string {
  const finding = byId.get(event.findingId);
  if (!finding) {
    return "a finding they had written";
  }
  const file = finding.filePath.split("/").pop() ?? finding.filePath;
  const owner = finding.source === "human" ? "their finding" : `the ${finding.severity} finding`;
  return `${owner} on ${file}:${finding.startLine}`;
}

/** Minutes are enough for a review; the time zone is said, not guessed. */
function formatTime(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Everything reviewers did on this review, oldest first: who confirmed,
 * rejected, rewrote, added, or removed which finding, and when. The finding
 * cards show only where each finding ended up; this shows how it got there.
 */
export function ActivityLog({ events, findings }: { events: FindingEvent[]; findings: Finding[] }) {
  if (events.length === 0) {
    return null;
  }
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  return (
    <details className="mt-8 rounded-lg border border-edge bg-surface-raised">
      <summary className="cursor-pointer px-4 py-2.5">
        <span className={SECTION_LABEL}>Activity on this review</span>
        <span className="ml-2 text-xs text-ink-soft">{events.length} change{events.length === 1 ? "" : "s"}</span>
      </summary>
      <ol className="divide-y divide-edge border-t border-edge text-sm">
        {events.map((event) => (
          <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2">
            <time dateTime={event.createdAt.toISOString()} className="w-36 shrink-0 font-mono text-xs text-ink-soft">
              {formatTime(event.createdAt)}
            </time>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{event.actor}</span> {VERBS[event.action]}{" "}
              {describe(event, byId)}
              {event.detail && <span className="text-ink-soft">: {event.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
