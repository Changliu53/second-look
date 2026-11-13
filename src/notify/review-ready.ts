import { logEvent, safeErrorCode } from "@/lib/log";

/**
 * Tells a team's chat that a review is waiting for a person. Optional: it
 * runs only when NOTIFY_WEBHOOK_URL is set. The message says which pull
 * request and how many findings of each severity. It never contains code or
 * the text of a finding, because a chat channel is read by more people than
 * the code is.
 */

export type ReviewReadyNotice = {
  repository: string;
  pullNumber: number;
  title: string;
  author: string;
  critical: number;
  warning: number;
  nit: number;
  reviewUrl: string;
};

/** Sends one notice. Injected so tests do not touch the network. */
export type Notifier = (notice: ReviewReadyNotice) => Promise<void>;

/** Escapes the three characters Slack treats as markup in message text. */
function escapeForSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function countPhrase(notice: ReviewReadyNotice): string {
  const parts = [
    notice.critical > 0 ? `${notice.critical} critical` : null,
    notice.warning > 0 ? `${notice.warning} warning${notice.warning === 1 ? "" : "s"}` : null,
    notice.nit > 0 ? `${notice.nit} nit${notice.nit === 1 ? "" : "s"}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "no findings" : parts.join(", ");
}

/**
 * The message text. The title is written by the pull request's author, so it
 * is escaped and cut: it cannot add a link, mention a channel, or flood it.
 */
export function formatNotice(notice: ReviewReadyNotice): string {
  const title = escapeForSlack(notice.title).slice(0, 200);
  const where = `${escapeForSlack(notice.repository)}#${notice.pullNumber}`;
  return [
    `Review waiting: *${title}* (${where}, by ${escapeForSlack(notice.author)})`,
    `First pass: ${countPhrase(notice)}. <${notice.reviewUrl}|Open the review>`,
  ].join("\n");
}

/** A webhook URL is accepted only over https, so the message is not sent in the clear. */
export function parseWebhookUrl(value: string | undefined): URL | null {
  if (!value?.trim()) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const TIMEOUT_MS = 5_000;

/**
 * A notifier that posts `{ text }` as JSON, the shape Slack's incoming
 * webhooks accept and most chat tools can take. Returns null when no usable
 * URL is configured.
 */
export function webhookNotifier(
  rawUrl: string | undefined,
  send: typeof fetch = fetch,
): Notifier | null {
  const url = parseWebhookUrl(rawUrl);
  if (!url) {
    return null;
  }
  return async (notice) => {
    const response = await send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: formatNotice(notice) }),
      // A slow chat server must not hold up the review.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw Object.assign(new Error("notification rejected"), { status: response.status });
    }
  };
}

/**
 * Sends the notice if a notifier is configured. A failure is logged and
 * swallowed: the review is done and stored, and a chat outage must not turn
 * it into a failed review.
 */
export async function notifyReviewReady(
  notifier: Notifier | null | undefined,
  notice: ReviewReadyNotice,
  reviewId: number,
): Promise<void> {
  if (!notifier) {
    return;
  }
  try {
    await notifier(notice);
  } catch (error) {
    logEvent("notify_failed", { reviewId, error: safeErrorCode(error) });
  }
}
