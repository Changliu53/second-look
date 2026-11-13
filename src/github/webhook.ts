import { Webhooks } from "@octokit/webhooks";
import {
  isReviewableAction,
  pullRequestEventSchema,
  type PullRequestEvent,
} from "./webhook-payload";

export type WebhookDecision =
  | { kind: "rejected"; httpStatus: 400 | 401; reason: string }
  | { kind: "ignored"; reason: string }
  | { kind: "closed"; event: PullRequestEvent }
  | { kind: "review"; event: PullRequestEvent };

/**
 * Decides what to do with an incoming webhook request. Checks the signature
 * first, on the raw body: anyone can POST to this URL, and only GitHub knows
 * the shared secret used to sign the payload.
 */
export async function classifyWebhook(input: {
  rawBody: string;
  signature: string | null;
  eventName: string | null;
  secret: string;
}): Promise<WebhookDecision> {
  if (!input.signature) {
    return { kind: "rejected", httpStatus: 401, reason: "missing signature" };
  }
  const webhooks = new Webhooks({ secret: input.secret });
  const isValid = await webhooks.verify(input.rawBody, input.signature);
  if (!isValid) {
    return { kind: "rejected", httpStatus: 401, reason: "invalid signature" };
  }

  if (input.eventName !== "pull_request") {
    return { kind: "ignored", reason: `event ${input.eventName ?? "unknown"}` };
  }

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return { kind: "rejected", httpStatus: 400, reason: "body is not JSON" };
  }
  const parsed = pullRequestEventSchema.safeParse(json);
  if (!parsed.success) {
    return { kind: "rejected", httpStatus: 400, reason: "unexpected payload shape" };
  }

  if (parsed.data.action === "closed") {
    return { kind: "closed", event: parsed.data };
  }
  if (!isReviewableAction(parsed.data.action)) {
    return { kind: "ignored", reason: `action ${parsed.data.action}` };
  }
  if (parsed.data.pull_request.draft === true) {
    return { kind: "ignored", reason: "draft pull request" };
  }
  return { kind: "review", event: parsed.data };
}
