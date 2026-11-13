import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { logEvent, safeErrorCode } from "@/lib/log";

// Never cached: a monitor asking twice must get two answers.
export const dynamic = "force-dynamic";

/**
 * For an uptime monitor. 200 when the app can reach its database, 503 when
 * it cannot. It says nothing else: no version, no configuration, no counts,
 * because it needs no login and anyone can call it.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logEvent("health_check_failed", { error: safeErrorCode(error) });
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
