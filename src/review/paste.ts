import { parseUnifiedDiff } from "./diff";

/** File name used when the pasted text is plain code, not a diff. */
export const PASTED_FILE_NAME = "pasted-code";

function looksLikeDiff(text: string): boolean {
  return parseUnifiedDiff(text).some((file) => file.hunks.length > 0);
}

/**
 * Turns pasted text into a diff the engine can review. A real diff is passed
 * through. Plain code becomes a diff that adds one new file, so the engine has
 * a single input format and line numbers match what the user pasted.
 */
export function toReviewableDiff(pastedText: string): string {
  const text = pastedText.replace(/\r\n/g, "\n");
  if (looksLikeDiff(text)) {
    return text;
  }

  const lines = text.replace(/\n+$/, "").split("\n");
  const body = lines.map((line) => `+${line}`).join("\n");
  return [
    `diff --git a/${PASTED_FILE_NAME} b/${PASTED_FILE_NAME}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${PASTED_FILE_NAME}`,
    `@@ -0,0 +1,${lines.length} @@`,
    body,
  ].join("\n");
}
