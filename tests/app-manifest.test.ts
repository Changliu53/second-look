import { describe, expect, it } from "vitest";
import {
  APP_ENV_KEYS,
  buildManifest,
  envLinesFor,
  keysAlreadySet,
  manifestConversionSchema,
  mergeEnv,
} from "@/github/app-manifest";

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
  const lines = envLinesFor(conversion);

  it("writes every variable the app reads", () => {
    expect(lines.map((line) => line.split("=")[0])).toEqual([...APP_ENV_KEYS]);
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

describe("keysAlreadySet", () => {
  it("does not count the empty placeholders of a fresh .env.example copy", () => {
    const freshCopy = "GITHUB_APP_ID=\nGITHUB_APP_PRIVATE_KEY=\nAPP_URL=http://localhost:3000\n";
    expect(keysAlreadySet(freshCopy, APP_ENV_KEYS)).toEqual([]);
  });

  it("names keys that have a real value, ignoring comments", () => {
    const existing = "# GITHUB_WEBHOOK_SECRET=old\nGITHUB_APP_ID=123\nAUTH_GITHUB_ID= \n";
    expect(keysAlreadySet(existing, APP_ENV_KEYS)).toEqual(["GITHUB_APP_ID"]);
  });
});

describe("mergeEnv", () => {
  it("fills empty placeholders in place and leaves everything else alone", () => {
    const existing = "# Database\nDATABASE_URL=postgres://x\n\nGITHUB_APP_ID=\nAPP_URL=http://localhost:3000\n";
    const merged = mergeEnv(existing, ["GITHUB_APP_ID=42", "AUTH_GITHUB_ID=Iv1.abc"]);

    expect(merged).toBe(
      "# Database\nDATABASE_URL=postgres://x\n\nGITHUB_APP_ID=42\nAPP_URL=http://localhost:3000\nAUTH_GITHUB_ID=Iv1.abc\n",
    );
  });

  it("never leaves the same key defined twice", () => {
    const merged = mergeEnv("GITHUB_APP_ID=\n", ["GITHUB_APP_ID=42"]);
    expect(merged.match(/GITHUB_APP_ID=/g)).toHaveLength(1);
  });

  it("creates the content when there was no file", () => {
    expect(mergeEnv("", ["GITHUB_APP_ID=42"])).toBe("GITHUB_APP_ID=42\n");
  });

  it("keeps a value that contains '=' intact", () => {
    const merged = mergeEnv("AUTH_SECRET=abc==\n", ["GITHUB_APP_ID=42"]);
    expect(merged).toBe("AUTH_SECRET=abc==\nGITHUB_APP_ID=42\n");
  });
});
