/**
 * Structured logging. Callers pass ids, counts, and error codes only.
 * Never pass tokens, diffs, file contents, or model output: production logs
 * are readable by more people than the code under review is.
 */

type LogValue = string | number | boolean | null | undefined;

export function logEvent(event: string, fields: Record<string, LogValue> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

/** Reduces any thrown value to a short string that is safe to log and store. */
export function safeErrorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  if (error instanceof Error && "status" in error && typeof error.status === "number") {
    return `http_${error.status}`;
  }
  return error instanceof Error ? error.name : "unknown_error";
}
