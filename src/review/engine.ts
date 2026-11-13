import {
  countDiffChars,
  parseUnifiedDiff,
  renderFileDiff,
  type FileDiff,
} from "./diff";
import { getSkipReason, type SkipReason } from "./filters";
import { selectWithinBudget } from "./prioritize";
import {
  buildPrompt,
  createNonce,
  type BuiltPrompt,
  type EarlierReview,
  type FileContext,
} from "./prompt";
import {
  reviewOutputSchema,
  type FollowUp,
  type ReviewFinding,
  type ReviewSummary,
  type Severity,
} from "./schema";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

/**
 * The only thing the engine needs from a model: send a prompt, get back an
 * object and the token usage. The real implementation calls the Anthropic API;
 * tests pass a fake so the engine's own logic can be tested offline.
 */
export interface ReviewModel {
  readonly name: string;
  generate(prompt: BuiltPrompt): Promise<{ output: unknown; usage: TokenUsage }>;
}

export type ReviewInput = {
  diff: string;
  title?: string;
  description?: string;
  /** Full contents of changed files at the PR head, used as extra context. */
  fileContents?: FileContext[];
  guidelines?: string;
  /** Decisions from the previous review of the same pull request, if any. */
  earlier?: EarlierReview;
};

export type ReviewLimits = {
  maxDiffChars: number;
  maxContextChars: number;
};

export type SkippedFile = {
  path: string;
  /** "over_budget": a code file left out because the pull request is large. */
  reason: SkipReason | "over_budget";
};

export type ReviewResult = {
  status: "completed" | "too_large";
  summary: ReviewSummary;
  findings: ReviewFinding[];
  /** Verdicts on the previous review's confirmed findings. */
  followUp: FollowUp[];
  skippedFiles: SkippedFile[];
  usage: TokenUsage;
  /** Null when no model call was made. */
  model: string | null;
};

export type ReviewErrorCode =
  | "invalid_model_output"
  | "model_refused"
  | "model_output_truncated"
  | "model_request_failed";

