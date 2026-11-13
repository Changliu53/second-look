import type { FollowUpEntry } from "@/db/schema";
import { CATEGORIES, SEVERITIES, type Category, type Severity } from "@/review/schema";

/**
 * What reviewers did with the first pass's findings, added up. This is the
 * measurement the product has for free: every Confirm and Reject is a human
 * saying whether a finding was worth sending. It reads stored decisions only
 * and calls no model.
 */

/** One finding of a published review, reduced to what the totals need. */
export type DecidedFinding = {
  source: "ai" | "human";
  status: "confirmed" | "rejected";
  severity: Severity;
  category: Category;
  /** The reviewer rewrote the text before sending it. */
  edited: boolean;
  rejectionReason: string | null;
};

export type Tally = {
  key: string;
  confirmed: number;
  rejected: number;
  /** Confirmed share of the two, from 0 to 1. Null when there is nothing to divide. */
  rate: number | null;
};

export type Insights = {
  /** AI findings a reviewer decided on. */
  decided: number;
  confirmed: number;
  rejected: number;
  acceptanceRate: number | null;
  /** Confirmed AI findings the reviewer rewrote first. */
  edited: number;
  /** Findings reviewers wrote themselves: what the first pass missed. */
  addedByReviewers: number;
  bySeverity: Tally[];
  byCategory: Tally[];
  rejectionReasons: Array<{ reason: string; count: number }>;
  /** Verdicts on sent findings when the pull request was reviewed again. */
  followUp: { fixed: number; stillPresent: number; unclear: number };
  /**
   * Minutes from the first pass finishing to a reviewer publishing: how long
   * an author waits on a person. Null when no review has both times.
   */
  waitMinutes: { median: number; slowest: number; count: number } | null;
};

/** Start and end of the wait for a person, per published review. */
export type ReviewTimes = { completedAt: Date | null; publishedAt: Date | null };

export const NO_REASON = "No reason given";
const TOP_REASONS = 6;

function rate(confirmed: number, rejected: number): number | null {
  const total = confirmed + rejected;
  return total === 0 ? null : confirmed / total;
}

function tally(key: string, findings: DecidedFinding[]): Tally {
  const confirmed = findings.filter((f) => f.status === "confirmed").length;
  const rejected = findings.length - confirmed;
  return { key, confirmed, rejected, rate: rate(confirmed, rejected) };
}

function countReasons(rejected: DecidedFinding[]): Insights["rejectionReasons"] {
  const counts = new Map<string, number>();
  for (const finding of rejected) {
    const reason = finding.rejectionReason?.trim() || NO_REASON;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts]
    .map(([reason, count]) => ({ reason, count }))
    // Most common first; equal counts in a fixed order so the page is stable.
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, TOP_REASONS);
}

/** The middle value; for an even count, the mean of the two middle ones. */
function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function summarizeWait(times: ReviewTimes[]): Insights["waitMinutes"] {
  const minutes = times
    .flatMap(({ completedAt, publishedAt }) =>
      completedAt && publishedAt ? [(publishedAt.getTime() - completedAt.getTime()) / 60_000] : [],
    )
    // A negative wait is clock skew between writes, not a real wait.
    .filter((value) => value >= 0)
    .sort((a, b) => a - b);
  if (minutes.length === 0) {
    return null;
  }
  return {
    median: Math.round(median(minutes)),
    slowest: Math.round(minutes.at(-1)!),
    count: minutes.length,
  };
}

export function summarizeDecisions(
  findings: DecidedFinding[],
  followUps: FollowUpEntry[] = [],
  times: ReviewTimes[] = [],
): Insights {
  // Acceptance is about the AI's findings. A finding the reviewer wrote is
  // always "confirmed" and would flatter the number.
  const ai = findings.filter((finding) => finding.source === "ai");
  const confirmed = ai.filter((finding) => finding.status === "confirmed");
  const rejected = ai.filter((finding) => finding.status === "rejected");

  return {
    decided: ai.length,
    confirmed: confirmed.length,
    rejected: rejected.length,
    acceptanceRate: rate(confirmed.length, rejected.length),
    edited: confirmed.filter((finding) => finding.edited).length,
    addedByReviewers: findings.length - ai.length,
    bySeverity: SEVERITIES.map((severity) =>
      tally(severity, ai.filter((finding) => finding.severity === severity)),
    ),
    byCategory: CATEGORIES.map((category) =>
      tally(category, ai.filter((finding) => finding.category === category)),
    )
      .filter((row) => row.confirmed + row.rejected > 0)
      .sort((a, b) => b.confirmed + b.rejected - (a.confirmed + a.rejected) || a.key.localeCompare(b.key)),
    rejectionReasons: countReasons(rejected),
    followUp: {
      fixed: followUps.filter((entry) => entry.status === "fixed").length,
      stillPresent: followUps.filter((entry) => entry.status === "still_present").length,
      unclear: followUps.filter((entry) => entry.status === "unclear").length,
    },
    waitMinutes: summarizeWait(times),
  };
}
