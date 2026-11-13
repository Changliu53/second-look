import { getDb } from "@/db/client";
import { getAppUrl, getLimits, getModelName } from "@/lib/env";
import { logEvent, safeErrorCode } from "@/lib/log";
import { AnthropicReviewModel } from "@/review/anthropic-model";
import type { GitHubClient } from "./client";
import { webhookNotifier } from "@/notify/review-ready";
import { reviewPullRequest } from "./review-pull-request";
import type { PullRequestEvent } from "./webhook-payload";

/**
 * Starts a review with the production dependencies. Used by the webhook and
 * by the dashboard's "Run the review again". Resolves with the id of the
 * review row once the run owns it, or null if the run decided not to go
 * ahead (a review for this commit is already running, or the author may not
 * trigger reviews). `done` settles when the whole review has finished, and
 * the caller must keep the function alive until then with after().
 */
export function startReview(
  event: PullRequestEvent,
  github: GitHubClient,
): { claimed: Promise<number | null>; done: Promise<void> } {
  let claim: (reviewId: number) => void = () => {};
  const claimedEarly = new Promise<number>((resolve) => {
    claim = resolve;
  });

  const done = reviewPullRequest(
    event,
    {
      db: getDb(),
      github,
      model: new AnthropicReviewModel(getModelName()),
      limits: getLimits(),
      appUrl: getAppUrl(),
      monthlyTokenBudget: getLimits().monthlyTokenBudget,
      notify: webhookNotifier(process.env.NOTIFY_WEBHOOK_URL),
    },
    { onClaimed: claim },
  ).catch((error: unknown) => {
    // reviewPullRequest records its own failures. This catches setup errors,
    // such as a missing env var or an unreachable database.
    logEvent("review_run_crashed", { error: safeErrorCode(error) });
  });

  // Whichever comes first: the claim, or the run ending without one.
  const claimed = Promise.race([claimedEarly, done.then(() => null)]);
  return { claimed, done };
}