/** A failure with a code that is safe to store and show. It never holds code. */
export class ReviewError extends Error {
  constructor(
    readonly code: ReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

const NO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  nit: 2,
};

function splitReviewableFiles(files: FileDiff[]): {
  reviewable: FileDiff[];
  skipped: SkippedFile[];
} {
  const reviewable: FileDiff[] = [];
  const skipped: SkippedFile[] = [];
  for (const file of files) {
    const reason = getSkipReason(file.path, file.isBinary);
    if (reason) {
      skipped.push({ path: file.path, reason });
    } else {
      reviewable.push(file);
    }
  }
  return { reviewable, skipped };
}

function tooLargeSummary(detail: string): ReviewSummary {
  return {
    whatChanged: `This pull request is too large for an automatic review (${detail}).`,
    riskLevel: "high",
    doubleCheck: [
      "Split this pull request into smaller ones that each do one thing, then open them separately.",
      "Large changes are hard to review for people too. Ask an engineer to look at it before merging.",
    ],
  };
}

/** The result stored for a change that is too big to send to the model. */
export function tooLargeResult(detail: string): ReviewResult {
  return {
    status: "too_large",
    summary: tooLargeSummary(detail),
    findings: [],
    followUp: [],
    skippedFiles: [],
    usage: NO_USAGE,
    model: null,
  };
}

function nothingToReviewSummary(): ReviewSummary {
  return {
    whatChanged:
      "This pull request only changes generated files, lockfiles, or binary files, so there was no code to review.",
    riskLevel: "low",
    doubleCheck: [
      "Check that these files were meant to change. Lockfile changes usually come with a dependency change.",
    ],
  };
}

/**
 * Picks the file contents to send as context. Files are added in diff order
 * until the budget is used up; a file that does not fit is left out whole.
 * A partial file is worse than none because the model cannot tell it was cut.
 */
function selectFileContexts(
  reviewable: FileDiff[],
  fileContents: FileContext[],
  maxContextChars: number,
): FileContext[] {
  const contentByPath = new Map(fileContents.map((f) => [f.path, f.content]));
  const selected: FileContext[] = [];
  let used = 0;

  for (const file of reviewable) {
    const content = contentByPath.get(file.path);
    if (content === undefined || file.status === "deleted") {
      continue;
    }
    if (used + content.length > maxContextChars) {
      continue;
    }
    selected.push({ path: file.path, content });
    used += content.length;
  }
  return selected;
}

/**
 * Cleans up findings after schema validation. The schema guarantees the shape;
 * this guards the content: the model may cite a file that is not in the diff
 * or give a reversed line range.
 */
export function normalizeFindings(
  findings: ReviewFinding[],
  reviewable: FileDiff[],
): ReviewFinding[] {
  const knownPaths = new Set(reviewable.map((file) => file.path));
  const normalized: ReviewFinding[] = [];

  for (const finding of findings) {
    if (!knownPaths.has(finding.file)) {
      continue;
    }
    const first = Math.max(1, Math.min(finding.startLine, finding.endLine));
    const last = Math.max(1, Math.max(finding.startLine, finding.endLine));
    normalized.push({ ...finding, startLine: first, endLine: last });
  }

  return normalized.sort(compareFindings);
}

/**
 * Keeps one verdict per earlier confirmed finding. The model may invent an id,
 * repeat one, or skip one; a skipped finding is reported as "unclear" so the
 * reviewer still sees it in the follow-up list.
 */
export function normalizeFollowUp(
  followUp: FollowUp[],
  earlier: EarlierReview | undefined,
): FollowUp[] {
  if (!earlier) {
    return [];
  }
  return earlier.confirmed.map((finding) => {
    const verdict = followUp.find((entry) => entry.id === finding.id);
    return (
      verdict ?? {
        id: finding.id,
        status: "unclear",
        note: "The reviewer model did not say whether this was fixed.",
      }
    );
  });
}

function compareFindings(a: ReviewFinding, b: ReviewFinding): number {
  const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (bySeverity !== 0) {
    return bySeverity;
  }
  const byFile = a.file.localeCompare(b.file);
  if (byFile !== 0) {
    return byFile;
  }
  return a.startLine - b.startLine;
}

/**
 * Runs one review. This function knows nothing about GitHub, HTTP, or the
 * database, so the webhook, paste mode, and the eval script all call it.
 */
export async function reviewChange(
  input: ReviewInput,
  model: ReviewModel,
  limits: ReviewLimits,
  nonce: string = createNonce(),
): Promise<ReviewResult> {
  const files = parseUnifiedDiff(input.diff);
  const { reviewable, skipped } = splitReviewableFiles(files);

  if (reviewable.length === 0) {
    return {
      status: "completed",
      summary: nothingToReviewSummary(),
      findings: [],
      followUp: [],
      skippedFiles: skipped,
      usage: NO_USAGE,
      model: null,
    };
  }

  const diffChars = countDiffChars(reviewable);
  // Too much for one review: take the riskiest files that fit, and say which
  // were left out, rather than reviewing nothing.
  const { included, omitted } =
    diffChars > limits.maxDiffChars
      ? selectWithinBudget(reviewable, limits.maxDiffChars)
      : { included: reviewable, omitted: [] };
  if (included.length === 0) {
    return {
      ...tooLargeResult(
        `${diffChars} characters of changes, the limit is ${limits.maxDiffChars}`,
      ),
      skippedFiles: skipped,
    };
  }

  const prompt = buildPrompt(
    {
      renderedDiff: included.map(renderFileDiff).join("\n\n"),
      omittedPaths: omitted.map((file) => file.path),
      title: input.title,
      description: input.description,
      guidelines: input.guidelines,
      earlier: input.earlier,
      fileContexts: selectFileContexts(
        included,
        input.fileContents ?? [],
        limits.maxContextChars,
      ),
    },
    nonce,
  );

  const { output, usage } = await model.generate(prompt);

  // The trust boundary for model output. Whatever the client returned, it is
  // only used after it passes the schema.
  const parsed = reviewOutputSchema.safeParse(output);
  if (!parsed.success) {
    throw new ReviewError(
      "invalid_model_output",
      "The model returned output that does not match the review schema.",
    );
  }

  return {
    status: "completed",
    summary: withOmittedNote(parsed.data.summary, omitted),
    // Only the files the model saw can carry findings.
    findings: normalizeFindings(parsed.data.findings, included),
    followUp: normalizeFollowUp(parsed.data.followUp, input.earlier),
    skippedFiles: [
      ...skipped,
      ...omitted.map((file) => ({ path: file.path, reason: "over_budget" as const })),
    ],
    usage,
    model: model.name,
  };
}

// More than this and the note lists the first few and a count.
const OMITTED_LISTED = 8;

/**
 * Puts the files the first pass did not see at the top of the reviewer's
 * double-check list, so a partial review can never pass for a full one.
 */
export function withOmittedNote(summary: ReviewSummary, omitted: FileDiff[]): ReviewSummary {
  if (omitted.length === 0) {
    return summary;
  }
  const listed = omitted.slice(0, OMITTED_LISTED).map((file) => file.path);
  const more = omitted.length - listed.length;
  const files = more > 0 ? `${listed.join(", ")} and ${more} more` : listed.join(", ");
  const note = `This pull request was too large to review whole. These ${omitted.length} file${omitted.length === 1 ? " was" : "s were"} not reviewed automatically and need a person to read ${omitted.length === 1 ? "it" : "them"}: ${files}.`;
  return { ...summary, doubleCheck: [note, ...summary.doubleCheck] };
}
