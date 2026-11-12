import { z } from "zod";
import type { Database } from "@/db/client";
import { countPasteReviewsSince, recordPasteReview } from "@/db/queries";
import type { Limits } from "@/lib/env";
import { consumeHourlyLimit } from "@/lib/rate-limit";
import { ReviewError, reviewChange, type ReviewModel } from "@/review/engine";
import { toReviewableDiff } from "@/review/paste";
import type { ReviewFinding, ReviewSummary } from "@/review/schema";

/**
 * Paste mode: review pasted code or a diff without GitHub. The endpoint is
 * public and every call costs money, so it is guarded three ways: an input
 * size cap, a per-caller hourly limit, and a daily cap across all callers.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type PasteDeps = {
  db: Database;
  model: ReviewModel;
  limits: Limits;
  /** Hashed caller identity, used as the rate-limit key. */
  callerKey: string;
  now?: Date;
};

export type PasteSuccess = {
  status: "completed" | "too_large";
  summary: ReviewSummary;
  findings: ReviewFinding[];
};

export type PasteResponse =
  | { httpStatus: 200; body: PasteSuccess }
  | { httpStatus: 400 | 429 | 502; body: { error: string }; retryAfterSeconds?: number };

function requestSchema(maxChars: number) {
  return z.object({
    code: z
      .string()
      .trim()
      .min(1, "Paste some code or a diff first.")
      .max(maxChars, `Input is too long. The limit is ${maxChars} characters.`),
    description: z.string().trim().max(500).optional(),
  });
}

export async function handlePasteRequest(
  rawBody: unknown,
  deps: PasteDeps,
): Promise<PasteResponse> {
  const now = deps.now ?? new Date();

  // Validate before counting against the limit, so a typo does not use a slot.
  const parsed = requestSchema(deps.limits.pasteMaxChars).safeParse(rawBody);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request.";
    return { httpStatus: 400, body: { error: message } };
  }

  const hourly = await consumeHourlyLimit(
    deps.db,
    deps.callerKey,
    deps.limits.pasteRequestsPerHour,
    now,
  );
  if (!hourly.allowed) {
    return {
      httpStatus: 429,
      body: { error: "Hourly limit reached. Try again later." },
      retryAfterSeconds: Math.ceil((hourly.resetAt.getTime() - now.getTime()) / 1000),
    };
  }

  const usedToday = await countPasteReviewsSince(
    deps.db,
    new Date(now.getTime() - DAY_MS),
  );
  if (usedToday >= deps.limits.pasteDailyGlobalLimit) {
    return {
      httpStatus: 429,
      body: { error: "The demo has reached its daily limit. Try again tomorrow." },
    };
  }

  try {
    const result = await reviewChange(
      {
        diff: toReviewableDiff(parsed.data.code),
        description: parsed.data.description,
      },
      deps.model,
      deps.limits,
    );
    await recordPasteReview(deps.db, result);
    return {
      httpStatus: 200,
      body: {
        status: result.status,
        summary: result.summary,
        findings: result.findings,
      },
    };
  } catch (error) {
    // ReviewError messages are written by us and never contain the input.
    const message =
      error instanceof ReviewError
        ? error.message
        : "The review could not be completed.";
    return { httpStatus: 502, body: { error: message } };
  }
}
