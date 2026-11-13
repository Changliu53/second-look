import type { Database } from "@/db/client";
import { tokensUsedSince } from "@/db/queries";

/** Midnight UTC on the first day of `now`'s month: when a monthly budget resets. */
export function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Whether this month's model budget is used up. Checked before each model
 * call, so the last call of a month can go over by one review; a hard stop
 * mid-call is not possible and a review cut in half is worse.
 */
export async function isOverBudget(
  db: Database,
  budget: number | null,
  now: Date = new Date(),
): Promise<boolean> {
  if (budget === null) {
    return false;
  }
  return (await tokensUsedSince(db, startOfMonthUtc(now))) >= budget;
}
