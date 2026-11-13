import { describe, expect, it } from "vitest";
import { checkRunFor } from "@/github/check-run";

describe("checkRunFor", () => {
  it("is in progress while the AI review runs", () => {
    expect(checkRunFor({ kind: "reviewing" })).toMatchObject({ status: "in_progress" });
  });

  it("stays in progress after the AI finishes, until a human publishes", () => {
    const withFindings = checkRunFor({ kind: "awaiting_reviewer", findingCount: 3, tooLarge: false });
    const noFindings = checkRunFor({ kind: "awaiting_reviewer", findingCount: 0, tooLarge: false });

    expect(withFindings.status).toBe("in_progress");
    expect(withFindings.conclusion).toBeUndefined();
    expect(withFindings.summary).toContain("3 possible findings");
    // Even with zero findings the check must not pass on the AI's word alone.
    expect(noFindings.status).toBe("in_progress");
    expect(noFindings.conclusion).toBeUndefined();
  });

  it("requires action when any confirmed finding is critical", () => {
    const check = checkRunFor({ kind: "published", confirmedCount: 4, confirmedCriticalCount: 1 });

    expect(check).toMatchObject({ status: "completed", conclusion: "action_required" });
    expect(check.title).toBe("1 critical finding to fix");
  });

  it("says who is fixing it when the reviewer took the pull request over", () => {
    const check = checkRunFor({
      kind: "published", confirmedCount: 2, confirmedCriticalCount: 2, takenOverBy: "lee",
    });

    expect(check.conclusion).toBe("action_required");
    expect(check.summary).toContain("lee has taken this pull request over");
    expect(check.summary).toContain("The author does not need to do anything");
  });

  it("succeeds when confirmed findings are warnings and nits only", () => {
    const check = checkRunFor({ kind: "published", confirmedCount: 2, confirmedCriticalCount: 0 });
    expect(check).toMatchObject({ status: "completed", conclusion: "success" });
  });

  it("succeeds when the reviewer confirmed nothing", () => {
    const check = checkRunFor({ kind: "published", confirmedCount: 0, confirmedCriticalCount: 0 });
    expect(check.conclusion).toBe("success");
  });

  it("fails, and does not pass, when the review itself failed", () => {
    expect(checkRunFor({ kind: "failed" })).toMatchObject({ status: "completed", conclusion: "failure" });
  });

  it("closes the check of an outdated commit as neutral, neither pass nor fail", () => {
    expect(checkRunFor({ kind: "superseded" })).toMatchObject({ status: "completed", conclusion: "neutral" });
  });

  it("tells the reviewer when the pull request was too large", () => {
    const check = checkRunFor({ kind: "awaiting_reviewer", findingCount: 0, tooLarge: true });
    expect(check.summary).toContain("too large");
  });
});
