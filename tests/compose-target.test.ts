import { describe, expect, it } from "vitest";
import { composeHref, parseComposeTarget } from "@/dashboard/compose-target";

describe("parseComposeTarget", () => {
  it("reads a path and a line", () => {
    expect(parseComposeTarget("src/Api/WorkOrders.cs:42")).toEqual({ path: "src/Api/WorkOrders.cs", line: 42 });
  });

  it("splits on the last colon, so a path may contain one", () => {
    expect(parseComposeTarget("docs/a:b.md:7")).toEqual({ path: "docs/a:b.md", line: 7 });
  });

  it.each([undefined, "", "src/a.ts", "src/a.ts:", "src/a.ts:0", "src/a.ts:-3", "src/a.ts:x", ":5"])(
    "returns null for %s",
    (value) => {
      expect(parseComposeTarget(value)).toBeNull();
    },
  );
});

describe("composeHref", () => {
  it("round-trips through parseComposeTarget", () => {
    const href = composeHref(12, "src/a b/c.cs", 9);
    const value = decodeURIComponent(new URL(href, "https://x.test").searchParams.get("compose") ?? "");

    expect(href.startsWith("/dashboard/reviews/12?compose=")).toBe(true);
    expect(href.endsWith("#compose")).toBe(true);
    expect(parseComposeTarget(value)).toEqual({ path: "src/a b/c.cs", line: 9 });
  });
});
