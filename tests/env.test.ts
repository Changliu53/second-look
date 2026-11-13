import { describe, expect, it } from "vitest";
import { getExamplePullRequests, getLimits, getModelName, requireEnv } from "@/lib/env";

describe("getExamplePullRequests", () => {
  it("parses one or several owner/repo#number entries", () => {
    expect(getExamplePullRequests({ DEMO_PULL_REQUEST: " acme/shop.web#12 " })).toEqual([
      { owner: "acme", name: "shop.web", number: 12 },
    ]);
    expect(getExamplePullRequests({ DEMO_PULL_REQUEST: "acme/api#1, acme/api#2" })).toEqual([
      { owner: "acme", name: "api", number: 1 },
      { owner: "acme", name: "api", number: 2 },
    ]);
  });

  it("ignores entries that are not owner/repo#number", () => {
    expect(getExamplePullRequests({ DEMO_PULL_REQUEST: "acme/shop, acme/api#3, https://github.com/a/b/pull/3" })).toEqual([
      { owner: "acme", name: "api", number: 3 },
    ]);
    expect(getExamplePullRequests({})).toEqual([]);
    expect(getExamplePullRequests({ DEMO_PULL_REQUEST: "" })).toEqual([]);
  });
});

describe("limits and model", () => {
  it("uses defaults when nothing is set and reads overrides as numbers", () => {
    expect(getLimits({}).maxDiffChars).toBe(120_000);
    expect(getLimits({ MAX_DIFF_CHARS: "500" }).maxDiffChars).toBe(500);
  });

  it("rejects a limit that is not a positive whole number", () => {
    expect(() => getLimits({ MAX_DIFF_CHARS: "-1" })).toThrow();
    expect(() => getLimits({ MAX_DIFF_CHARS: "lots" })).toThrow();
  });

  it("falls back to the default model for a blank value", () => {
    expect(getModelName({ ANTHROPIC_MODEL: "  " })).toBe("claude-opus-5-5");
    expect(getModelName({ ANTHROPIC_MODEL: "claude-haiku-5-5" })).toBe("claude-haiku-5-5");
  });

  it("names the missing variable without printing any value", () => {
    expect(() => requireEnv("DATABASE_URL", {})).toThrow("DATABASE_URL");
  });
});
