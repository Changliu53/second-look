import { SiteHeader } from "@/components/site-header";

/**
 * Shown while the dashboard list loads. The list asks GitHub about the
 * signed-in user's access to each repository, which can take a second, and
 * a blank page for that second looks broken.
 */
export default function DashboardLoading() {
  return (
    <>
      <SiteHeader current="/dashboard" />
      <main className="mx-auto max-w-4xl px-5 py-8" aria-busy="true">
        <h1 className="text-2xl font-semibold tracking-tight">Waiting for your decision</h1>
        <p className="sr-only">Loading the list of reviews.</p>
        <ul className="mt-4 space-y-2" aria-hidden>
          {[0, 1, 2].map((row) => (
            <li key={row} className="h-[3.75rem] animate-pulse rounded-lg border border-edge bg-surface-raised motion-reduce:animate-none" />
          ))}
        </ul>
      </main>
    </>
  );
}
