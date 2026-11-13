/** Shared class strings, so every page uses the same buttons and labels. */

export const BUTTON =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-edge bg-surface-raised px-2.5 py-1 text-xs font-medium text-ink transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export const BUTTON_PRIMARY =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50";

/** The primary button at the size of the small controls, for toolbars. */
export const BUTTON_PRIMARY_SMALL =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50";

export const BUTTON_CONFIRM =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-green-700 bg-green-700 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-green-800";

export const INPUT =
  "block w-full rounded-md border border-slate-300 bg-surface-raised px-2.5 py-1.5 text-sm outline-none placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-blue-100";

export const SECTION_LABEL =
  "text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-soft";

export const LINK = "text-accent underline-offset-2 hover:underline";

/** Small keyboard key, used in shortcut hints. */
export const KBD =
  "rounded border border-edge bg-surface-raised px-1 font-mono text-[0.6875rem] text-ink-soft";
