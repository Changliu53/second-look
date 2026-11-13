import Link from "next/link";

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

export function NavLinks({ current }: { current?: string }) {
  return (
    <nav className="flex items-center gap-1 text-sm">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={current === item.href ? "page" : undefined}
          className="rounded-md px-2 py-1 text-ink-soft transition hover:bg-slate-100 hover:text-ink aria-[current]:bg-slate-100 aria-[current]:text-ink"
        >
          {item.label}
        </Link>
      ))}
      <a
        href={REPO_URL}
        className="rounded-md px-2 py-1 text-ink-soft transition hover:bg-slate-100 hover:text-ink"
      >
        Source
      </a>
    </nav>
  );
}

/** Top bar for every page except the home workbench, which has its own. */
export function SiteHeader({ current, children }: { current?: string; children?: React.ReactNode }) {
  return (
    <header className="border-b border-edge bg-surface-raised">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Logo />
          Second Look
        </Link>
        <NavLinks current={current} />
        <div className="ml-auto flex items-center gap-3 text-sm">{children}</div>
      </div>
    </header>
  );
}
