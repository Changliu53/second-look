import Link from "next/link";
import { z } from "zod";
import { ReviewContent } from "@/components/review/review-content";
import { SiteHeader } from "@/components/site-header";
import { SECTION_LABEL } from "@/components/ui";
import { getDemoReview } from "@/dashboard/service";
import { getExamplePullRequests, type PullRequestRef } from "@/lib/env";
import { dashboardDeps } from "../dashboard/deps";

// Reads ?pr and ?round from the URL, so it is rendered per request. The
// GitHub diff behind it is cached per commit, so repeat visits do not call
// GitHub.
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ pr?: string; round?: string }>;
};

const positiveInt = z.coerce.number().int().positive();

function NoExample() {
  return (
    <p className="mt-6 text-slate-600">
      No example review is available right now. Try{" "}
      <Link className="text-blue-700 underline" href="/">
        the playground
      </Link>{" "}
      instead.
    </p>
  );
}

/** Links between the configured example pull requests, when there are several. */
function ExamplePicker({ pulls, current }: { pulls: PullRequestRef[]; current: number }) {
  if (pulls.length < 2) {
    return null;
  }
  return (
    <nav aria-label="Example pull requests" className="mb-5">
      <p className={SECTION_LABEL}>Examples</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {pulls.map((pull, index) => (
          <li key={`${pull.owner}/${pull.name}#${pull.number}`}>
            <Link
              href={`/example?pr=${index + 1}`}
              aria-current={index === current ? "page" : undefined}
              className="block rounded-md border border-edge bg-surface-raised px-3 py-1.5 font-mono text-xs transition hover:border-accent aria-[current]:border-accent aria-[current]:bg-accent-soft"
            >
              {pull.name}#{pull.number}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * A public, read-only copy of the reviewer's page for real pull requests, so
 * someone can see the product without installing the GitHub App.
 */
export default async function ExamplePage({ searchParams }: PageProps) {
  const pulls = getExamplePullRequests();
  const params = await searchParams;
  const requested = positiveInt.safeParse(params.pr);
  // ?pr counts from 1. Anything missing or out of range shows the first.
  const index = requested.success && requested.data <= pulls.length ? requested.data - 1 : 0;
  const pull = pulls[index];
  const round = positiveInt.safeParse(params.round);
  const loaded = pull
    ? await getDemoReview(pull, dashboardDeps(), round.success ? round.data : undefined)
    : null;

  return (
    <>
      <SiteHeader current="/example" />
      <main className="mx-auto max-w-5xl px-5 py-8">
        {loaded ? (
          <>
            <div className="mb-6 rounded-lg border border-blue-200 bg-accent-soft p-4 text-sm leading-relaxed text-blue-950">
              <p className="font-semibold">Real pull requests, after review</p>
              <p className="mt-1">
                This is the reviewer&apos;s page for a pull request that has been through the whole
                flow: the AI&apos;s first pass, an engineer&apos;s decisions, a fix, and a second
                review. It is read-only because the reviews are published. What you see matches
                what the author got on GitHub. Green-edged findings were confirmed and sent.
                Greyed ones were rejected and the author never saw them.
              </p>
              <p className="mt-2">
                To confirm and reject findings yourself, use the{" "}
                <Link className="font-medium underline" href="/">
                  playground
                </Link>
                .
              </p>
            </div>
            <ExamplePicker pulls={pulls} current={index} />
            <ReviewContent
              detail={loaded.detail}
              diff={loaded.diff}
              locked
              rounds={loaded.rounds}
              roundHref={(_round, number) => `/example?pr=${index + 1}&round=${number}`}
            />
          </>
        ) : (
          <NoExample />
        )}
      </main>
    </>
  );
}
