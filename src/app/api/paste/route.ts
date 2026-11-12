import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getLimits, getModelName, requireEnv } from "@/lib/env";
import { clientIpFromHeaders, hashClientIp } from "@/lib/rate-limit";
import { handlePasteRequest, type PasteDeps } from "@/paste/handle-paste";
import { AnthropicReviewModel } from "@/review/anthropic-model";

// A review is one model call that can take a minute or more.
export const maxDuration = 300;

export async function POST(request: Request): Promise<NextResponse> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  let deps: PasteDeps;
  try {
    deps = {
      db: getDb(),
      model: new AnthropicReviewModel(getModelName()),
      limits: getLimits(),
      callerKey: hashClientIp(
        clientIpFromHeaders(request.headers),
        requireEnv("AUTH_SECRET"),
      ),
    };
  } catch {
    // A required env var is missing. Say so without naming it to the caller.
    return NextResponse.json(
      { error: "Paste mode is not configured on this server." },
      { status: 503 },
    );
  }

  const response = await handlePasteRequest(rawBody, deps);

  const headers = new Headers();
  if (response.httpStatus !== 200 && response.retryAfterSeconds !== undefined) {
    headers.set("Retry-After", String(response.retryAfterSeconds));
  }
  return NextResponse.json(response.body, {
    status: response.httpStatus,
    headers,
  });
}
