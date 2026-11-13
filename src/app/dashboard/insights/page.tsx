import Link from "next/link";
import { redirect } from "next/navigation";
import { getSignedInLogin } from "@/auth";
import { SiteHeader } from "@/components/site-header";
import { LINK, SECTION_LABEL } from "@/components/ui";
import type { Tally } from "@/dashboard/insights";
import { getInsightsFor } from "@/dashboard/service";
import { dashboardDeps } from "../deps";

export const dynamic = "force-dynamic";

function percent(rate: number | null): string {
  return rate === null ? "none yet" : `${Math.round(rate * 100)}%`;
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

/**
 * What reviewers did with the first pass's findings, across the repositories
 * the signed-in user may review. Read from stored decisions; no model call.
 */
export default async function InsightsPage() {
  const login = await getSignedInLogin();
  if (!login) {
    redirect("/dashboard");
  }
  const { insights, repositories, publishedReviews } = await getInsightsFor(login, dashboardDeps());
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
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">How the first pass is doing</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
          Every Confirm and Reject is a reviewer saying whether a finding was worth sending. This
          page adds them up over {plural(publishedReviews, "published review")}
          {repositories.length > 0 && <> on {repositories.join(", ")}</>}. A low share in one row
          is a place to tighten the team rules in <code className="font-mono text-xs">.second-look.md</code>.
        </p>

        {insights.decided === 0 ? (
          <p className="mt-6 rounded-lg border border-dashed border-edge p-6 text-sm text-ink-soft">
            Nothing to add up yet. The numbers appear after the first review is published.
          </p>
        ) : (
          <>
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
