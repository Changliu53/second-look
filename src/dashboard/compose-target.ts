/**
 * The line a reviewer picked to write a finding on, carried in the URL as
 * ?compose=path:line so the page can open the form there without any
 * client state. Kept in its own module because the review page and its tests
 * both need it, and the component file imports server-only code.
 */

export type ComposeTarget = { path: string; line: number };

/** The review page's own URL with a line picked for a new finding. */
export function composeHref(reviewId: number, path: string, line: number): string {
  const target = encodeURIComponent(`${path}:${line}`);
  return `/dashboard/reviews/${reviewId}?compose=${target}#compose`;
}

/** Reads "path:line" from the URL. The path itself may contain colons. */
export function parseComposeTarget(value: string | undefined): ComposeTarget | null {
  const separator = value?.lastIndexOf(":") ?? -1;
  if (!value || separator <= 0) {
    return null;
  }
  const line = Number(value.slice(separator + 1));
  if (!Number.isInteger(line) || line <= 0) {
    return null;
  }
  return { path: value.slice(0, separator), line };
}
