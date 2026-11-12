import { getDb } from "@/db/client";
import type { DashboardDeps } from "@/dashboard/service";
import { getInstallationClient } from "@/github/client";

/** Production wiring for the dashboard service functions. */
export function dashboardDeps(): DashboardDeps {
  return { db: getDb(), githubFor: getInstallationClient };
}
