import { z } from "zod";

/**
 * Environment variables are validated when they are read, not at import time.
 * Different entry points need different variables (the eval script only needs
 * an Anthropic key, the webhook needs the GitHub App), so one big "everything
 * is required" check at startup would be wrong.
 */

const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const limitsSchema = z.object({
  MAX_DIFF_CHARS: positiveInt(60_000),
  MAX_CONTEXT_CHARS: positiveInt(120_000),
  PASTE_MAX_CHARS: positiveInt(20_000),
  PASTE_REQUESTS_PER_HOUR: positiveInt(5),
  PASTE_DAILY_GLOBAL_LIMIT: positiveInt(100),
});

export type Limits = {
  maxDiffChars: number;
  maxContextChars: number;
  pasteMaxChars: number;
  pasteRequestsPerHour: number;
  pasteDailyGlobalLimit: number;
};

export function getLimits(env: NodeJS.ProcessEnv = process.env): Limits {
  const parsed = limitsSchema.parse(env);
  return {
    maxDiffChars: parsed.MAX_DIFF_CHARS,
    maxContextChars: parsed.MAX_CONTEXT_CHARS,
    pasteMaxChars: parsed.PASTE_MAX_CHARS,
    pasteRequestsPerHour: parsed.PASTE_REQUESTS_PER_HOUR,
    pasteDailyGlobalLimit: parsed.PASTE_DAILY_GLOBAL_LIMIT,
  };
}

export const DEFAULT_MODEL = "claude-opus-5-5";

export function getModelName(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.ANTHROPIC_MODEL?.trim();
  return value ? value : DEFAULT_MODEL;
}

export function getAppUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.APP_URL?.trim();
  return (value ? value : "http://localhost:3000").replace(/\/+$/, "");
}

/** Reads a required variable. The error names the variable, never its value. */
export function requireEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
