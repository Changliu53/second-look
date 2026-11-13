"use client";

/**
 * Switches between the light and dark theme and remembers the choice. The
 * theme lives in `data-theme` on <html>, set before first paint by the script
 * in the root layout. The two icons are shown and hidden with CSS, so this
 * component has no state that could disagree with the page.
 */
function toggleTheme(): void {
  const root = document.documentElement;
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    // Storage can be blocked. The theme still changes for this visit.
  }
}

export function ThemeToggle() {
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Switch between light and dark theme"
      title="Switch between light and dark theme"
      className="grid size-8 place-items-center rounded-md text-ink-soft transition hover:bg-slate-100 hover:text-ink"
    >
      {/* Moon: shown in the light theme. */}
      <svg viewBox="0 0 24 24" className="size-4 dark:hidden" aria-hidden>
        <path
          d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
      {/* Sun: shown in the dark theme. */}
      <svg viewBox="0 0 24 24" className="hidden size-4 dark:block" aria-hidden>
        <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
