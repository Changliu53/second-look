import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getSignedInLogin } from "@/auth";
import { AutoRefresh } from "@/components/auto-refresh";
import { FindingKeys } from "@/components/review/finding-keys";
import { ReviewContent } from "@/components/review/review-content";
import { SiteHeader } from "@/components/site-header";
import { BUTTON_PRIMARY, INPUT, LINK, SECTION_LABEL } from "@/components/ui";
import { ACTION_ERRORS, getReviewFor, type ActionErrorCode } from "@/dashboard/service";
import { isStaleRunning, type ReviewDetail } from "@/db/queries";
import { countByStatus } from "@/sandbox/model";
import { publishReviewAction } from "../../actions";
import { dashboardDeps } from "../../deps";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

/** Why the review cannot be changed any more, or null if it can. */
function lockedReason(detail: ReviewDetail): string | null {
  const { review } = detail;
  if (review.publishedAt !== null) {
    return `Published by ${review.publishedBy ?? "a reviewer"}. Findings can no longer be changed.`;
  }
  if (review.status === "superseded") {
    return "A newer commit was pushed to this pull request. This review is out of date.";
  }
  if (isStaleRunning(review)) {
    return "The AI review did not finish. It may have timed out. Close and reopen the pull request to run it again.";
  }
  if (review.status === "running") {
    return "The AI review is running. This page updates by itself when it is done.";
  }
  if (review.status === "failed") {
    return "The AI review failed. Close and reopen the pull request to run it again.";
  }
  return null;
}

function pullRequestUrl(detail: ReviewDetail): string {
  const { repository, pullRequest } = detail;
  return `https://github.com/${repository.owner}/${repository.name}/pull/${pullRequest.number}`;
}

/** Stays visible while scrolling: how far along the reviewer is. */
function ProgressBar({ detail, locked }: { detail: ReviewDetail; locked: boolean }) {
  const counts = countByStatus(detail.findings);
  const critical = detail.findings.filter(
    (f) => f.severity === "critical" && f.status !== "rejected",
  ).length;

  return (
    <div className="sticky top-0 z-10 border-b border-edge bg-surface-raised/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-5 py-2">
        <p className="text-sm">
          <span className="font-semibold">{counts.pending}</span>
          <span className="text-ink-soft"> pending</span>
          <span className="mx-2 text-slate-300">·</span>
          <span className="font-semibold text-green-700">{counts.confirmed}</span>
          <span className="text-ink-soft"> confirmed</span>
          <span className="mx-2 text-slate-300">·</span>
          <span className="font-semibold">{counts.rejected}</span>
          <span className="text-ink-soft"> rejected</span>
          {critical > 0 && (
            <>
              <span className="mx-2 text-slate-300">·</span>
              <span className="font-semibold text-red-700">{critical}</span>
              <span className="text-ink-soft"> critical in play</span>
            </>
          )}
        </p>
        <div className="ml-auto flex items-center gap-4">
          {!locked && <FindingKeys />}
          {!locked && (
            <a href="#publish" className={LINK + " text-sm"}>
              Go to publish
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function PublishForm({ detail }: { detail: ReviewDetail }) {
  const counts = countByStatus(detail.findings);
  const confirmedCritical = detail.findings.filter(
    (f) => f.status === "confirmed" && f.severity === "critical",
  ).length;

  return (
    <form
      id="publish"
      action={publishReviewAction}
      className="mt-8 scroll-mt-20 rounded-lg border border-edge bg-surface-raised p-5"
    >
      <input type="hidden" name="reviewId" value={detail.review.id} />
      <h2 className={SECTION_LABEL}>Publish review</h2>
      <p className="mt-2 text-sm leading-relaxed">
        Posts the summary and {counts.confirmed} confirmed finding
        {counts.confirmed === 1 ? "" : "s"} to the pull request as one review. The{" "}
        {counts.rejected} rejected finding{counts.rejected === 1 ? " is" : "s are"} not shown to
        the author. The check will then{" "}
        {confirmedCritical > 0 ? (
          <strong className="text-red-700">require action ({confirmedCritical} critical)</strong>
        ) : (
          <strong className="text-green-700">pass</strong>
        )}
        .
      </p>
      <label className="mt-3 block text-sm">
        Note to the author (optional)
        <textarea name="note" rows={2} maxLength={2000} className={`mt-1 ${INPUT}`} />
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button disabled={counts.pending > 0} className={BUTTON_PRIMARY}>
          Publish review
        </button>
        {counts.pending > 0 && (
          <span className="text-sm text-ink-soft">
            {counts.pending} finding{counts.pending === 1 ? "" : "s"} still pending. Press{" "}
            <kbd className="rounded border border-edge px-1 font-mono text-xs">n</kbd> to jump to
            the next one.
          </span>
        )}
      </div>
    </form>
  );
}

export default async function ReviewPage({ params, searchParams }: PageProps) {
  const login = await getSignedInLogin();
  if (!login) {
    redirect("/dashboard");
  }
  const id = z.coerce.number().int().positive().safeParse((await params).id);
  if (!id.success) {
    notFound();
  }
  const loaded = await getReviewFor(id.data, login, dashboardDeps());
  if (!loaded) {
    notFound();
  }

  const { detail, diff } = loaded;
  // Only known codes are shown. Anything else in the URL is ignored.
  const errorCode = (await searchParams).error ?? "";
  const error = errorCode in ACTION_ERRORS ? ACTION_ERRORS[errorCode as ActionErrorCode] : null;
  const reason = lockedReason(detail);
  const locked = reason !== null;
  const isRunning = detail.review.status === "running" && !isStaleRunning(detail.review);

  return (
    <>
      <SiteHeader current="/dashboard">
        <span className="text-ink-soft">{login}</span>
      </SiteHeader>
      {isRunning && <AutoRefresh seconds={5} />}
      {detail.findings.length > 0 && <ProgressBar detail={detail} locked={locked} />}

      <main className="mx-auto max-w-5xl px-5 py-8">
        {error && (
          <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        {reason && (
          <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {reason}
            {detail.review.publishedAt !== null && (
              <>
                {" "}
                <a className="font-medium underline" href={pullRequestUrl(detail)}>
                  See it on GitHub
                </a>
              </>
            )}
          </p>
        )}

        <ReviewContent detail={detail} diff={diff} locked={locked} />

        {!locked && <PublishForm detail={detail} />}
      </main>
    </>
  );
}
