import Link from "next/link";
import { ReviewContent } from "@/components/review/review-content";
import { SiteHeader } from "@/components/site-header";
import { getDemoReview } from "@/dashboard/service";
import { getDemoPullRequest } from "@/lib/env";
import { dashboardDeps } from "../dashboard/deps";

// The page is public and each render calls the GitHub API, so it is cached
// and rebuilt at most once every five minutes however many people open it.
export const revalidate = 300;

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
export default async function ExamplePage() {
  const pull = getDemoPullRequest();
  const loaded = pull ? await getDemoReview(pull, dashboardDeps()) : null;

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
              flow. It is read-only because the review is already published: what you see here
              matches what the author got on GitHub. Green-edged findings were confirmed and sent.
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
            <ReviewContent detail={loaded.detail} diff={loaded.diff} locked />
          </>
        ) : (
          <NoDemo />
        )}
      </main>
    </>
  );
}
