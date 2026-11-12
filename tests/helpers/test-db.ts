import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";

/**
 * Creates a fresh in-process Postgres and applies the real migration files.
 * Query tests therefore run against the same SQL schema as production.
 */
export async function createTestDb(): Promise<Database> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, {
    migrationsFolder: path.join(__dirname, "..", "..", "drizzle"),
  });
  return db;
}

export async function seedPullRequest(db: Database) {
  const { upsertRepository, upsertPullRequest } = await import("@/db/queries");
  const repository = await upsertRepository(db, {
    githubRepoId: 1001,
    installationId: 42,
    owner: "acme",
    name: "shop",
  });
  const pullRequest = await upsertPullRequest(db, {
    repositoryId: repository.id,
    number: 7,
    title: "Add checkout",
    authorLogin: "sam",
    headSha: "sha-1",
  });
  return { repository, pullRequest };
}
