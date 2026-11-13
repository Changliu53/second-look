import Link from "next/link";
import { getSignedInLogin } from "@/auth";
import { AutoRefresh } from "@/components/auto-refresh";
import { SiteHeader } from "@/components/site-header";
import { BUTTON_PRIMARY, LINK, SECTION_LABEL } from "@/components/ui";
import { listPublishedReviewsFor, listReviewsFor } from "@/dashboard/service";
import { isStaleRunning, type ReviewListItem } from "@/db/queries";
import { signInAction, signOutAction } from "./actions";
import { dashboardDeps } from "./deps";

// Always render with fresh data; the list changes with every webhook.
export const dynamic = "force-dynamic";

type Status = ReviewListItem["review"]["status"];

const STATUS_LABELS: Record<Status, string> = {
  running: "AI review running",
  completed: "Ready for you",
  failed: "Review failed",
  too_large: "Too large to review",
  superseded: "Out of date",
};

const STATUS_DOT: Record<Status, string> = {
  running: "bg-blue-500 animate-pulse",
  completed: "bg-green-600",
  failed: "bg-red-600",
  too_large: "bg-amber-500",
  superseded: "bg-slate-400",
};

function SignedOut() {
  return (
    <>
      <SiteHeader current="/dashboard" />
      <main className="mx-auto max-w-xl px-5 py-20">
        <h1 className="text-2xl font-semibold tracking-tight">Reviewer dashboard</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Sign in with GitHub to see the pull requests waiting for your decision. You will only
          see repositories where the Second Look app is installed and you have write access.
        </p>
        <form action={signInAction} className="mt-6">
          <button className={BUTTON_PRIMARY}>Sign in with GitHub</button>
        </form>
        <p className="mt-6 text-sm text-ink-soft">
          Just looking? Open the{" "}
          <Link className={LINK} href="/demo">
            read-only example of a reviewed pull request
          </Link>{" "}
          or{" "}
          <Link className={LINK} href="/">
            try it on your own code
          </Link>
          .
        </p>
      </main>
    </>
  );
}

function pullLabel(item: ReviewListItem): string {
  return `${item.repository.owner}/${item.repository.name}#${item.pullRequest.number}`;
}

function OpenRow({ item }: { item: ReviewListItem }) {
  const { review, pullRequest } = item;
  const stale = isStaleRunning(review);
  const total = item.pendingCount + item.decidedCount;

  return (
    <li>
      <Link
        href={`/dashboard/reviews/${review.id}`}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-edge bg-surface-raised px-4 py-3 transition hover:border-accent hover:bg-accent-soft"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{pullRequest.title}</span>
          <span className="block font-mono text-xs text-ink-soft">
            {pullLabel(item)} · {pullRequest.authorLogin}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-ink-soft">
          <span aria-hidden className={`size-2 rounded-full ${stale ? "bg-red-600" : STATUS_DOT[review.status]}`} />
          {stale ? "Review did not finish" : STATUS_LABELS[review.status]}
        </span>
        {total > 0 && (
          <span className="w-28 text-right text-xs text-ink-soft">
            <span className="font-semibold text-ink">{item.pendingCount}</span> of {total} to decide
          </span>
        )}
      </Link>
    </li>
  );
}

function PublishedRow({ item }: { item: ReviewListItem }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-2 text-sm">
      <Link href={`/dashboard/reviews/${item.review.id}`} className={`${LINK} min-w-0 flex-1 truncate`}>
        {item.pullRequest.title}
      </Link>
      <span className="font-mono text-xs text-ink-soft">{pullLabel(item)}</span>
      <span className="text-xs text-ink-soft">
        {item.confirmedCount} sent, by {item.review.publishedBy}
      </span>
    </li>
  );
}

export default async function DashboardPage() {
  const login = await getSignedInLogin();
  if (!login) {
    return <SignedOut />;
  }
  const deps = dashboardDeps();
  const [open, published] = await Promise.all([
    listReviewsFor(login, deps),
    listPublishedReviewsFor(login, deps),
  ]);
  const anyRunning = open.some((item) => item.review.status === "running" && !isStaleRunning(item.review));

  return (
    <>
      <SiteHeader current="/dashboard">
        <form action={signOutAction} className="flex items-center gap-3">
          <span className="text-ink-soft">{login}</span>
          <button className={LINK}>Sign out</button>
        </form>
      </SiteHeader>
      {anyRunning && <AutoRefresh seconds={5} />}

      <main className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Waiting for your decision</h1>
        {open.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-edge p-6 text-sm text-ink-soft">
            Nothing to review. A pull request opened on a repository where Second Look is
            installed shows up here about half a minute later.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {open.map((item) => (
              <OpenRow key={item.review.id} item={item} />
            ))}
          </ul>
        )}

        {published.length > 0 && (
          <section className="mt-10">
            <h2 className={SECTION_LABEL}>Recently published</h2>
            <ul className="mt-2 divide-y divide-edge">
              {published.map((item) => (
                <PublishedRow key={item.review.id} item={item} />
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
