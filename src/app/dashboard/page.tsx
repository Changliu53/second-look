import Link from "next/link";
import { getSignedInLogin } from "@/auth";
import { listReviewsFor } from "@/dashboard/service";
import type { ReviewListItem } from "@/db/queries";
import { signInAction, signOutAction } from "./actions";
import { dashboardDeps } from "./deps";

// Always render with fresh data; the list changes with every webhook.
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<ReviewListItem["review"]["status"], string> = {
  running: "AI review running",
  completed: "Ready for you",
  failed: "Review failed",
  too_large: "Too large to review",
  superseded: "Out of date",
};

function SignedOut() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Reviewer dashboard</h1>
      <p className="mt-3 text-slate-700">
        Sign in with GitHub to see reviews for repositories you can write to.
      </p>
      <form action={signInAction} className="mt-6">
        <button className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          Sign in with GitHub
        </button>
      </form>
    </main>
  );
}

function ReviewRow({ item }: { item: ReviewListItem }) {
  const { review, pullRequest, repository } = item;
  return (
    <tr className="border-t border-slate-200">
      <td className="py-2 pr-4 font-mono text-xs">
        {repository.owner}/{repository.name}#{pullRequest.number}
      </td>
      <td className="py-2 pr-4">
        <Link className="text-blue-700 underline" href={`/dashboard/reviews/${review.id}`}>
          {pullRequest.title}
        </Link>
        <div className="text-xs text-slate-500">by {pullRequest.authorLogin}</div>
      </td>
      <td className="py-2 pr-4">{STATUS_LABELS[review.status]}</td>
      <td className="py-2 pr-4 text-right">{item.pendingCount}</td>
      <td className="py-2 text-right">{item.confirmedCount}</td>
    </tr>
  );
}

export default async function DashboardPage() {
  const login = await getSignedInLogin();
  if (!login) {
    return <SignedOut />;
  }
  const items = await listReviewsFor(login, dashboardDeps());

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reviews waiting for a decision</h1>
        <form action={signOutAction} className="text-sm">
          <span className="mr-3 text-slate-600">{login}</span>
          <button className="text-blue-700 underline">Sign out</button>
        </form>
      </div>

      {items.length === 0 ? (
        <p className="mt-8 text-slate-600">
          Nothing to review. New pull requests on repositories where Second
          Look is installed will show up here.
        </p>
      ) : (
        <table className="mt-6 w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="pb-2 pr-4">Pull request</th>
              <th className="pb-2 pr-4">Title</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4 text-right">Pending</th>
              <th className="pb-2 text-right">Confirmed</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <ReviewRow key={item.review.id} item={item} />
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
