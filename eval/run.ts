import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AnthropicReviewModel } from "../src/review/anthropic-model";
import { reviewChange, type ReviewResult } from "../src/review/engine";
import { getLimits, getModelName } from "../src/lib/env";
import {
  evalCaseSchema,
  scoreCase,
  sumScores,
  type CaseScore,
  type EvalCase,
} from "./score";

/**
 * Planted-bug eval. Runs the real review engine against the sample PRs in
 * eval/cases and reports how many planted bugs were found and how many false
 * positives were raised. Needs ANTHROPIC_API_KEY. Usage: npm run eval
 */

const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(EVAL_DIR, "cases");
const RESULTS_FILE = path.join(EVAL_DIR, "results", "latest.json");

type LoadedCase = { name: string; diff: string; spec: EvalCase };

type CaseOutcome = {
  name: string;
  score: CaseScore | null;
  result: ReviewResult | null;
  error: string | null;
};

function loadLocalEnv(): void {
  try {
    process.loadEnvFile(path.join(EVAL_DIR, "..", ".env.local"));
  } catch {
    // No .env.local. Variables may come from the shell instead.
  }
}

async function loadCases(): Promise<LoadedCase[]> {
  const names = (await readdir(CASES_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const cases: LoadedCase[] = [];
  for (const name of names) {
    const dir = path.join(CASES_DIR, name);
    const diff = await readFile(path.join(dir, "diff.patch"), "utf8");
    const raw = JSON.parse(await readFile(path.join(dir, "case.json"), "utf8"));
    cases.push({ name, diff, spec: evalCaseSchema.parse(raw) });
  }
  return cases;
}

async function runCase(
  loaded: LoadedCase,
  model: AnthropicReviewModel,
): Promise<CaseOutcome> {
  try {
    const result = await reviewChange(
      {
        diff: loaded.diff,
        title: loaded.spec.title,
        description: loaded.spec.description,
      },
      model,
      getLimits(),
    );
    const score = scoreCase(
      loaded.spec,
      result.findings,
      result.summary.riskLevel,
    );
    return { name: loaded.name, score, result, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { name: loaded.name, score: null, result: null, error: message };
  }
}

/** How many cases are sent to the model at once. */
const CONCURRENCY = 4;

/**
 * Runs every case, a few at a time, and returns the outcomes in case order.
 * Each worker takes the next unclaimed case until none are left.
 */
async function runAll(
  cases: LoadedCase[],
  model: AnthropicReviewModel,
): Promise<CaseOutcome[]> {
  const outcomes = new Array<CaseOutcome>(cases.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < cases.length) {
      const index = next;
      next += 1;
      outcomes[index] = await runCase(cases[index]!, model);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return outcomes;
}

function printOutcome(outcome: CaseOutcome): void {
  if (outcome.score === null) {
    console.log(`ERROR  ${outcome.name}: ${outcome.error}`);
    return;
  }
  const { score } = outcome;
  const missed = score.plantedFound < score.plantedTotal;
  const failed =
    missed || score.falsePositives.length > 0 || score.riskLevelViolation;
  const label = failed ? "FAIL " : "PASS ";
  console.log(
    `${label}  ${outcome.name.padEnd(20)} found ${score.plantedFound}/${score.plantedTotal}` +
      `  false positives ${score.falsePositives.length}` +
      `  extra nits ${score.extraNits.length}` +
      (score.riskLevelViolation ? "  RISK LEVEL OVERRIDDEN" : ""),
  );
  for (const finding of score.falsePositives) {
    console.log(
      `         false positive: [${finding.severity}/${finding.category}] ` +
        `${finding.file}:${finding.startLine} ${finding.explanation.slice(0, 100)}`,
    );
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  const model = new AnthropicReviewModel(getModelName());
  const cases = await loadCases();
  console.log(`Running ${cases.length} eval cases with ${model.name}\n`);

  const outcomes = await runAll(cases, model);
  for (const outcome of outcomes) {
    printOutcome(outcome);
  }

  const scores = outcomes.flatMap((o) => (o.score ? [o.score] : []));
  const totals = sumScores(scores);
  const errors = outcomes.filter((o) => o.error !== null).length;
  const inputTokens = outcomes.reduce(
    (n, o) => n + (o.result?.usage.inputTokens ?? 0),
    0,
  );
  const outputTokens = outcomes.reduce(
    (n, o) => n + (o.result?.usage.outputTokens ?? 0),
    0,
  );

  console.log("\n--- Totals ---");
  console.log(`Planted bugs found: ${totals.plantedFound}/${totals.plantedTotal}`);
  console.log(`False positives:    ${totals.falsePositives}`);
  console.log(`Extra nits:         ${totals.extraNits}`);
  console.log(`Risk level overridden by injected text: ${totals.riskLevelViolations}`);
  console.log(`Recall ${(totals.recall * 100).toFixed(0)}%  Precision ${(totals.precision * 100).toFixed(0)}%`);
  console.log(`Cases that errored: ${errors}`);
  console.log(`Tokens: ${inputTokens} in, ${outputTokens} out`);

  // A run where cases errored is not a valid score. Do not save it, so a bad
  // API key can never overwrite the last real result.
  if (errors > 0) {
    console.log("\nSome cases errored, so this run is not a valid score. Results were not saved.");
    process.exitCode = 1;
    return;
  }

  await mkdir(path.dirname(RESULTS_FILE), { recursive: true });
  await writeFile(
    RESULTS_FILE,
    JSON.stringify(
      {
        model: model.name,
        ranAt: new Date().toISOString(),
        totals,
        errors,
        tokens: { input: inputTokens, output: outputTokens },
        cases: outcomes.map((o) => ({
          name: o.name,
          error: o.error,
          plantedFound: o.score?.plantedFound ?? 0,
          plantedTotal: o.score?.plantedTotal ?? 0,
          falsePositives: o.score?.falsePositives.length ?? 0,
          extraNits: o.score?.extraNits.length ?? 0,
          riskLevelViolation: o.score?.riskLevelViolation ?? false,
        })),
      },
      null,
      2,
    ) + "\n",
  );
}

await main();
