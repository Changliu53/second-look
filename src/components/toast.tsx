"use client";

import { useEffect, type ReactNode } from "react";

/** Said when the last pending finding gets a decision. */
export const ALL_DECIDED_MESSAGE = "Every finding has a decision. The review is ready to publish.";

/**
 * A short confirmation that something happened, shown at the bottom of the
 * window and removed after a few seconds. `role="status"` makes screen
 * readers announce it without moving focus. `action` is an optional link or
 * button for the obvious next thing to do.
 */
export function Toast({
  message,
  onDone,
  seconds = 6,
  action,
}: {
  message: string;
  onDone: () => void;
  seconds?: number;
  action?: ReactNode;
}) {
  useEffect(() => {
    const timer = setTimeout(onDone, seconds * 1000);
    return () => clearTimeout(timer);
  }, [onDone, seconds]);

  return (
    <div
      role="status"
      className="animate-rise-in fixed inset-x-0 bottom-20 z-50 mx-auto flex w-fit max-w-[90vw] flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg"
    >
      <span>{message}</span>
      {action}
    </div>
  );
}
