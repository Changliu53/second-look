import { describe, expect, it } from "vitest";
import { canReviewRepository, PermissionCache } from "@/github/access";
import { FakeGitHub } from "./helpers/fake-github";

const REPO = { owner: "acme", name: "shop" };

describe("canReviewRepository", () => {
  it("allows write and admin, and nothing less", async () => {
    const github = new FakeGitHub();
    github.permissions.set("writer", "write");
    github.permissions.set("owner", "admin");
    github.permissions.set("reader", "read");

    expect(await canReviewRepository(github, REPO, "writer")).toBe(true);
    expect(await canReviewRepository(github, REPO, "owner")).toBe(true);
    expect(await canReviewRepository(github, REPO, "reader")).toBe(false);
    expect(await canReviewRepository(github, REPO, "stranger")).toBe(false);
  });
});

describe("PermissionCache", () => {
  function setup() {
    let now = 1_000_000;
    const github = new FakeGitHub();
    github.permissions.set("lee", "write");
    const cache = new PermissionCache(60_000, () => now);
    return { github, cache, advance: (ms: number) => (now += ms) };
  }

  it("asks GitHub once for repeated checks within the time limit", async () => {
    const { github, cache, advance } = setup();

    await cache.canReview(github, REPO, "lee");
    advance(59_000);
    await cache.canReview(github, REPO, "LEE");

    expect(github.permissionRequests).toBe(1);
  });

  it("asks again once the answer is older than the time limit, and sees a removal", async () => {
    const { github, cache, advance } = setup();

    expect(await cache.canReview(github, REPO, "lee")).toBe(true);
    github.permissions.set("lee", "read");
    advance(60_001);

    expect(await cache.canReview(github, REPO, "lee")).toBe(false);
    expect(github.permissionRequests).toBe(2);
  });

  it("keeps answers apart per repository and per user", async () => {
    const { github, cache } = setup();
    github.permissions.set("kim", "read");

    expect(await cache.canReview(github, REPO, "lee")).toBe(true);
    expect(await cache.canReview(github, REPO, "kim")).toBe(false);
    expect(await cache.canReview(github, { owner: "acme", name: "other" }, "lee")).toBe(true);
    expect(github.permissionRequests).toBe(3);
  });
});
