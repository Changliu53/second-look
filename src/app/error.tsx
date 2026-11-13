"use client";

import Link from "next/link";
import { BUTTON, BUTTON_PRIMARY } from "@/components/ui";

/**
 * Shown when a page throws while rendering: the database or GitHub did not
 * answer, or there is a bug. The message is general on purpose. The error
 * itself may contain repository names or query text and is not shown.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-xl px-5 py-20">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        The page could not be loaded. Decisions you had already made are saved. If you were in the
        middle of one, check it after the page comes back. Trying again usually works.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button className={BUTTON_PRIMARY} onClick={reset}>
          Try again
        </button>
        <Link href="/dashboard" className={BUTTON}>
          Back to the dashboard
        </Link>
      </div>
      {/* The digest matches a line in the server log; it identifies nothing else. */}
      {error.digest && (
        <p className="mt-6 font-mono text-xs text-ink-soft">Reference: {error.digest}</p>
      )}
    </main>
  );
}
