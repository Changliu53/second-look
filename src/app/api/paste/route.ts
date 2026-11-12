import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getLimits, getModelName, requireEnv } from "@/lib/env";
import { clientIpFromHeaders, hashClientIp } from "@/lib/rate-limit";
import { handlePasteRequest } from "@/paste/handle-paste";
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

  const callerKey = hashClientIp(
    clientIpFromHeaders(request.headers),
    requireEnv("AUTH_SECRET"),
  );

  const response = await handlePasteRequest(rawBody, {
    db: getDb(),
    model: new AnthropicReviewModel(getModelName()),
    limits: getLimits(),
    callerKey,
  });

  const headers = new Headers();
  if (response.httpStatus !== 200 && response.retryAfterSeconds !== undefined) {
    headers.set("Retry-After", String(response.retryAfterSeconds));
  }
  return NextResponse.json(response.body, {
    status: response.httpStatus,
    headers,
  });
}
