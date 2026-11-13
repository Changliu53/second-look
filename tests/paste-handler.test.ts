import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { countPasteReviewsSince } from "@/db/queries";
import { reviews } from "@/db/schema";
import { getLimits } from "@/lib/env";
import { handlePasteRequest, type PasteDeps } from "@/paste/handle-paste";
import { ReviewError, type ReviewModel } from "@/review/engine";
import { FakeModel, VALID_SUMMARY } from "./helpers/fake-model";
import { createTestDb } from "./helpers/test-db";

const NOW = new Date("2026-03-01T10:20:00Z");
const SECRET_CODE = "const password = 'hunter2-do-not-store';";

let db: Database;

function deps(overrides: Partial<PasteDeps> = {}): PasteDeps {
  return {
    db,
    model: new FakeModel({ summary: VALID_SUMMARY, findings: [] }),
    limits: { ...getLimits({}), pasteRequestsPerHour: 2, pasteDailyGlobalLimit: 3, pasteMaxChars: 200 },
    callerKey: "caller-a",
    now: NOW,
    ...overrides,
  };
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("handlePasteRequest", () => {
  it("refuses, and calls no model, once the monthly budget is used up", async () => {
    await db.insert(reviews).values({ source: "github", status: "completed", inputTokens: 5_000, outputTokens: 0, createdAt: NOW });
    const model = new FakeModel({ summary: VALID_SUMMARY, findings: [] });

    const response = await handlePasteRequest(
      { code: "let a = 1;" },
      deps({ model, limits: { ...deps().limits, monthlyTokenBudget: 1_000 } }),
    );

    expect(response.httpStatus).toBe(429);
    expect(model.prompts).toHaveLength(0);
  });

  it("reviews pasted code and reports line numbers of the pasted text", async () => {
    const model = new FakeModel({
      summary: VALID_SUMMARY,
      findings: [{
        file: "pasted-code", startLine: 2, endLine: 2, severity: "critical",
        category: "security", explanation: "Hardcoded password.", suggestedFix: null, confidence: 0.95,
      }],
    });

    const response = await handlePasteRequest({ code: `// config\n${SECRET_CODE}` }, deps({ model }));

    expect(response.httpStatus).toBe(200);
    if (response.httpStatus !== 200) return;
    expect(response.body.findings).toHaveLength(1);
    expect(model.prompts[0]?.user).toContain(`    2 + | ${SECRET_CODE}`);
  });

  it("rejects empty, oversized and malformed bodies without calling the model", async () => {
    const model = new FakeModel({ summary: VALID_SUMMARY, findings: [] });
    const bodies = [{ code: "   " }, { code: "x".repeat(201) }, { nope: true }, "text", null];

    for (const body of bodies) {
      const response = await handlePasteRequest(body, deps({ model }));
      expect(response.httpStatus).toBe(400);
    }
    expect(model.prompts).toHaveLength(0);
  });

  it("does not spend rate limit on invalid requests", async () => {
    await handlePasteRequest({ code: "" }, deps());
    await handlePasteRequest({ code: "" }, deps());
    await handlePasteRequest({ code: "" }, deps());

    const response = await handlePasteRequest({ code: "let a = 1;" }, deps());
    expect(response.httpStatus).toBe(200);
  });

  it("returns 429 with Retry-After once the caller's hourly limit is used", async () => {
    await handlePasteRequest({ code: "let a = 1;" }, deps());
    await handlePasteRequest({ code: "let a = 1;" }, deps());

    const blocked = await handlePasteRequest({ code: "let a = 1;" }, deps());

    expect(blocked.httpStatus).toBe(429);
    if (blocked.httpStatus !== 429) return;
    // 10:20 -> window ends 11:00
    expect(blocked.retryAfterSeconds).toBe(40 * 60);
  });

  it("enforces the daily cap across different callers", async () => {
    for (const caller of ["a", "b", "c"]) {
      const ok = await handlePasteRequest({ code: "let a = 1;" }, deps({ callerKey: caller }));
      expect(ok.httpStatus).toBe(200);
    }

    const model = new FakeModel({ summary: VALID_SUMMARY, findings: [] });
    const blocked = await handlePasteRequest({ code: "let a = 1;" }, deps({ callerKey: "d", model }));

    expect(blocked.httpStatus).toBe(429);
    expect(model.prompts).toHaveLength(0);
  });

  it("logs token usage but stores none of the pasted code", async () => {
    await handlePasteRequest({ code: SECRET_CODE, description: "my secret config" }, deps());

    const rows = await db.select().from(reviews);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "paste", inputTokens: 100, outputTokens: 20, pullRequestId: null });
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain("hunter2");
    expect(stored).not.toContain("my secret config");
  });

  it("returns 502 with a safe message when the model fails, and logs no review", async () => {
    const failing: ReviewModel = {
      name: "failing",
      generate: async () => {
        throw new ReviewError("model_request_failed", "The model request failed (status 529).");
      },
    };

    const response = await handlePasteRequest({ code: SECRET_CODE }, deps({ model: failing }));

    expect(response.httpStatus).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain("hunter2");
    expect(await countPasteReviewsSince(db, new Date(0))).toBe(0);
  });

  it("hides the message of unexpected errors", async () => {
    const crashing: ReviewModel = {
      name: "crashing",
      generate: async () => {
        throw new Error(`internal detail with ${SECRET_CODE}`);
      },
    };

    const response = await handlePasteRequest({ code: SECRET_CODE }, deps({ model: crashing }));

    expect(response).toEqual({ httpStatus: 502, body: { error: "The review could not be completed." } });
  });
});
