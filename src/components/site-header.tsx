import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

export const REPO_URL = "https://github.com/Changliu53/second-look";

/** The mark: a diff "+" line under a second, offset look. */
export function Logo({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="2" y="5" width="16" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.35" />
      <rect x="6" y="8" width="16" height="13" rx="2.5" fill="var(--color-surface-raised)" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10.5 14.6l2.4 2.4 4.6-5" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Playground: a sandbox, nothing is saved. Example review: one real pull
// request after review, read-only. Dashboard: where signed-in reviewers work.
const NAV = [
  { href: "/", label: "Playground" },
  { href: "/example", label: "Example review" },
  { href: "/dashboard", label: "Dashboard" },
];

/**
 * The site's navigation: every link here goes to another page. It lives in
 * the top bar on every page, and nowhere else, so a control inside a page
 * never looks like it might navigate away.
 */
function NavLinks({ current }: { current?: string }) {
  return (
    // On a phone the links take a row of their own, under the name.
    <nav aria-label="Site" className="order-last flex w-full items-center gap-5 text-sm sm:order-none sm:w-auto">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={current === item.href ? "page" : undefined}
          // An underline on the current page, the usual top-bar convention.
          className="border-b-2 border-transparent py-2 text-ink-soft transition hover:text-ink aria-[current]:border-slate-900 aria-[current]:font-medium aria-[current]:text-ink sm:py-3"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Top bar for every page. `wide` is for the playground, whose two panes span
 * the whole window; other pages keep the bar aligned with their centred
 * content.
 */
export function SiteHeader({
  current,
  wide = false,
  children,
}: {
  current?: string;
  wide?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <header className="shrink-0 border-b border-edge bg-surface-raised">
      <div className={`flex flex-wrap items-center gap-x-8 px-5 ${wide ? "" : "mx-auto max-w-6xl"}`}>
        <Link href="/" className="flex items-center gap-2 py-2.5 font-semibold tracking-tight">
          <Logo />
          Second Look
        </Link>
        <NavLinks current={current} />
        <div className="ml-auto flex items-center gap-4 text-sm">
          {children}
          <a href={REPO_URL} className="text-ink-soft transition hover:text-ink">
            <span className="hidden sm:inline">Source on </span>GitHub
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
