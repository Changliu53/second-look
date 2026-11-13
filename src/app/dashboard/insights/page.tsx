import Link from "next/link";
import { redirect } from "next/navigation";
import { getSignedInLogin } from "@/auth";
import { SiteHeader } from "@/components/site-header";
import { LINK, SECTION_LABEL } from "@/components/ui";
import { suggestRules, type Tally } from "@/dashboard/insights";
import { CopyButton } from "@/components/copy-button";
import { getInsightsFor, INSIGHT_PERIODS, type InsightPeriod } from "@/dashboard/service";
import { dashboardDeps } from "../deps";

export const dynamic = "force-dynamic";

function percent(rate: number | null): string {
  return rate === null ? "none yet" : `${Math.round(rate * 100)}%`;
}

/** "45 min", "3 h 10 min", "2 days 4 h". */
function duration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return `${days} day${days === 1 ? "" : "s"}${restHours ? ` ${restHours} h` : ""}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-edge bg-surface-raised p-4">
      <p className={SECTION_LABEL}>{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">{note}</p>
    </div>
  );
}

/**
 * The confirmed share as a bar. One measure, so one colour on a neutral
 * track; the numbers are in the columns beside it, and the bar adds nothing
 * that is not there in text.
 */
function ShareBar({ row }: { row: Tally }) {
  const share = row.rate ?? 0;
  return (
    <div
      className="h-2 w-full min-w-24 overflow-hidden rounded-full bg-slate-200"
      title={`${row.confirmed} confirmed, ${row.rejected} rejected`}
    >
      <div className="h-full rounded-full bg-green-700" style={{ width: `${share * 100}%` }} />
    </div>
  );
}

function TallyTable({ caption, firstColumn, rows }: { caption: string; firstColumn: string; rows: Tally[] }) {
  return (
    <section className="mt-8">
      <h2 className={SECTION_LABEL}>{caption}</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-edge bg-surface-raised">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-soft">
            <tr className="border-b border-edge">
              <th className="px-4 py-2 font-medium">{firstColumn}</th>
              <th className="px-4 py-2 text-right font-medium">Confirmed</th>
              <th className="px-4 py-2 text-right font-medium">Rejected</th>
              <th className="w-2/5 px-4 py-2 font-medium">Share confirmed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-edge last:border-b-0">
                <td className="px-4 py-2 font-mono text-xs">{row.key}</td>
                <td className="px-4 py-2 text-right tabular-nums">{row.confirmed}</td>
                <td className="px-4 py-2 text-right tabular-nums">{row.rejected}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-3">
                    <ShareBar row={row} />
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-ink-soft">
                      {percent(row.rate)}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Lines a team could add to .second-look.md, from what they keep rejecting. */
function RuleSuggestions({ rules }: { rules: ReturnType<typeof suggestRules> }) {
  if (rules.length === 0) {
    return null;
  }
  const text = rules.map((entry) => `- ${entry.rule}`).join("\n");
  return (
    <section className="mt-8 rounded-lg border border-blue-200 bg-accent-soft p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={SECTION_LABEL}>Rules you could add</h2>
          <p className="mt-1 text-sm leading-relaxed">
            Reviewers keep turning these down. Adding the lines below to{" "}
            <code className="font-mono text-xs">.second-look.md</code> on the main branch tells the
            first pass to stop raising them.
          </p>
        </div>
        <CopyButton text={text} label="Copy rules" />
      </div>
      <ul className="mt-3 space-y-2 text-sm">
        {rules.map((entry) => (
          <li key={entry.rule} className="rounded-md border border-edge bg-surface-raised px-3 py-2">
            <p className="font-mono text-xs">- {entry.rule}</p>
            <p className="mt-1 text-xs text-ink-soft">{entry.because}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What reviewers did with the first pass's findings, across the repositories
 * the signed-in user may review. Read from stored decisions; no model call.
 */
type PageProps = { searchParams: Promise<{ days?: string }> };

/** Reads ?days=30, 90 or all. Anything else is the default, 90. */
function readPeriod(value: string | undefined): InsightPeriod {
  if (value === "all") return null;
  if (value === "30") return 30;
  return 90;
}

function periodLabel(period: InsightPeriod): string {
  return period === null ? "All time" : `Last ${period} days`;
}

function PeriodPicker({ current }: { current: InsightPeriod }) {
  const chip =
    "rounded-full border border-edge px-2.5 py-0.5 text-xs text-ink-soft transition hover:border-slate-400 aria-[current]:border-accent aria-[current]:bg-accent-soft aria-[current]:text-ink";
  return (
    <nav aria-label="Period" className="flex flex-wrap gap-1.5">
      {INSIGHT_PERIODS.map((period) => (
        <Link
          key={String(period)}
          href={`/dashboard/insights?days=${period ?? "all"}`}
          aria-current={period === current ? "true" : undefined}
          className={chip}
        >
          {periodLabel(period)}
        </Link>
      ))}
    </nav>
  );
}

export default async function InsightsPage({ searchParams }: PageProps) {
  const login = await getSignedInLogin();
  if (!login) {
    redirect("/dashboard");
  }
  const period = readPeriod((await searchParams).days);
  const { insights, repositories, publishedReviews } = await getInsightsFor(login, dashboardDeps(), period);
  const followUpTotal =
    insights.followUp.fixed + insights.followUp.stillPresent + insights.followUp.unclear;

  return (
    <>
      <SiteHeader current="/dashboard">
        <span className="text-ink-soft">{login}</span>
      </SiteHeader>
      <main className="mx-auto max-w-4xl px-5 py-8">
        <p className="text-sm">
          <Link href="/dashboard" className={LINK}>
            Dashboard
          </Link>
          <span className="mx-2 text-ink-soft">/</span>
          <span className="text-ink-soft">First pass quality</span>
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">How the first pass is doing</h1>
          <div className="flex flex-wrap items-center gap-3">
            <PeriodPicker current={period} />
            <a
              href={`/dashboard/insights/export?days=${period ?? "all"}`}
              className={`${LINK} text-xs`}
              title="Every decision in this period, as a spreadsheet. No code and no finding text."
            >
              Download decisions (CSV)
            </a>
          </div>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
          Every Confirm and Reject is a reviewer saying whether a finding was worth sending. This
          page adds them up over {plural(publishedReviews, "review")} published{" "}
          {period === null ? "so far" : `in the last ${period} days`}
          {repositories.length > 0 && <> on {repositories.join(", ")}</>}. A low share in one row
          is a place to tighten the team rules in <code className="font-mono text-xs">.second-look.md</code>.
        </p>

        {insights.decided === 0 ? (
          <p className="mt-6 rounded-lg border border-dashed border-edge p-6 text-sm text-ink-soft">
            {period === null
              ? "Nothing to add up yet. The numbers appear after the first review is published."
              : `No review was published in the last ${period} days.`}
          </p>
        ) : (
          <>
            {insights.waitMinutes && (
              <p className="mt-6 rounded-lg border border-edge bg-surface-raised p-4 text-sm leading-relaxed">
                <span className={SECTION_LABEL}>Waiting for a reviewer</span>
                <br />
                Half of the reviews were published within{" "}
                <strong className="font-semibold">{duration(insights.waitMinutes.median)}</strong> of the
                first pass finishing. The longest wait was {duration(insights.waitMinutes.slowest)}.{" "}
                <span className="text-ink-soft">
                  Over {plural(insights.waitMinutes.count, "review")}. While a review waits, the
                  check on its pull request stays in progress.
                </span>
              </p>
            )}
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile
                label="Findings decided"
                value={String(insights.decided)}
                note="From the first pass, in published reviews."
              />
              <Tile
                label="Confirmed"
                value={percent(insights.acceptanceRate)}
                note={`${insights.confirmed} sent to authors, ${insights.rejected} rejected.`}
              />
              <Tile
                label="Rewritten first"
                value={String(insights.edited)}
                note="Confirmed findings the reviewer put in their own words."
              />
              <Tile
                label="Added by reviewers"
                value={String(insights.addedByReviewers)}
                note="Findings a reviewer wrote: what the first pass missed."
              />
            </div>

            <TallyTable caption="By severity" firstColumn="Severity" rows={insights.bySeverity} />
            <TallyTable caption="By category" firstColumn="Category" rows={insights.byCategory} />

            <RuleSuggestions rules={suggestRules(insights)} />

            {insights.rejectionReasons.length > 0 && (
              <section className="mt-8">
                <h2 className={SECTION_LABEL}>Why findings were rejected</h2>
                <ul className="mt-2 divide-y divide-edge rounded-lg border border-edge bg-surface-raised text-sm">
                  {insights.rejectionReasons.map((entry) => (
                    <li key={entry.reason} className="flex items-baseline justify-between gap-4 px-4 py-2">
                      <span className="min-w-0 break-words">{entry.reason}</span>
                      <span className="shrink-0 tabular-nums text-ink-soft">{entry.count}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {followUpTotal > 0 && (
              <section className="mt-8">
                <h2 className={SECTION_LABEL}>After a review was sent</h2>
                <p className="mt-2 text-sm leading-relaxed">
                  When a pull request was reviewed again, {insights.followUp.fixed} of{" "}
                  {plural(followUpTotal, "sent finding")} had been fixed,{" "}
                  {insights.followUp.stillPresent} were still there, and for{" "}
                  {insights.followUp.unclear} the first pass could not tell.
                </p>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
