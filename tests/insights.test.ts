import { describe, expect, it } from "vitest";
import { NO_REASON, summarizeDecisions, summarizeWait, type DecidedFinding } from "@/dashboard/insights";
import type { FollowUpEntry } from "@/db/schema";

function finding(overrides: Partial<DecidedFinding> = {}): DecidedFinding {
  return {
    source: "ai",
    status: "confirmed",
    severity: "warning",
    category: "bug",
    edited: false,
    rejectionReason: null,
    ...overrides,
  };
}

function followUp(status: FollowUpEntry["status"]): FollowUpEntry {
  return { previousFindingId: 1, status, note: "", filePath: "a.ts", startLine: 1, severity: "warning", explanation: "" };
}

describe("summarizeDecisions", () => {
  it("has no rates when nothing was decided", () => {
    const insights = summarizeDecisions([]);

    expect(insights.decided).toBe(0);
    expect(insights.acceptanceRate).toBeNull();
    expect(insights.byCategory).toEqual([]);
    expect(insights.bySeverity.every((row) => row.rate === null)).toBe(true);
  });

  it("counts what the reviewer confirmed, rejected and rewrote", () => {
    const insights = summarizeDecisions([
      finding(),
      finding({ edited: true }),
      finding({ edited: true }),
      finding({ status: "rejected" }),
    ]);

    expect(insights).toMatchObject({ decided: 4, confirmed: 3, rejected: 1, edited: 2, acceptanceRate: 0.75 });
  });

  it("keeps findings the reviewer wrote out of the acceptance rate", () => {
    const insights = summarizeDecisions([
      finding({ status: "rejected" }),
      finding({ source: "human" }),
      finding({ source: "human" }),
    ]);

    // One AI finding, rejected. The two human findings would make it 67%.
    expect(insights.acceptanceRate).toBe(0);
    expect(insights.decided).toBe(1);
    expect(insights.addedByReviewers).toBe(2);
  });

  it("breaks the share down by severity, in severity order", () => {
    const insights = summarizeDecisions([
      finding({ severity: "nit", status: "rejected" }),
      finding({ severity: "nit", status: "rejected" }),
      finding({ severity: "nit" }),
      finding({ severity: "critical" }),
    ]);

    expect(insights.bySeverity.map((row) => row.key)).toEqual(["critical", "warning", "nit"]);
    expect(insights.bySeverity[0]).toMatchObject({ confirmed: 1, rejected: 0, rate: 1 });
    expect(insights.bySeverity[1]?.rate).toBeNull();
    expect(insights.bySeverity[2]).toMatchObject({ confirmed: 1, rejected: 2 });
    expect(insights.bySeverity[2]?.rate).toBeCloseTo(1 / 3);
  });

  it("lists only categories that have findings, busiest first", () => {
    const insights = summarizeDecisions([
      finding({ category: "security" }),
      finding({ category: "logic" }),
      finding({ category: "logic", status: "rejected" }),
    ]);

    expect(insights.byCategory.map((row) => row.key)).toEqual(["logic", "security"]);
  });

  it("groups rejection reasons, most common first, and names the missing ones", () => {
    const insights = summarizeDecisions([
      finding({ status: "rejected", rejectionReason: "Intended behaviour" }),
      finding({ status: "rejected", rejectionReason: " Intended behaviour " }),
      finding({ status: "rejected", rejectionReason: null }),
      // A confirmed finding has no reason to count, whatever is stored.
      finding({ status: "confirmed", rejectionReason: "Stale" }),
    ]);

    expect(insights.rejectionReasons).toEqual([
      { reason: "Intended behaviour", count: 2 },
      { reason: NO_REASON, count: 1 },
    ]);
  });

  it("adds up the verdicts from second reviews", () => {
    const insights = summarizeDecisions([], [followUp("fixed"), followUp("fixed"), followUp("still_present"), followUp("unclear")]);

    expect(insights.followUp).toEqual({ fixed: 2, stillPresent: 1, unclear: 1 });
  });
});

describe("summarizeWait", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 13, 12, minute));

  it("gives the median and longest wait from first pass to publish", () => {
    const wait = summarizeWait([
      { completedAt: at(0), publishedAt: at(10) },
      { completedAt: at(0), publishedAt: at(50) },
      { completedAt: at(0), publishedAt: at(30) },
    ]);
    expect(wait).toEqual({ median: 30, slowest: 50, count: 3 });
  });

  it("averages the two middle waits for an even count, and skips incomplete or negative ones", () => {
    const wait = summarizeWait([
      { completedAt: at(0), publishedAt: at(10) },
      { completedAt: at(0), publishedAt: at(20) },
      { completedAt: null, publishedAt: at(20) },
      { completedAt: at(30), publishedAt: at(20) },
    ]);
    expect(wait).toEqual({ median: 15, slowest: 20, count: 2 });
  });

  it("is null when no review has both times", () => {
    expect(summarizeWait([])).toBeNull();
    expect(summarizeWait([{ completedAt: null, publishedAt: null }])).toBeNull();
  });
});

