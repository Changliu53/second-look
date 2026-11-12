import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Only needed for `npm run db:migrate`; `db:generate` works without it.
    url: process.env.DATABASE_URL ?? "",
  },
});
