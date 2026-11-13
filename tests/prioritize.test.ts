import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/review/diff";
import { filePriority, selectWithinBudget } from "@/review/prioritize";

describe("filePriority", () => {
  it("puts migrations and access checks above ordinary code, and tests and docs last", () => {
    const ordered = [
      "src/FieldOps.Api/Data/Migrations/20261120_RenameCustomerPhone.cs",
      "src/Tenancy/TenantContext.cs",
      "src/WorkOrders/WorkOrdersController.cs",
      "src/lib/format-date.ts",
      "tests/WorkOrdersControllerTests.cs",
      "README.md",
    ].map(filePriority);

    expect([...ordered].sort((a, b) => b - a)).toEqual(ordered);
    expect(new Set(ordered).size).toBe(ordered.length);
  });

  it("treats a test of a sensitive module as a test", () => {
    expect(filePriority("src/auth/session.test.ts")).toBeLessThan(filePriority("src/lib/format-date.ts"));
  });
});

function diffOf(files: Array<[string, number]>): string {
  return files
    .map(
      ([path, lines]) =>
        `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,0 +1,${lines} @@\n` +
        Array.from({ length: lines }, () => "+x".repeat(10)).join("\n") +
        "\n",
    )
    .join("");
}

describe("selectWithinBudget", () => {
  it("takes everything when it fits, in diff order", () => {
    const files = parseUnifiedDiff(diffOf([["b.ts", 2], ["a.sql", 2]]));
    const { included, omitted } = selectWithinBudget(files, 10_000);
    expect(included.map((f) => f.path)).toEqual(["b.ts", "a.sql"]);
    expect(omitted).toEqual([]);
  });

  it("skips a high-priority file that is too big and still takes smaller ones after it", () => {
    // Each line is 21 characters with its newline.
    const files = parseUnifiedDiff(diffOf([["src/util.ts", 2], ["db/migrations/1.sql", 50], ["docs/a.md", 2]]));
    const { included, omitted } = selectWithinBudget(files, 100);
    expect(included.map((f) => f.path)).toEqual(["src/util.ts", "docs/a.md"]);
    expect(omitted.map((f) => f.path)).toEqual(["db/migrations/1.sql"]);
  });

  it("returns diff order for the included files, not priority order", () => {
    const files = parseUnifiedDiff(diffOf([["docs/a.md", 1], ["src/auth/login.ts", 1], ["db/migrations/1.sql", 1]]));
    const { included } = selectWithinBudget(files, 10_000);
    expect(included.map((f) => f.path)).toEqual(["docs/a.md", "src/auth/login.ts", "db/migrations/1.sql"]);
  });
});
