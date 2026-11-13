import { describe, expect, it } from "vitest";
import { buildManifest, conflictingKeys, envLinesFor, manifestConversionSchema } from "@/github/app-manifest";

describe("buildManifest", () => {
  const manifest = buildManifest("Second Look (acme)", "https://reviews.acme.test/", "http://localhost:8787/callback");

  it("points the webhook and login callback at the deployment", () => {
    expect(manifest.hook_attributes.url).toBe("https://reviews.acme.test/api/webhooks/github");
    expect(manifest.callback_urls[0]).toBe("https://reviews.acme.test/api/auth/callback/github");
    expect(manifest.url).toBe("https://reviews.acme.test");
  });

  it("asks for the least it needs: no write access to code", () => {
    expect(manifest.default_permissions).toEqual({
      checks: "write", contents: "read", metadata: "read", pull_requests: "write",
    });
    expect(manifest.default_events).toEqual(["pull_request"]);
    expect(manifest.public).toBe(false);
  });
});

describe("envLinesFor", () => {
  const conversion = manifestConversionSchema.parse({
    id: 42, slug: "second-look-acme", html_url: "https://github.com/apps/second-look-acme",
    client_id: "Iv1.abc", client_secret: "secret-value", webhook_secret: "hook-value",
    pem: "-----BEGIN RSA PRIVATE KEY-----\nLINE1\nLINE2\n-----END RSA PRIVATE KEY-----\n",
  });
  const lines = envLinesFor(conversion, "https://reviews.acme.test/");

  it("writes every variable the app reads", () => {
    expect(lines.map((line) => line.split("=")[0])).toEqual([
      "GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_WEBHOOK_SECRET",
      "AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "APP_URL",
    ]);
    expect(lines).toContain("APP_URL=https://reviews.acme.test");
  });

  it("puts the private key on one line so it survives a .env file", () => {
    const keyLine = lines.find((line) => line.startsWith("GITHUB_APP_PRIVATE_KEY="))!;
    expect(keyLine).not.toContain("\n");
    expect(keyLine).toContain("LINE1\\nLINE2");
    // The app turns the literal \n back into newlines when it loads the key.
    const restored = keyLine.split('"')[1]!.replace(/\\n/g, "\n");
    expect(restored).toBe(conversion.pem.trim());
  });

  it("rejects a response that is missing a credential", () => {
    expect(manifestConversionSchema.safeParse({ id: 1, slug: "x" }).success).toBe(false);
  });
});

describe("conflictingKeys", () => {
  it("names variables that are already set, ignoring comments and blanks", () => {
    const existing = "# GITHUB_APP_ID=old\nDATABASE_URL=x\n\nAPP_URL=http://localhost:3000\n";
    expect(conflictingKeys(existing, ["GITHUB_APP_ID=1", "APP_URL=https://a.test"])).toEqual(["APP_URL"]);
    expect(conflictingKeys("", ["GITHUB_APP_ID=1"])).toEqual([]);
  });
});
