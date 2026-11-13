import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXAMPLES } from "../src/examples/examples";
import { getLimits, getModelName } from "../src/lib/env";
import { AnthropicReviewModel } from "../src/review/anthropic-model";
import { reviewChange } from "../src/review/engine";
import { toReviewableDiff } from "../src/review/paste";

/**
 * Runs the real review engine once on every built-in example and saves the
 * results. The home page shows these saved results, so the examples load
 * instantly and cost nothing per visitor. Re-run after changing the prompt
 * or the examples: npm run examples:build
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "src", "examples", "saved-results.json");

try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // Variables may come from the shell instead.
}

const model = new AnthropicReviewModel(getModelName());
const results: Record<string, unknown> = {};

for (const example of EXAMPLES) {
  const result = await reviewChange(
    { diff: toReviewableDiff(example.code), description: example.description },
    model,
    getLimits(),
  );
  results[example.id] = {
    summary: result.summary,
    findings: result.findings,
    model: result.model,
    generatedAt: new Date().toISOString().slice(0, 10),
  };
  console.log(`${example.id}: ${result.findings.length} findings, risk ${result.summary.riskLevel}`);
}

await writeFile(OUTPUT, JSON.stringify(results, null, 2) + "\n");
console.log(`Saved to ${path.relative(ROOT, OUTPUT)}`);
