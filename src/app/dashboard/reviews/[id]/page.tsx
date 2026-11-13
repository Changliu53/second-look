import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getSignedInLogin } from "@/auth";
import { ReviewContent } from "@/components/review/review-content";
import { getReviewFor } from "@/dashboard/service";
import type { ReviewDetail } from "@/db/queries";
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
  if (review.status === "running") {
    return "The AI review is still running. Reload in a minute.";
  }
  if (review.status === "failed") {
    return "The AI review failed. Close and reopen the pull request to run it again.";
  }
  return null;
}

function PublishForm({ detail }: { detail: ReviewDetail }) {
  const pending = detail.findings.filter((f) => f.status === "pending").length;
  const confirmed = detail.findings.filter((f) => f.status === "confirmed").length;
  return (
    <form action={publishReviewAction} className="mt-8 rounded border border-slate-200 p-4">
      <input type="hidden" name="reviewId" value={detail.review.id} />
      <h2 className="font-semibold">Publish review</h2>
      <p className="mt-1 text-sm text-slate-700">
        Posts the summary and {confirmed} confirmed finding{confirmed === 1 ? "" : "s"} to
        the pull request as one review. Rejected findings are not shown to the author.
      </p>
      <label className="mt-3 block text-sm">
        Note to the author (optional)
        <textarea name="note" rows={2} maxLength={2000} className="mt-1 block w-full rounded border border-slate-300 p-2 text-sm" />
      </label>
      <button
        disabled={pending > 0}
        className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        Publish review
      </button>
      {pending > 0 && (
        <span className="ml-3 text-sm text-slate-600">
          {pending} finding{pending === 1 ? "" : "s"} still pending.
        </span>
      )}
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
  const { error } = await searchParams;
  const reason = lockedReason(detail);
  const locked = reason !== null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link className="text-sm text-blue-700 underline" href="/dashboard">
        All reviews
      </Link>
      {error && (
        <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {reason && (
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {reason}
        </p>
      )}

      <ReviewContent detail={detail} diff={diff} locked={locked} />

      {!locked && <PublishForm detail={detail} />}
    </main>
  );
}
