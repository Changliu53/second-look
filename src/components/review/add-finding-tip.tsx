"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "second-look:add-finding-tip";

/**
 * Tells the reviewer they can write findings of their own. A "+" that only
 * appears on hover is found by people who already know it is there; other
 * review tools get the same complaint. So the tip is shown above the code
 * until the reviewer dismisses it or adds a finding, and is remembered in
 * the browser after that.
 *
 * It renders nothing on the server and on the first client render, so the
 * page's HTML does not depend on what the browser remembers.
 */
export function AddFindingTip() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(STORAGE_KEY) !== "dismissed");
    } catch {
      setShow(true);
    }
  }, []);

  if (!show) {
    return null;
  }

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(STORAGE_KEY, "dismissed");
    } catch {
      // Storage can be blocked; the tip then comes back next visit.
    }
  }

  return (
    <aside className="mt-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-accent-soft p-3 text-sm">
      <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded bg-accent text-sm font-bold text-white">
        +
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">The first pass can miss things. You can add your own findings.</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
          Click the <span className="font-semibold text-accent">+</span> next to any line number
          below. Your finding goes to the author with the ones you confirm, and needs no decision.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-accent transition hover:bg-blue-100"
      >
        Got it
      </button>
    </aside>
  );
}

/** Called when a reviewer adds a finding: they know about it now. */
export function rememberAddFindingTipSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "dismissed");
  } catch {
    // Nothing to do.
  }
}
