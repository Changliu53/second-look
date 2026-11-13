import { NextResponse, type NextRequest } from "next/server";
import { getSignedInLogin } from "@/auth";
import { exportDecisionsFor, type InsightPeriod } from "@/dashboard/service";
import { getAppUrl } from "@/lib/env";
import { dashboardDeps } from "../../deps";

export const dynamic = "force-dynamic";

function readPeriod(value: string | null): InsightPeriod {
  if (value === "all") return null;
  if (value === "30") return 30;
  return 90;
}

/**
 * Downloads every decision on published reviews in the chosen period as CSV,
 * for the repositories the signed-in user may review.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const login = await getSignedInLogin();
  if (!login) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const period = readPeriod(request.nextUrl.searchParams.get("days"));
  const csv = await exportDecisionsFor(login, dashboardDeps(), getAppUrl(), period);
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="second-look-decisions-${day}.csv"`,
      // Decisions are not public; no shared cache may keep a copy.
      "Cache-Control": "private, no-store",
    },
  });
}
