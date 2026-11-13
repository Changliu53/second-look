import Link from "next/link";
import { getSignedInLogin } from "@/auth";
import { AutoRefresh } from "@/components/auto-refresh";
import { stageLabel } from "@/components/review/stage-labels";
import { SiteHeader } from "@/components/site-header";
import { BUTTON_PRIMARY, LINK, SECTION_LABEL } from "@/components/ui";
import { listPublishedReviewsFor, listReviewsFor } from "@/dashboard/service";
import { isStaleRunning, type ReviewListItem } from "@/db/queries";
import { ago } from "@/lib/time";
import { BUDGET_REACHED } from "@/github/review-pull-request";
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
          <Link className={LINK} href="/example">
            example of a reviewed pull request
          </Link>{" "}
          or{" "}
          <Link className={LINK} href="/">
            try the playground
          </Link>
          . Before installing it on your code, read{" "}
          <Link className={LINK} href="/data">
            what it stores and sends
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

// Within this long, the last person to act is taken to still be on it.
const ACTIVE_MS = 30 * 60_000;

/** Who is on a review, so two reviewers do not go through the same one. */
function ActivityNote({ item, login }: { item: ReviewListItem; login: string }) {
  const last = item.lastActivity;
  if (!last) {
    return null;
  }
  const who = last.actor === login ? "You" : last.actor;
  const active = Date.now() - last.at.getTime() < ACTIVE_MS;
  return (
    <span className={`block text-xs ${active && last.actor !== login ? "text-amber-700" : "text-ink-soft"}`}>
      {active ? `${who} ${who === "You" ? "are" : "is"} going through it` : `Last worked on by ${who}`}, {ago(last.at)}
    </span>
  );
}

function OpenRow({ item, login }: { item: ReviewListItem; login: string }) {
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
          <ActivityNote item={item} login={login} />
        </span>
        <span className="flex items-center gap-1.5 text-xs text-ink-soft">
          <span aria-hidden className={`size-2 rounded-full ${stale ? "bg-red-600" : STATUS_DOT[review.status]}`} />
          {stale
            ? "Review did not finish"
            : review.status === "failed" && review.errorMessage === BUDGET_REACHED
              ? "Skipped: monthly budget used up"
              : review.status === "running"
              ? `AI: ${stageLabel(review.stage).toLowerCase()}`
              : STATUS_LABELS[review.status]}
        </span>
        {total > 0 &&
          (item.pendingCount === 0 && review.status === "completed" ? (
            // Every finding has a decision: the only step left is publishing.
            <span className="w-28 text-right text-xs font-medium text-green-700">Ready to publish</span>
          ) : (
            <span className="w-28 text-right text-xs text-ink-soft">
              <span className="font-semibold text-ink">{item.pendingCount}</span> of {total} to decide
            </span>
          ))}
      </Link>
    </li>
  );
}

// Where a signed-in reviewer with nothing to do can start a real review.
const SAMPLE_REPO_URL = "https://github.com/Changliu53/fieldops-platform-sample";

function PublishedRow({ item }: { item: ReviewListItem }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-2 text-sm">
      <Link href={`/dashboard/reviews/${item.review.id}`} className={`${LINK} min-w-0 flex-1 truncate`}>
        {item.pullRequest.title}
      </Link>
      <span className="font-mono text-xs text-ink-soft">{pullLabel(item)}</span>
      <span className="text-xs text-ink-soft">
        {item.confirmedCount === 0
          ? `approved by ${item.review.publishedBy}, no changes`
          : item.review.resolution === "reviewer_takes_over"
            ? `${item.confirmedCount} sent, taken over by ${item.review.publishedBy}`
            : `${item.confirmedCount} sent back by ${item.review.publishedBy}`}
      </span>
    </li>
  );
}

type PageProps = { searchParams: Promise<{ repo?: string }> };

function repoKey(item: ReviewListItem): string {
  return `${item.repository.owner}/${item.repository.name}`;
}

/** Shown when the open reviews span more than one repository. */
function RepoFilter({ items, current }: { items: ReviewListItem[]; current: string | null }) {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(repoKey(item), (counts.get(repoKey(item)) ?? 0) + 1);
  }
  if (counts.size < 2) {
    return null;
  }
  const chip =
    "rounded-full border border-edge px-2.5 py-0.5 text-xs transition hover:border-slate-400 aria-[current]:border-accent aria-[current]:bg-accent-soft aria-[current]:text-ink";
  return (
    <nav aria-label="Filter by repository" className="mt-4 flex flex-wrap gap-1.5 text-ink-soft">
      <Link href="/dashboard" aria-current={current === null ? "true" : undefined} className={chip}>
        All <span className="tabular-nums">{items.length}</span>
      </Link>
      {[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([repo, count]) => (
        <Link
          key={repo}
          href={`/dashboard?repo=${encodeURIComponent(repo)}`}
          aria-current={current === repo ? "true" : undefined}
          className={`${chip} font-mono`}
        >
          {repo} <span className="font-sans tabular-nums">{count}</span>
        </Link>
      ))}
    </nav>
  );
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const login = await getSignedInLogin();
  if (!login) {
    return <SignedOut />;
  }
  const deps = dashboardDeps();
  const [open, published] = await Promise.all([
    listReviewsFor(login, deps),
    listPublishedReviewsFor(login, deps),
  ]);
  const requested = (await searchParams).repo ?? null;
  // Only a repository that is in the list can be a filter; anything else in
  // the URL shows everything.
  const repoFilter = requested && open.some((item) => repoKey(item) === requested) ? requested : null;
  const shown = repoFilter ? open.filter((item) => repoKey(item) === repoFilter) : open;
  const anyRunning = open.some((item) => item.review.status === "running" && !isStaleRunning(item.review));

  return (
    <>
      <SiteHeader current="/dashboard">
        <form action={signOutAction} className="flex items-center gap-3">
          <span className="text-ink-soft">{login}</span>
          <button className={LINK}>Sign out</button>
        </form>
      </SiteHeader>
      {/* Keep the list fresh: quickly while a review runs, slowly otherwise,
          so a pull request opened a moment ago appears without a reload. */}
      <AutoRefresh seconds={anyRunning ? 3 : 10} />

      <main className="mx-auto max-w-4xl px-5 py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Waiting for your decision</h1>
          <Link href="/dashboard/insights" className={`${LINK} text-sm`}>
            How the first pass is doing
          </Link>
        </div>
        {open.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-edge p-6 text-sm leading-relaxed text-ink-soft">
            <p>
              Nothing is waiting for you. A pull request appears here within seconds of being
              opened, if Second Look is installed on its repository and {login} has write access
              to it. This list updates by itself.
            </p>
            <p className="mt-2">
              To see one now, open a pull request on the{" "}
              <a className={LINK} href={`${SAMPLE_REPO_URL}#try-it-yourself`}>
                sample repository
              </a>
              . It has a script that opens a prepared one.
            </p>
          </div>
        ) : (
          <>
          <RepoFilter items={open} current={repoFilter} />
          <ul className="mt-4 space-y-2">
            {shown.map((item) => (
              <OpenRow key={item.review.id} item={item} login={login} />
            ))}
          </ul>
          </>
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
