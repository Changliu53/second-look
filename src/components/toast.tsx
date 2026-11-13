"use client";

import { useEffect } from "react";

/**
 * A short confirmation that something happened, shown at the bottom of the
 * window and removed after a few seconds. `role="status"` makes screen
 * readers announce it without moving focus.
 */
export function Toast({
  message,
  onDone,
  seconds = 6,
}: {
  message: string;
  onDone: () => void;
  seconds?: number;
}) {
  useEffect(() => {
    const timer = setTimeout(onDone, seconds * 1000);
    return () => clearTimeout(timer);
  }, [onDone, seconds]);

  return (
    <div
      role="status"
      className="animate-rise-in fixed inset-x-0 bottom-6 z-50 mx-auto w-fit max-w-[90vw] rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg"
    >
      {message}
    </div>
  );
}
