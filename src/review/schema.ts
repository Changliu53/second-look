import { z } from "zod";

export const SEVERITIES = ["critical", "warning", "nit"] as const;

export const CATEGORIES = [
  "bug",
  "security",
  "logic",
  "error-handling",
  "hallucinated-api",
  "scope-creep",
  "missing-tests",
  "style",
] as const;

export const RISK_LEVELS = ["low", "medium", "high"] as const;

export const findingSchema = z.object({
  file: z
    .string()
    .min(1)
    .describe("Path of the file, exactly as shown in the diff."),
  startLine: z
    .number()
    .int()
    .describe("First line of the problem, as a line number in the NEW file."),
  endLine: z
    .number()
    .int()
    .describe("Last line of the problem (same as startLine for one line)."),
  severity: z.enum(SEVERITIES),
  category: z.enum(CATEGORIES),
  explanation: z
    .string()
    .min(1)
    .describe("What is wrong and why it matters, in plain words."),
  suggestedFix: z
    .string()
    .nullable()
    .describe("A concrete fix, or null if there is no simple one."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("How sure you are that this is a real problem, from 0 to 1."),
});

export const summarySchema = z.object({
  whatChanged: z
    .string()
    .min(1)
    .describe("What this change does, for a reader who does not code."),
  riskLevel: z.enum(RISK_LEVELS),
  doubleCheck: z
    .array(z.string())
    .describe("Concrete things the author should verify before merging."),
});

/** The full shape the model must return. Validated on every response. */
export const reviewOutputSchema = z.object({
  summary: summarySchema,
  findings: z.array(findingSchema),
});

export type Severity = (typeof SEVERITIES)[number];
export type Category = (typeof CATEGORIES)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];
export type ReviewFinding = z.infer<typeof findingSchema>;
export type ReviewSummary = z.infer<typeof summarySchema>;
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;
