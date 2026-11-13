import { after, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { markPullRequestClosed } from "@/db/queries";
import { getInstallationClient } from "@/github/client";
import { reviewPullRequest } from "@/github/review-pull-request";
import { classifyWebhook } from "@/github/webhook";
import { getAppUrl, getLimits, getModelName, requireEnv } from "@/lib/env";
import { logEvent, safeErrorCode } from "@/lib/log";
import { AnthropicReviewModel } from "@/review/anthropic-model";

// The review runs in after(), which shares this function's time limit.
// 300 seconds is the maximum on Vercel's Hobby plan.
export const maxDuration = 300;

export async function POST(request: Request): Promise<NextResponse> {
  const decision = await classifyWebhook({
    rawBody: await request.text(),
    signature: request.headers.get("x-hub-signature-256"),
    eventName: request.headers.get("x-github-event"),
    secret: requireEnv("GITHUB_WEBHOOK_SECRET"),
  });

  if (decision.kind === "rejected") {
    return NextResponse.json({ error: decision.reason }, { status: decision.httpStatus });
  }
  if (decision.kind === "ignored") {
    return NextResponse.json({ ignored: decision.reason });
  }

  const event = decision.event;
  if (decision.kind === "closed") {
    // One small update, done before responding. No background work needed.
    await markPullRequestClosed(getDb(), {
      githubRepoId: event.repository.id,
      number: event.number,
    });
    return NextResponse.json({ closed: true });
  }

  // GitHub expects an answer within 10 seconds and a review takes longer.
  // after() lets us respond now and keep the function alive for the work.
  after(async () => {
    try {
      await reviewPullRequest(event, {
        db: getDb(),
        github: await getInstallationClient(event.installation.id),
        model: new AnthropicReviewModel(getModelName()),
        limits: getLimits(),
        appUrl: getAppUrl(),
      });
    } catch (error) {
      // reviewPullRequest records its own failures. This catches setup
      // errors, such as a missing env var or an unreachable database.
      logEvent("webhook_review_crashed", { error: safeErrorCode(error) });
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
