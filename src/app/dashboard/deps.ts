import { getDb } from "@/db/client";
import type { DashboardDeps } from "@/dashboard/service";
import { PermissionCache } from "@/github/access";
import { getInstallationClient } from "@/github/client";

// One per server instance, shared by every request it handles.
const permissions = new PermissionCache();

/** Production wiring for the dashboard service functions. */
export function dashboardDeps(): DashboardDeps {
  return { db: getDb(), githubFor: getInstallationClient, permissions };
}
