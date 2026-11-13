import { describe, expect, it } from "vitest";
import { ago } from "@/lib/time";

describe("ago", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const before = (ms: number) => new Date(now.getTime() - ms);

  it("rounds down to the unit a reader cares about", () => {
    expect(ago(before(20_000), now)).toBe("just now");
    expect(ago(before(59 * 60_000), now)).toBe("59 min ago");
    expect(ago(before(61 * 60_000), now)).toBe("1 h ago");
    expect(ago(before(25 * 3_600_000), now)).toBe("1 day ago");
    expect(ago(before(72 * 3_600_000), now)).toBe("3 days ago");
  });

  it("says just now for a time slightly in the future, from clock skew", () => {
    expect(ago(new Date(now.getTime() + 5_000), now)).toBe("just now");
  });
});
