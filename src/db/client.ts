import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { requireEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * The database type every query function accepts. It is the driver-independent
 * Drizzle type, so production (Neon over HTTP) and tests (in-process PGlite)
 * run the same query code.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

let cachedDb: Database | undefined;

/**
 * Returns the shared database handle. Created lazily so that importing this
 * module (for example during `next build`) does not require DATABASE_URL.
 */
export function getDb(): Database {
  if (!cachedDb) {
    const sql = neon(requireEnv("DATABASE_URL"));
    cachedDb = drizzle(sql, { schema });
  }
  return cachedDb;
}
