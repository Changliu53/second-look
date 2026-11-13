import { SiteHeader } from "@/components/site-header";

const BLOCK = "animate-pulse rounded-lg border border-edge bg-surface-raised motion-reduce:animate-none";

/**
 * Shown while a review page loads. The page fetches the diff from GitHub,
 * which is the slow part, so the outline of the page appears first.
 */
export default function ReviewLoading() {
  return (
    <>
      <SiteHeader current="/dashboard" />
      <main className="mx-auto max-w-5xl px-5 py-8" aria-busy="true">
        <p className="sr-only">Loading the review and its diff.</p>
        <div aria-hidden>
          <div className="h-8 w-2/3 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
          <div className="mt-2 h-4 w-1/3 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
          <div className={`mt-6 h-36 ${BLOCK}`} />
          <div className={`mt-4 h-24 ${BLOCK}`} />
          <div className={`mt-6 h-96 ${BLOCK}`} />
        </div>
      </main>
    </>
  );
}
