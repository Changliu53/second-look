import { z } from "zod";

/**
 * Environment variables are validated when they are read, not at import time.
 * Different entry points need different variables (the eval script only needs
 * an Anthropic key, the webhook needs the GitHub App), so one big "everything
 * is required" check at startup would be wrong.
 */

/** process.env, or a plain object in tests. */
export type EnvSource = Record<string, string | undefined>;

const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const limitsSchema = z.object({
  MAX_DIFF_CHARS: positiveInt(120_000),
  MAX_CONTEXT_CHARS: positiveInt(120_000),
  PASTE_MAX_CHARS: positiveInt(20_000),
  PASTE_REQUESTS_PER_HOUR: positiveInt(20),
  PASTE_DAILY_GLOBAL_LIMIT: positiveInt(100),
});

export type Limits = {
  maxDiffChars: number;
  maxContextChars: number;
  pasteMaxChars: number;
  pasteRequestsPerHour: number;
  pasteDailyGlobalLimit: number;
};

export function getLimits(env: EnvSource = process.env): Limits {
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

export function getModelName(env: EnvSource = process.env): string {
  const value = env.ANTHROPIC_MODEL?.trim();
  return value ? value : DEFAULT_MODEL;
}

export function getAppUrl(env: EnvSource = process.env): string {
  const value = env.APP_URL?.trim();
  return (value ? value : "http://localhost:3000").replace(/\/+$/, "");
}

/** Reads a required variable. The error names the variable, never its value. */
export function requireEnv(
  name: string,
  env: EnvSource = process.env,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export type PullRequestRef = { owner: string; name: string; number: number };

const PULL_REQUEST_REF = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;

/**
 * The pull requests shown on the public /example page, written as
 * "owner/repo#number" and separated by commas. Point it at public
 * repositories only: the page shows their published reviews to anyone,
 * signed in or not. Entries that do not parse are ignored.
 *
 * EXAMPLE_PULL_REQUESTS is the current name. DEMO_PULL_REQUEST is the older
 * one and is still read when the new one is not set.
 */
export function getExamplePullRequests(
  env: EnvSource = process.env,
): PullRequestRef[] {
  const refs: PullRequestRef[] = [];
  const configured = env.EXAMPLE_PULL_REQUESTS?.trim() || env.DEMO_PULL_REQUEST || "";
  for (const part of configured.split(",")) {
    const match = PULL_REQUEST_REF.exec(part.trim());
    if (match) {
      refs.push({ owner: match[1]!, name: match[2]!, number: Number(match[3]) });
    }
  }
  return refs;
}
