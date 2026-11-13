import { z } from "zod";

export const SEVERITIES = ["critical", "warning", "nit"] as const;

export const CATEGORIES = [
  "bug",
  "security",
  "access-control",
  "data-loss",
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

export const FOLLOW_UP_STATUSES = ["fixed", "still_present", "unclear"] as const;

/**
 * The model's verdict on one finding from the previous review of the same
 * pull request: did the new commit fix it?
 */
export const followUpSchema = z.object({
  id: z
    .string()
    .describe('The id of the earlier finding, exactly as given, for example "P12".'),
  status: z.enum(FOLLOW_UP_STATUSES),
  note: z
    .string()
    .describe("One sentence on what changed, or why it is still a problem."),
});

/** Summary and findings: what every review has. */
export const reviewCoreSchema = z.object({
  summary: summarySchema,
  findings: z.array(findingSchema),
});

/** The full shape the model must return. Validated on every response. */
export const reviewOutputSchema = reviewCoreSchema.extend({
  followUp: z
    .array(followUpSchema)
    .describe(
      "One entry per earlier confirmed finding you were given. Empty when there was no earlier review.",
    ),
});

export type Severity = (typeof SEVERITIES)[number];
export type Category = (typeof CATEGORIES)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];
export type ReviewFinding = z.infer<typeof findingSchema>;
export type ReviewSummary = z.infer<typeof summarySchema>;
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;
export type ReviewCore = z.infer<typeof reviewCoreSchema>;
export type FollowUp = z.infer<typeof followUpSchema>;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];
