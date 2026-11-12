import { createHmac } from "node:crypto";
import type { Database } from "@/db/client";
import { incrementRateLimit } from "@/db/queries";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Hashes the caller's IP with a server-side secret. We need a stable key per
 * caller, not the address itself, so the raw IP never reaches the database.
 */
export function hashClientIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

/** Start of the fixed one-hour window that contains `now`. */
export function hourWindowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
}

/**
 * Reads the client IP from the proxy header. On Vercel the first entry of
 * x-forwarded-for is set by the platform and cannot be spoofed by the client.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first ? first : "unknown";
}

export type RateLimitResult = {
  allowed: boolean;
  /** When the current window ends and the caller may try again. */
  resetAt: Date;
};

/**
 * Fixed-window limit: at most `limit` requests per caller per clock hour.
 * A fixed window can let through up to 2x the limit across a window boundary.
 * That is fine here; the goal is to cap spend, not to be exact.
 */
export async function consumeHourlyLimit(
  db: Database,
  key: string,
  limit: number,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const windowStart = hourWindowStart(now);
  const count = await incrementRateLimit(db, key, windowStart);
  return {
    allowed: count <= limit,
    resetAt: new Date(windowStart.getTime() + HOUR_MS),
  };
}
