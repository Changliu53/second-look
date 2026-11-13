import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { BUTTON_PRIMARY, LINK } from "@/components/ui";

/**
 * Shown for an unknown address, and for a review the signed-in user may not
 * see. The two look the same on purpose: saying "this exists but is not
 * yours" would confirm that a review id is real.
 */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-xl px-5 py-20">
        <p className="font-mono text-sm text-ink-soft">404</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Nothing here</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          This page does not exist, or it is a review on a repository you do not have write access
          to. If someone sent you the link, ask them to add you to the repository.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Link href="/dashboard" className={BUTTON_PRIMARY}>
            Go to the dashboard
          </Link>
          <Link href="/" className={`${LINK} text-sm`}>
            Open the playground
          </Link>
        </div>
      </main>
    </>
  );
}
