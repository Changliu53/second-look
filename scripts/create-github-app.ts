import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_ENV_KEYS,
  buildManifest,
  envLinesFor,
  keysAlreadySet,
  manifestConversionSchema,
  mergeEnv,
} from "../src/github/app-manifest";

/**
 * Creates the GitHub App for a Second Look deployment and writes its
 * credentials to .env.local, instead of clicking through GitHub's settings
 * form and copying five secrets by hand.
 *
 *   npm run github-app:create -- https://your-deployment.example.com "Second Look (your-team)"
 *
 * It opens nothing by itself. It prints a local URL; you open it, GitHub asks
 * you to confirm the app, and the credentials come back to this script. The
 * secrets are written to .env.local and are never printed.
 */

const PORT = 8787;
// Only this machine may talk to the callback server.
const HOST = "127.0.0.1";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env.local");

const [appUrl, appName = "Second Look"] = process.argv.slice(2);
if (!appUrl || !/^https?:\/\//.test(appUrl)) {
  console.error('Usage: npm run github-app:create -- <https://your-deployment> ["App name"]');
  process.exit(1);
}

const manifest = buildManifest(appName, appUrl, `http://localhost:${PORT}/callback`);

// GitHub sends this value back with the code. A callback without it did not
// come from the flow this run started, for example a page in another tab
// pointing the browser at this port with a code for someone else's app.
const state = randomBytes(16).toString("hex");

/** A page that immediately posts the manifest to GitHub. */
function startPage(): string {
  // JSON inside an HTML attribute: escape the characters that would end it.
  const value = JSON.stringify(manifest).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html><title>Create GitHub App</title>
<form id="f" method="post" action="https://github.com/settings/apps/new?state=${state}">
<input type="hidden" name="manifest" value="${value}">
<button>Continue to GitHub</button></form>
<script>document.getElementById("f").submit()</script>`;
}

async function readEnvFile(): Promise<string> {
  try {
    return await readFile(ENV_FILE, "utf8");
  } catch {
    return "";
  }
}

async function exchangeCode(code: string): Promise<string> {
  const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`GitHub refused the code (HTTP ${response.status}). Codes expire after one hour.`);
  }
  const conversion = manifestConversionSchema.parse(await response.json());
  await writeFile(ENV_FILE, mergeEnv(await readEnvFile(), envLinesFor(conversion)));
  return `${conversion.html_url}/installations/new`;
}

// Check before anything exists on GitHub. Creating the app cannot be undone
// from here, so a problem with the env file has to stop the script now.
const alreadySet = keysAlreadySet(await readEnvFile(), APP_ENV_KEYS);
if (alreadySet.length > 0) {
  console.error(
    `.env.local already has values for ${alreadySet.join(", ")}. Nothing was created. ` +
      "Remove those lines first if you want a new app.",
  );
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  response.setHeader("Content-Type", "text/html; charset=utf-8");

  if (url.pathname === "/") {
    response.end(startPage());
    return;
  }
  const code = url.searchParams.get("code");
  if (url.pathname !== "/callback" || !code) {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }
  if (url.searchParams.get("state") !== state) {
    response.statusCode = 400;
    response.end("This callback did not come from the flow this script started.");
    return;
  }

  try {
    const installUrl = await exchangeCode(code);
    response.end(`<p>App created. Credentials were written to .env.local.</p>
<p>Next: <a href="${installUrl}">install it on a repository</a>.</p>`);
    console.log("\nApp created. Credentials written to .env.local (not shown here).");
    console.log(`Install it on a repository: ${installUrl}`);
    console.log("Then copy the five new variables to your host (for example Vercel),");
    console.log(`set APP_URL=${appUrl.replace(/\/+$/, "")} there, and redeploy.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    response.statusCode = 500;
    response.end(`<p>${message.replace(/</g, "&lt;")}</p>`);
    console.error(`\n${message}`);
    process.exitCode = 1;
  }
  server.close();
});

server.listen(PORT, HOST, () => {
  console.log(`Open http://localhost:${PORT} in your browser to create the GitHub App.`);
  console.log(`Webhook and login will point at ${appUrl}`);
});
