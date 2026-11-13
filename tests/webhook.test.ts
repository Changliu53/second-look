import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { classifyWebhook } from "@/github/webhook";

const SECRET = "test-webhook-secret";

function sign(body: string, secret: string = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function pullRequestBody(action: string, draft = false): string {
  return JSON.stringify({
    action,
    number: 7,
    pull_request: {
      title: "Add checkout",
      body: null,
      draft,
      user: { login: "sam" },
      head: { sha: "abc123" },
      base: { ref: "main" },
    },
    repository: { id: 1001, name: "shop", owner: { login: "acme" } },
    installation: { id: 42 },
  });
}

function classify(rawBody: string, signature: string | null, eventName = "pull_request") {
  return classifyWebhook({ rawBody, signature, eventName, secret: SECRET });
}

describe("classifyWebhook", () => {
  it("accepts a correctly signed pull_request event", async () => {
    const body = pullRequestBody("opened");
    const decision = await classify(body, sign(body));

    expect(decision.kind).toBe("review");
    if (decision.kind !== "review") return;
    expect(decision.event.pull_request.head.sha).toBe("abc123");
    expect(decision.event.installation.id).toBe(42);
  });

  it("rejects a request with no signature", async () => {
    const decision = await classify(pullRequestBody("opened"), null);
    expect(decision).toMatchObject({ kind: "rejected", httpStatus: 401 });
  });

  it("rejects a signature made with a different secret", async () => {
    const body = pullRequestBody("opened");
    const decision = await classify(body, sign(body, "attacker-guess"));
    expect(decision).toMatchObject({ kind: "rejected", httpStatus: 401 });
  });

  it("rejects a body that was changed after signing", async () => {
    const signed = pullRequestBody("opened");
    const tampered = signed.replace('"abc123"', '"evil99"');
    const decision = await classify(tampered, sign(signed));
    expect(decision).toMatchObject({ kind: "rejected", httpStatus: 401 });
  });

  it("checks the signature before looking at the event type", async () => {
    const decision = await classify("{}", "sha256=00", "ping");
    expect(decision.kind).toBe("rejected");
  });

  it.each(["opened", "synchronize", "reopened", "ready_for_review"])("reviews action %s", async (action) => {
    const body = pullRequestBody(action);
    expect((await classify(body, sign(body))).kind).toBe("review");
  });

  it("does not review a draft until it is marked ready", async () => {
    const draft = pullRequestBody("opened", true);
    const ready = pullRequestBody("ready_for_review", false);

    expect(await classify(draft, sign(draft))).toMatchObject({ kind: "ignored", reason: "draft pull request" });
    expect((await classify(ready, sign(ready))).kind).toBe("review");
  });

  it("reports a closed pull request so it can be hidden from the dashboard", async () => {
    const body = pullRequestBody("closed");
    const decision = await classify(body, sign(body));

    expect(decision.kind).toBe("closed");
    if (decision.kind !== "closed") return;
    expect(decision.event.number).toBe(7);
  });

  it.each(["edited", "labeled", "converted_to_draft"])("ignores action %s", async (action) => {
    const body = pullRequestBody(action);
    expect((await classify(body, sign(body))).kind).toBe("ignored");
  });

  it("ignores signed events of other types", async () => {
    const body = JSON.stringify({ zen: "Keep it simple." });
    expect((await classify(body, sign(body), "ping")).kind).toBe("ignored");
  });

  it("rejects a signed pull_request event with an unexpected shape", async () => {
    const body = JSON.stringify({ action: "opened", number: "seven" });
    const decision = await classify(body, sign(body));
    expect(decision).toMatchObject({ kind: "rejected", httpStatus: 400 });
  });
});
