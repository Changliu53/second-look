import { describe, expect, it } from "vitest";
import { getSkipReason } from "@/review/filters";

describe("getSkipReason", () => {
  it.each([
    ["package-lock.json", "lockfile"],
    ["apps/web/pnpm-lock.yaml", "lockfile"],
    ["go.sum", "lockfile"],
    ["dist/index.js", "generated"],
    ["packages/ui/node_modules/x/index.js", "generated"],
    ["build/app.js", "generated"],
    ["public/app.min.js", "generated"],
    ["src/__snapshots__/a.test.ts.snap", "generated"],
    ["public/logo.PNG", "binary"],
    ["fonts/inter.woff2", "binary"],
  ])("skips %s as %s", (path, reason) => {
    expect(getSkipReason(path, false)).toBe(reason);
  });

  it.each([
    "src/index.ts",
    "package.json",
    "src/build/plan.ts",
    "docs/distribution.md",
    "src/lockfile.ts",
  ])("reviews %s", (path) => {
    expect(getSkipReason(path, false)).toBeNull();
  });

  it("skips a file the diff marks as binary even with a text extension", () => {
    expect(getSkipReason("data/blob.txt", true)).toBe("binary");
  });
});
