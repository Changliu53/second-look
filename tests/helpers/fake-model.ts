import type { ReviewModel, TokenUsage } from "@/review/engine";
import type { BuiltPrompt } from "@/review/prompt";

/**
 * A ReviewModel that returns a fixed object and records the prompts it was
 * given. Tests use it to exercise the engine's own logic (filtering, limits,
 * validation, clean-up) without calling the API.
 */
export class FakeModel implements ReviewModel {
  readonly name = "fake-model";
  readonly prompts: BuiltPrompt[] = [];

  constructor(
    private readonly output: unknown,
    private readonly usage: TokenUsage = { inputTokens: 100, outputTokens: 20 },
  ) {}

  async generate(prompt: BuiltPrompt) {
    this.prompts.push(prompt);
    return { output: withFollowUp(this.output), usage: this.usage };
  }
}

/**
 * Most tests are not about follow-up, so an output written as
 * { summary, findings } gets the empty followUp list a real response has.
 * Outputs that already set followUp, or are not objects, pass through as is.
 */
function withFollowUp(output: unknown): unknown {
  if (typeof output !== "object" || output === null || "followUp" in output) {
    return output;
  }
  return { ...output, followUp: [] };
}

export const VALID_SUMMARY = {
  whatChanged: "Changes how the cart total is calculated.",
  riskLevel: "medium",
  doubleCheck: ["Add two items to a cart and check the total."],
};
