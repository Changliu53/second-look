import { describe, expect, it } from "vitest";
import {
  formatNotice,
  notifyReviewReady,
  parseWebhookUrl,
  webhookNotifier,
  type ReviewReadyNotice,
} from "@/notify/review-ready";

const NOTICE: ReviewReadyNotice = {
  repository: "acme/shop",
  pullNumber: 7,
  title: "Add checkout",
  author: "sam",
  critical: 1,
  warning: 2,
  nit: 0,
  reviewUrl: "https://sl.test/dashboard/reviews/12",
};

describe("formatNotice", () => {
  it("says which pull request is waiting and how many findings, with a link", () => {
    const text = formatNotice(NOTICE);
    expect(text).toContain("*Add checkout* (acme/shop#7, by sam)");
    expect(text).toContain("1 critical, 2 warnings.");
    expect(text).toContain("<https://sl.test/dashboard/reviews/12|Open the review>");
  });

  it("escapes a title so it cannot add links or mentions, and cuts a long one", () => {
    const text = formatNotice({ ...NOTICE, title: "<!channel> <https://evil.test|click> & " + "x".repeat(500) });
    expect(text).toContain("&lt;!channel&gt; &lt;https://evil.test|click&gt; &amp;");
    expect(text).not.toContain("<!channel>");
    expect(text.split("\n")[0]!.length).toBeLessThan(300);
  });

  it("says so when there are no findings", () => {
    expect(formatNotice({ ...NOTICE, critical: 0, warning: 0 })).toContain("First pass: no findings.");
  });
});

describe("parseWebhookUrl", () => {
  it("accepts https only", () => {
    expect(parseWebhookUrl("https://hooks.slack.test/abc")?.host).toBe("hooks.slack.test");
    expect(parseWebhookUrl("http://hooks.slack.test/abc")).toBeNull();
    expect(parseWebhookUrl("not a url")).toBeNull();
    expect(parseWebhookUrl("")).toBeNull();
    expect(parseWebhookUrl(undefined)).toBeNull();
  });
});

describe("webhookNotifier", () => {
  it("is null when nothing usable is configured", () => {
    expect(webhookNotifier(undefined)).toBeNull();
    expect(webhookNotifier("http://insecure.test")).toBeNull();
  });

  it("posts the text as JSON and throws when the receiver refuses", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    let status = 200;
    const send = (async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response(null, { status });
    }) as typeof fetch;
    const notify = webhookNotifier("https://hooks.slack.test/abc", send)!;

    await notify(NOTICE);
    expect(calls[0]?.url).toBe("https://hooks.slack.test/abc");
    expect(JSON.parse(calls[0]!.body)).toEqual({ text: formatNotice(NOTICE) });

    status = 500;
    await expect(notify(NOTICE)).rejects.toThrow();
  });
});

describe("notifyReviewReady", () => {
  it("does nothing without a notifier and swallows a notifier's failure", async () => {
    await expect(notifyReviewReady(null, NOTICE, 1)).resolves.toBeUndefined();
    await expect(
      notifyReviewReady(async () => {
        throw new Error("chat is down");
      }, NOTICE, 1),
    ).resolves.toBeUndefined();
  });
});
