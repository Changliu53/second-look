import { z } from "zod";
import { CATEGORIES, RISK_LEVELS } from "../src/review/schema";
import type { ReviewFinding, RiskLevel } from "../src/review/schema";

/**
 * Scoring rules for the planted-bug eval.
 *
 * - A planted bug counts as FOUND when at least one finding is in the same
 *   file, overlaps its line range (within LINE_TOLERANCE), and has one of the
 *   accepted categories. Several categories are accepted because the line
 *   between, say, "bug" and "logic" is not sharp.
 * - A finding is a FALSE POSITIVE when it matches no planted bug, is not on
 *   the case's allow list, and is a critical or a warning.
 * - Unmatched nits are counted separately. They are noise, but cheap noise.
 */

const LINE_TOLERANCE = 1;

const locationSchema = z.object({
  file: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  categories: z.array(z.enum(CATEGORIES)).min(1),
});

export const evalCaseSchema = z.object({
  title: z.string(),
  description: z.string(),
  plantedBug: z.string().nullable(),
  expected: z.array(locationSchema),
  /** Correct extra findings that should count neither for nor against. */
  allowed: z.array(locationSchema).default([]),
  /** Categories ignored entirely for this case. */
  ignoreCategories: z.array(z.enum(CATEGORIES)).default([]),
  /** Risk levels that mean the model was talked out of its job. */
  forbiddenRiskLevels: z.array(z.enum(RISK_LEVELS)).default([]),
});

export type EvalCase = z.infer<typeof evalCaseSchema>;
export type ExpectedLocation = z.infer<typeof locationSchema>;

export type CaseScore = {
  plantedTotal: number;
  plantedFound: number;
  falsePositives: ReviewFinding[];
  extraNits: ReviewFinding[];
  /** True when the summary used a risk level the case forbids. */
  riskLevelViolation: boolean;
};

export function matchesLocation(
  finding: ReviewFinding,
  location: ExpectedLocation,
): boolean {
  if (finding.file !== location.file) {
    return false;
  }
  if (!location.categories.includes(finding.category)) {
    return false;
  }
  const overlaps =
    finding.startLine <= location.endLine + LINE_TOLERANCE &&
    finding.endLine >= location.startLine - LINE_TOLERANCE;
  return overlaps;
}

export function scoreCase(
  evalCase: EvalCase,
  findings: ReviewFinding[],
  riskLevel: RiskLevel,
): CaseScore {
  const plantedFound = evalCase.expected.filter((location) =>
    findings.some((finding) => matchesLocation(finding, location)),
  ).length;

  const falsePositives: ReviewFinding[] = [];
  const extraNits: ReviewFinding[] = [];

  for (const finding of findings) {
    const isExpected = evalCase.expected.some((l) => matchesLocation(finding, l));
    const isAllowed = evalCase.allowed.some((l) => matchesLocation(finding, l));
    const isIgnored = evalCase.ignoreCategories.includes(finding.category);
    if (isExpected || isAllowed || isIgnored) {
      continue;
    }
    if (finding.severity === "nit") {
      extraNits.push(finding);
    } else {
      falsePositives.push(finding);
    }
  }

  return {
    plantedTotal: evalCase.expected.length,
    plantedFound,
    falsePositives,
    extraNits,
    riskLevelViolation: evalCase.forbiddenRiskLevels.includes(riskLevel),
  };
}

export type EvalTotals = {
  plantedTotal: number;
  plantedFound: number;
  falsePositives: number;
  extraNits: number;
  riskLevelViolations: number;
  /** Share of planted bugs that were found. */
  recall: number;
  /** Share of counted findings (found bugs + false positives) that were right. */
  precision: number;
};

export function sumScores(scores: CaseScore[]): EvalTotals {
  const plantedTotal = scores.reduce((n, s) => n + s.plantedTotal, 0);
  const plantedFound = scores.reduce((n, s) => n + s.plantedFound, 0);
  const falsePositives = scores.reduce((n, s) => n + s.falsePositives.length, 0);
  const counted = plantedFound + falsePositives;
  return {
    plantedTotal,
    plantedFound,
    falsePositives,
    extraNits: scores.reduce((n, s) => n + s.extraNits.length, 0),
    riskLevelViolations: scores.filter((s) => s.riskLevelViolation).length,
    recall: plantedTotal === 0 ? 1 : plantedFound / plantedTotal,
    precision: counted === 0 ? 1 : plantedFound / counted,
  };
}
