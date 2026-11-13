import { countDiffChars, type FileDiff } from "./diff";

/**
 * When a pull request is larger than one review can hold, the first pass
 * reviews the files most likely to hide an expensive mistake and lists the
 * rest as not reviewed, instead of reviewing nothing.
 *
 * The ranking is a fixed list of path patterns, not a model call: it has to
 * be cheap, predictable, and explainable to the reviewer ("migrations and
 * access checks first, tests and docs last").
 */

type Rule = { pattern: RegExp; weight: number };

// Higher first. A file takes the weight of its best matching rule.
const RULES: Rule[] = [
  // Schema and data changes: the "what happens to existing rows" class.
  { pattern: /(^|\/)migrations?\//i, weight: 100 },
  { pattern: /\.sql$/i, weight: 100 },
  { pattern: /(dbcontext|modelsnapshot)\.cs$/i, weight: 90 },
  { pattern: /(^|\/)(schema|prisma\/schema)\.(ts|prisma)$/i, weight: 90 },
  // Who may do what.
  { pattern: /(auth|permission|polic(y|ies)|tenan(t|cy)|security|session|login|password|token|secret|crypto|acl|role)/i, weight: 80 },
  // Where outside input arrives and where data is read and written.
  { pattern: /(controller|endpoint|handler|route|api\/|webhook|resolver|middleware)/i, weight: 60 },
  { pattern: /(repository|service|queries|query|store|dao)\b/i, weight: 50 },
  // Configuration that changes what runs in production.
  { pattern: /(^|\/)(dockerfile|docker-compose[^/]*|\.github\/workflows\/[^/]+|appsettings[^/]*\.json|next\.config\.[^/]+|vercel\.json)$/i, weight: 45 },
  // Everything else that is code sits at 20 (the default below).
  // Least likely to hold a production bug.
  { pattern: /(^|\/)(tests?|__tests__|spec|specs|fixtures?|__mocks__|e2e)\//i, weight: 5 },
  { pattern: /\.(test|spec)\.[^/]+$/i, weight: 5 },
  { pattern: /\.(md|mdx|txt|rst|css|scss|svg)$/i, weight: 2 },
];

const DEFAULT_WEIGHT = 20;

/** How much a file matters to a first pass. Higher is reviewed first. */
export function filePriority(path: string): number {
  let best: number | null = null;
  for (const rule of RULES) {
    if (rule.pattern.test(path)) {
      // A test of an auth module is still a test: the low weights win.
      if (rule.weight < 10) {
        return rule.weight;
      }
      best = Math.max(best ?? 0, rule.weight);
    }
  }
  return best ?? DEFAULT_WEIGHT;
}

/**
 * Splits files into those that fit in `budget` characters of diff, highest
 * priority first, and those that do not. Files of equal priority keep their
 * order in the diff. A file that does not fit is left out whole, and smaller
 * files after it can still be taken: a partial file would read to the model
 * as code that ends mid-function.
 */
export function selectWithinBudget(
  files: FileDiff[],
  budget: number,
): { included: FileDiff[]; omitted: FileDiff[] } {
  const ranked = files
    .map((file, index) => ({ file, index, priority: filePriority(file.path) }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index);

  const chosen = new Set<FileDiff>();
  let used = 0;
  for (const { file } of ranked) {
    const size = countDiffChars([file]);
    if (used + size <= budget) {
      chosen.add(file);
      used += size;
    }
  }
  // Back in diff order, which is how a reviewer reads them.
  return {
    included: files.filter((file) => chosen.has(file)),
    omitted: files.filter((file) => !chosen.has(file)),
  };
}
