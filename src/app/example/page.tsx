import Link from "next/link";
import { z } from "zod";
import { ReviewContent } from "@/components/review/review-content";
import { SiteHeader } from "@/components/site-header";
import { getDemoReview } from "@/dashboard/service";
import { getDemoPullRequest } from "@/lib/env";
import { dashboardDeps } from "../dashboard/deps";

// Reads ?round from the URL, so it is rendered per request. The GitHub diff
// behind it is cached per commit, so repeat visits do not call GitHub.
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ round?: string }>;
};

function NoDemo() {
  return (
    <p className="mt-6 text-slate-600">
      No example review is available right now. Try{" "}
      <Link className="text-blue-700 underline" href="/">
        the interactive examples
      </Link>{" "}
      instead.
    </p>
  );
}

/**
 * A public, read-only copy of the reviewer's page for one pull request, so
 * someone can see the product without installing the GitHub App.
 */
export default async function ExamplePage({ searchParams }: PageProps) {
  const pull = getDemoPullRequest();
  const round = z.coerce.number().int().positive().safeParse((await searchParams).round);
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
            <p className="font-semibold">A real pull request, after review</p>
            <p className="mt-1">
              This is the reviewer&apos;s page for a pull request that has been through the whole
              flow, over several rounds: sent back to the author, partly fixed, taken over by the
              reviewer, and passed. It is read-only because the reviews are published: what you
              see matches what the author got on GitHub. Green-edged findings were confirmed and
              sent. Greyed ones were rejected and the author never saw them.
            </p>
            <p className="mt-2">
              To confirm and reject findings yourself, use the{" "}
              <Link className="font-medium underline" href="/">
                playground
              </Link>
              .
            </p>
          </div>
            <ReviewContent
              detail={loaded.detail}
              diff={loaded.diff}
              locked
              rounds={loaded.rounds}
              roundHref={(_round, number) => `/example?round=${number}`}
            />
          </>
        ) : (
          <NoDemo />
        )}
      </main>
    </>
  );
}
