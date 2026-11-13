"use client";

import { useEffect, type ReactNode } from "react";

/** Said when the last pending finding gets a decision. */
export const ALL_DECIDED_MESSAGE = "All findings decided. The review is ready to publish.";

/** Said instead when every finding was rejected: there is nothing to send. */
export const NOTHING_TO_SEND_MESSAGE = "All findings rejected. Nothing to send: you can approve it as it is.";

/** A green circle with a check: the one icon a success message carries. */
function CheckIcon() {
  return (
    <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-green-700 text-white">
      <svg viewBox="0 0 16 16" className="size-3">
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/**
 * A short message that something happened, at the bottom of the window,
 * removed after a few seconds. `role="status"` makes screen readers announce
 * it without moving focus.
 *
 * A success message is green with a check, as in most design systems, so it
 * cannot be mistaken for an error. The wording names what happened, and at
 * most one action offers the obvious next step.
 */
export function Toast({
  message,
  onDone,
  seconds,
  action,
}: {
  message: string;
  onDone: () => void;
  seconds?: number;
  /** One link or button for the obvious next step. */
  action?: ReactNode;
}) {
  // A toast with an action stays longer: the reader has to read it and then
  // decide to click, and a button that vanishes under the pointer is worse
  // than none.
  const shownFor = seconds ?? (action ? 12 : 6);
  useEffect(() => {
    const timer = setTimeout(onDone, shownFor * 1000);
    return () => clearTimeout(timer);
  }, [onDone, shownFor]);

  return (
    <div
      role="status"
      className="animate-rise-in fixed inset-x-0 bottom-20 z-50 mx-auto flex w-fit max-w-[min(36rem,92vw)] items-start gap-3 rounded-lg border border-green-300 bg-green-50 py-3 pl-3 pr-2 text-sm text-green-950 shadow-lg"
    >
      <CheckIcon />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
        <span className="leading-5">{message}</span>
        {action}
      </div>
      <button
        type="button"
        onClick={onDone}
        aria-label="Dismiss"
        className="grid size-5 shrink-0 place-items-center rounded text-green-900 opacity-70 transition hover:opacity-100"
      >
        <svg viewBox="0 0 16 16" className="size-3" aria-hidden>
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** The action inside a toast: a small outlined button, so it reads as a control. */
export const TOAST_ACTION =
  "inline-flex items-center rounded-md border border-green-700 bg-surface-raised px-2.5 py-1 text-xs font-medium text-green-900 transition hover:bg-green-100";
