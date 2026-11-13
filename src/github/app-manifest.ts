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

/** The .env lines for a newly created app. The PEM is put on one line. */
export function envLinesFor(conversion: ManifestConversion, appUrl: string): string[] {
  const pem = conversion.pem.trim().replace(/\r?\n/g, "\\n");
  return [
    `GITHUB_APP_ID=${conversion.id}`,
    `GITHUB_APP_PRIVATE_KEY="${pem}"`,
    `GITHUB_WEBHOOK_SECRET=${conversion.webhook_secret}`,
    `AUTH_GITHUB_ID=${conversion.client_id}`,
    `AUTH_GITHUB_SECRET=${conversion.client_secret}`,
    `APP_URL=${appUrl.replace(/\/+$/, "")}`,
  ];
}

/** Names of variables in `existingEnv` that the new lines would duplicate. */
export function conflictingKeys(existingEnv: string, newLines: string[]): string[] {
  const existing = new Set(
    existingEnv
      .split("\n")
      .map((line) => line.split("=")[0]?.trim() ?? "")
      .filter((key) => key !== "" && !key.startsWith("#")),
  );
  return newLines.map((line) => line.split("=")[0] ?? "").filter((key) => existing.has(key));
}
