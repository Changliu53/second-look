import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ReviewError, type ReviewModel, type TokenUsage } from "./engine";
import type { BuiltPrompt } from "./prompt";
import { reviewOutputSchema } from "./schema";

// Enough for a long list of findings. If the model hits this, we fail the
// review instead of storing a cut-off list.
const MAX_OUTPUT_TOKENS = 16_000;

// The serverless function that runs a review is limited to 300 seconds on
// Vercel. Give up before that so we can record the failure ourselves.
const REQUEST_TIMEOUT_MS = 240_000;

/**
 * ReviewModel backed by the Anthropic Messages API.
 *
 * Uses structured outputs: the API constrains the response to the JSON schema
 * derived from our Zod schema, and the SDK validates it again on the way out.
 * We never read free text from the model.
 */
export class AnthropicReviewModel implements ReviewModel {
  private readonly client: Anthropic;

  constructor(
    readonly name: string,
    client?: Anthropic,
  ) {
    // The SDK reads ANTHROPIC_API_KEY from the environment by itself.
    this.client =
      client ?? new Anthropic({ timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
  }

  async generate(
    prompt: BuiltPrompt,
  ): Promise<{ output: unknown; usage: TokenUsage }> {
    const response = await this.requestReview(prompt);

    if (response.stop_reason === "refusal") {
      throw new ReviewError("model_refused", "The model declined this review.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new ReviewError(
        "model_output_truncated",
        "The model's answer was cut off before it finished.",
      );
    }
    if (response.parsed_output === null) {
      throw new ReviewError(
        "invalid_model_output",
        "The model returned output that could not be parsed.",
      );
    }

    return {
      output: response.parsed_output,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  private async requestReview(prompt: BuiltPrompt) {
    try {
      return await this.client.messages.parse({
        model: this.name,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
        output_config: { format: zodOutputFormat(reviewOutputSchema) },
      });
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        // Keep the status code only. The message can echo parts of the request.
        throw new ReviewError(
          "model_request_failed",
          `The model request failed (status ${error.status ?? "unknown"}).`,
        );
      }
      throw new ReviewError(
        "model_request_failed",
        "The model request failed before a response was received.",
      );
    }
  }
}
