import type { Finding } from "@/db/schema";
import type { ReviewFinding } from "@/review/schema";

/**
 * The home page sandbox lets a visitor confirm, reject, and edit findings
 * without an account. Nothing is saved: the "database rows" below live in
 * React state. They use the same Finding shape as the real dashboard so the
 * same placement and publishing code runs in both places.
 */

export const SANDBOX_REVIEWER = "you";

export function toSandboxFindings(findings: ReviewFinding[]): Finding[] {
  return findings.map((finding, index) => ({
    id: index + 1,
    reviewId: 0,
    source: "ai",
    filePath: finding.file,
    startLine: finding.startLine,
    endLine: finding.endLine,
    severity: finding.severity,
    category: finding.category,
    explanation: finding.explanation,
    suggestedFix: finding.suggestedFix,
    confidence: finding.confidence,
    status: "pending",
    editedExplanation: null,
    editedSuggestedFix: null,
    rejectionReason: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: new Date(0),
  }));
}

/** What a visitor fills in to add a finding of their own. */
export type NewSandboxFinding = Pick<
  Finding,
  "filePath" | "startLine" | "endLine" | "severity" | "category" | "explanation" | "suggestedFix"
>;

export type SandboxAction =
  | { type: "add"; finding: NewSandboxFinding }
  | { type: "remove"; id: number }
  | { type: "confirm"; id: number }
  | { type: "reject"; id: number; reason: string | null }
  | { type: "edit"; id: number; explanation: string; suggestedFix: string | null }
  | { type: "undo"; id: number };

type PerFindingAction = Exclude<SandboxAction, { type: "add" } | { type: "remove" }>;

/** A finding the visitor wrote. Like in the dashboard, it starts confirmed. */
function humanFinding(input: NewSandboxFinding, id: number): Finding {
  return {
    ...input,
    id,
    reviewId: 0,
    source: "human",
    confidence: 1,
    status: "confirmed",
    editedExplanation: null,
    editedSuggestedFix: null,
    rejectionReason: null,
    decidedBy: SANDBOX_REVIEWER,
    decidedAt: null,
    createdAt: new Date(0),
  };
}

function applyTo(finding: Finding, action: PerFindingAction): Finding {
  switch (action.type) {
    case "confirm":
      return { ...finding, status: "confirmed", rejectionReason: null, decidedBy: SANDBOX_REVIEWER };
    case "reject":
      return { ...finding, status: "rejected", rejectionReason: action.reason, decidedBy: SANDBOX_REVIEWER };
    case "edit":
      // A finding the visitor wrote is rewritten in place.
      if (finding.source === "human") {
        return { ...finding, explanation: action.explanation, suggestedFix: action.suggestedFix };
      }
      // Same rule as the real dashboard: saving an edit confirms the finding.
      return {
        ...finding,
        status: "confirmed",
        rejectionReason: null,
        editedExplanation: action.explanation,
        editedSuggestedFix: action.suggestedFix,
        decidedBy: SANDBOX_REVIEWER,
      };
    case "undo":
      return { ...finding, status: "pending", rejectionReason: null, decidedBy: null };
  }
}

/** Reducer for the sandbox's findings. Returns a new array; never mutates. */
export function sandboxReducer(findings: Finding[], action: SandboxAction): Finding[] {
  if (action.type === "add") {
    const nextId = Math.max(0, ...findings.map((finding) => finding.id)) + 1;
    return [...findings, humanFinding(action.finding, nextId)];
  }
  if (action.type === "remove") {
    // Only findings the visitor added can be removed. AI findings are rejected.
    return findings.filter((finding) => finding.id !== action.id || finding.source !== "human");
  }
  return findings.map((finding) => (finding.id === action.id ? applyTo(finding, action) : finding));
}

export type StatusCounts = { pending: number; confirmed: number; rejected: number };

export function countByStatus(findings: Finding[]): StatusCounts {
  const counts: StatusCounts = { pending: 0, confirmed: 0, rejected: 0 };
  for (const finding of findings) {
    counts[finding.status] += 1;
  }
  return counts;
}
