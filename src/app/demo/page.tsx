import Link from "next/link";
import { ReviewContent } from "@/components/review/review-content";
import { getDemoReview } from "@/dashboard/service";
import { getDemoPullRequest } from "@/lib/env";
import { dashboardDeps } from "../dashboard/deps";

export const dynamic = "force-dynamic";

function NoDemo() {
  return (
    <p className="mt-6 text-slate-600">
      No demo review is available right now. Try{" "}
      <Link className="text-blue-700 underline" href="/paste">
        paste mode
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
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link className="text-sm text-blue-700 underline" href="/">
        Second Look
      </Link>
      <p className="mt-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        Read-only demo. This is the reviewer&apos;s page for a real pull request
        after the engineer went through the AI&apos;s findings. Confirmed
        findings were posted to the pull request. Rejected ones, with the
        reviewer&apos;s reason, were never shown to the author.
      </p>
      {loaded ? (
        <ReviewContent detail={loaded.detail} diff={loaded.diff} locked />
      ) : (
        <NoDemo />
      )}
    </main>
  );
}
