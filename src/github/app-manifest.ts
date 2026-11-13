import { z } from "zod";

/**
 * GitHub's "app manifest" flow creates a GitHub App from a JSON description,
 * so nobody has to fill in the settings form by hand: permissions, webhook
 * URL, and callback URL all come from here. After the user approves, GitHub
 * hands back the app id, private key, webhook secret, and OAuth credentials.
 * https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 */

export type AppManifest = {
  name: string;
  url: string;
  hook_attributes: { url: string; active: boolean };
  redirect_url: string;
  callback_urls: string[];
  public: boolean;
  default_permissions: Record<string, "read" | "write">;
  default_events: string[];
  request_oauth_on_install: boolean;
};

/**
 * @param appUrl where Second Look is deployed, e.g. https://reviews.example.com
 * @param redirectUrl where GitHub sends the one-time code after creation
 */
export function buildManifest(name: string, appUrl: string, redirectUrl: string): AppManifest {
  const base = appUrl.replace(/\/+$/, "");
  return {
    name,
    url: base,
    hook_attributes: { url: `${base}/api/webhooks/github`, active: true },
    redirect_url: redirectUrl,
    callback_urls: [
      `${base}/api/auth/callback/github`,
      "http://localhost:3000/api/auth/callback/github",
    ],
    // Private: only the account that creates it can install it.
    public: false,
    // The least the app needs: read code, write checks and PR reviews.
    default_permissions: {
      checks: "write",
      contents: "read",
      metadata: "read",
      pull_requests: "write",
    },
    default_events: ["pull_request"],
    request_oauth_on_install: false,
  };
}

/** What GitHub returns when the one-time code is exchanged. */
export const manifestConversionSchema = z.object({
  id: z.number().int(),
  slug: z.string(),
  html_url: z.string().url(),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  webhook_secret: z.string().min(1),
  pem: z.string().min(1),
});

export type ManifestConversion = z.infer<typeof manifestConversionSchema>;

/**
 * The .env lines for a newly created app. The PEM is put on one line.
 * APP_URL is not included: .env.local usually keeps it at localhost for
 * development, and the deployment URL belongs in the host's settings.
 */
export function envLinesFor(conversion: ManifestConversion): string[] {
  const pem = conversion.pem.trim().replace(/\r?\n/g, "\\n");
  return [
    `GITHUB_APP_ID=${conversion.id}`,
    `GITHUB_APP_PRIVATE_KEY="${pem}"`,
    `GITHUB_WEBHOOK_SECRET=${conversion.webhook_secret}`,
    `AUTH_GITHUB_ID=${conversion.client_id}`,
    `AUTH_GITHUB_SECRET=${conversion.client_secret}`,
  ];
}

/** The variables the script writes. Checked before anything is created. */
export const APP_ENV_KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "AUTH_GITHUB_ID",
  "AUTH_GITHUB_SECRET",
] as const;

function keyOf(line: string): string {
  return line.split("=")[0]?.trim() ?? "";
}

function valueOf(line: string): string {
  return line.slice(line.indexOf("=") + 1).trim();
}

function isAssignment(line: string): boolean {
  return line.includes("=") && !line.trim().startsWith("#");
}

/**
 * Names from `keys` that already have a real value in the env file. An empty
 * placeholder such as "GITHUB_APP_ID=", which is what a fresh copy of
 * .env.example contains, does not count.
 */
export function keysAlreadySet(existingEnv: string, keys: readonly string[]): string[] {
  const set = new Set(
    existingEnv
      .split("\n")
      .filter((line) => isAssignment(line) && valueOf(line) !== "")
      .map(keyOf),
  );
  return keys.filter((key) => set.has(key));
}

/**
 * Returns the env file with the new lines added. A new line replaces an empty
 * placeholder for the same key in place; otherwise it is appended.
 */
export function mergeEnv(existingEnv: string, newLines: string[]): string {
  const pending = new Map(newLines.map((line) => [keyOf(line), line]));

  const merged = existingEnv.split("\n").map((line) => {
    const replacement = isAssignment(line) ? pending.get(keyOf(line)) : undefined;
    if (replacement === undefined || valueOf(line) !== "") {
      return line;
    }
    pending.delete(keyOf(line));
    return replacement;
  });

  const body = merged.join("\n").replace(/\n+$/, "");
  const appended = [...pending.values()];
  const parts = body === "" ? appended : [body, ...appended];
  return `${parts.join("\n")}\n`;
}
