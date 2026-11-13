import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { reviews } from "@/db/schema";
import { isOverBudget, startOfMonthUtc } from "@/lib/budget";
import { createTestDb } from "./helpers/test-db";

let db: Database;

beforeEach(async () => {
  db = await createTestDb();
});

async function spent(tokensIn: number, tokensOut: number, at: Date) {
  await db.insert(reviews).values({
    source: "paste",
    status: "completed",
    inputTokens: tokensIn,
    outputTokens: tokensOut,
    createdAt: at,
  });
}

describe("startOfMonthUtc", () => {
  it("is midnight UTC on the first of the month", () => {
    expect(startOfMonthUtc(new Date("2026-11-13T23:59:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(startOfMonthUtc(new Date("2026-01-01T00:00:00Z")).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("isOverBudget", () => {
  const now = new Date("2026-11-13T12:00:00Z");

  it("is never over without a budget", async () => {
    await spent(10_000_000, 0, now);
    expect(await isOverBudget(db, null, now)).toBe(false);
  });

  it("counts input and output tokens of this month only", async () => {
    await spent(900, 50, new Date("2026-10-31T23:59:00Z"));
    await spent(400, 50, new Date("2026-11-02T08:00:00Z"));

    expect(await isOverBudget(db, 1_000, now)).toBe(false);
    await spent(500, 50, new Date("2026-11-10T08:00:00Z"));
    expect(await isOverBudget(db, 1_000, now)).toBe(true);
  });
});
