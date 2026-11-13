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
      No demo review is available right now. Try{" "}
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
export default async function DemoPage() {
  const pull = getDemoPullRequest();
  const loaded = pull ? await getDemoReview(pull, dashboardDeps()) : null;

  return (
    <>
      <SiteHeader current="/demo" />
      <main className="mx-auto max-w-5xl px-5 py-8">
        {loaded ? (
          <>
          <div className="mb-6 rounded-lg border border-blue-200 bg-accent-soft p-4 text-sm leading-relaxed text-blue-950">
            <p className="font-semibold">Read-only example of the reviewer&apos;s page</p>
            <p className="mt-1">
              This is a real pull request after an engineer went through the AI&apos;s findings.
              Green-edged findings were confirmed and posted to GitHub. The greyed one was rejected,
              with a reason, and the author never saw it. One was rewritten by the reviewer before
              sending.
            </p>
            <p className="mt-2">
              Want to press the buttons yourself?{" "}
              <Link className="font-medium underline" href="/?example=tenant-query">
                Try the interactive version
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
