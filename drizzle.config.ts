import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read .env.local on its own.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local; DATABASE_URL may come from the shell.
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Only needed for `npm run db:migrate`; `db:generate` works without it.
    url: process.env.DATABASE_URL ?? "",
  },
});
