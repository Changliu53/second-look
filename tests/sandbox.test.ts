import { describe, expect, it } from "vitest";
import { EXAMPLES } from "@/examples/examples";
import { getSavedResult } from "@/examples/saved";
import { buildReviewView } from "@/dashboard/diff-view";
import { buildReviewPayload } from "@/github/publish";
import { parseUnifiedDiff } from "@/review/diff";
import { toReviewableDiff } from "@/review/paste";
import type { ReviewFinding } from "@/review/schema";
import { countByStatus, sandboxReducer, toSandboxFindings } from "@/sandbox/model";

const RAW: ReviewFinding[] = [
  { file: "pasted-code", startLine: 2, endLine: 2, severity: "critical", category: "bug", explanation: "AI_TEXT_ONE", suggestedFix: "AI_FIX", confidence: 0.9 },
  { file: "pasted-code", startLine: 3, endLine: 3, severity: "warning", category: "logic", explanation: "AI_TEXT_TWO", suggestedFix: null, confidence: 0.6 },
];

describe("sandbox findings", () => {
  it("start as pending with distinct ids", () => {
    const findings = toSandboxFindings(RAW);
    expect(findings.map((f) => [f.id, f.status])).toEqual([[1, "pending"], [2, "pending"]]);
  });

  it("confirm, reject with a reason, and undo change only the targeted finding", () => {
    let findings = toSandboxFindings(RAW);
    findings = sandboxReducer(findings, { type: "confirm", id: 1 });
    findings = sandboxReducer(findings, { type: "reject", id: 2, reason: "Intended" });

    expect(countByStatus(findings)).toEqual({ pending: 0, confirmed: 1, rejected: 1 });
    expect(findings[1]).toMatchObject({ status: "rejected", rejectionReason: "Intended" });

    findings = sandboxReducer(findings, { type: "undo", id: 2 });
    expect(findings[1]).toMatchObject({ status: "pending", rejectionReason: null, decidedBy: null });
    expect(findings[0]?.status).toBe("confirmed");
  });

  it("does not mutate the previous state", () => {
    const before = toSandboxFindings(RAW);
    const after = sandboxReducer(before, { type: "confirm", id: 1 });
    expect(before[0]?.status).toBe("pending");
    expect(after).not.toBe(before);
  });

  it("an edit confirms the finding and keeps the AI's original text", () => {
    const findings = sandboxReducer(toSandboxFindings(RAW), {
      type: "edit", id: 1, explanation: "HUMAN_TEXT", suggestedFix: null,
    });
    expect(findings[0]).toMatchObject({
      status: "confirmed", explanation: "AI_TEXT_ONE", editedExplanation: "HUMAN_TEXT", editedSuggestedFix: null,
    });
  });

  it("the author preview contains confirmed findings only, with the edited text", () => {
    const code = "a\nb\nc";
    const files = parseUnifiedDiff(toReviewableDiff(code));
    let findings = toSandboxFindings(RAW);
    findings = sandboxReducer(findings, { type: "edit", id: 1, explanation: "HUMAN_TEXT", suggestedFix: null });
    findings = sandboxReducer(findings, { type: "reject", id: 2, reason: null });

    const payload = buildReviewPayload({
      headSha: "", findings, files, reviewerLogin: "you", reviewerNote: null,
      summary: { whatChanged: "x", riskLevel: "high", doubleCheck: [] },
    });
    const everything = JSON.stringify(payload);

    expect(payload.comments.map((c) => c.line)).toEqual([2]);
    expect(everything).toContain("HUMAN_TEXT");
    expect(everything).not.toContain("AI_TEXT_ONE");
    expect(everything).not.toContain("AI_TEXT_TWO");
  });
});

describe("a finding the visitor adds", () => {
  const mine = {
    filePath: "pasted-code", startLine: 3, endLine: 3, severity: "critical" as const,
    category: "security" as const, explanation: "MY_OWN_FINDING", suggestedFix: null,
  };

  it("is added as confirmed, marked as written by a person, with a fresh id", () => {
    const findings = sandboxReducer(toSandboxFindings(RAW), { type: "add", finding: mine });

    expect(findings).toHaveLength(3);
    expect(findings[2]).toMatchObject({ id: 3, source: "human", status: "confirmed", confidence: 1 });
    expect(countByStatus(findings)).toEqual({ pending: 2, confirmed: 1, rejected: 0 });
  });

  it("is published with the AI findings the reviewer confirmed", () => {
    const files = parseUnifiedDiff(toReviewableDiff("a\nb\nc"));
    const findings = sandboxReducer(toSandboxFindings(RAW), { type: "add", finding: mine });

    const payload = buildReviewPayload({
      headSha: "", findings, files, reviewerLogin: "you", reviewerNote: null,
      summary: { whatChanged: "x", riskLevel: "high", doubleCheck: [] },
    });

    expect(JSON.stringify(payload)).toContain("MY_OWN_FINDING");
    expect(payload.comments.map((c) => c.line)).toEqual([3]);
  });

  it("can be removed, and an AI finding cannot", () => {
    const withMine = sandboxReducer(toSandboxFindings(RAW), { type: "add", finding: mine });

    expect(sandboxReducer(withMine, { type: "remove", id: 3 })).toHaveLength(2);
    expect(sandboxReducer(withMine, { type: "remove", id: 1 })).toHaveLength(3);
  });

  it("is rewritten in place when edited, with no separate original", () => {
    const withMine = sandboxReducer(toSandboxFindings(RAW), { type: "add", finding: mine });
    const edited = sandboxReducer(withMine, { type: "edit", id: 3, explanation: "CLEARER", suggestedFix: "Do X" });

    expect(edited[2]).toMatchObject({ explanation: "CLEARER", suggestedFix: "Do X", editedExplanation: null });
  });
});

describe("built-in examples", () => {
  it.each(EXAMPLES.map((e) => e.id))("%s has a saved result that matches the schema", (id) => {
    const saved = getSavedResult(id);
    expect(saved).not.toBeNull();
    expect(saved!.findings.length).toBeGreaterThan(0);
  });

  // A saved finding that points outside the example code would render nowhere.
  it.each(EXAMPLES.map((e) => e.id))("%s: every saved finding lands on a line of the example", (id) => {
    const example = EXAMPLES.find((e) => e.id === id)!;
    const saved = getSavedResult(id)!;
    const files = parseUnifiedDiff(toReviewableDiff(example.code));
    const view = buildReviewView(files, toSandboxFindings(saved.findings));

    expect(view.unplaced).toEqual([]);
  });

  it("returns null for an unknown example", () => {
    expect(getSavedResult("does-not-exist")).toBeNull();
  });

  it("the prompt-injection example was not talked into a low risk level", () => {
    expect(getSavedResult("prompt-injection")?.summary.riskLevel).not.toBe("low");
  });
});
