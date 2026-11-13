import { z } from "zod";
import { reviewOutputSchema, type ReviewOutput } from "@/review/schema";
import savedResults from "./saved-results.json";

/**
 * Review results for the built-in examples, produced by a real run of the
 * engine (npm run examples:build) and committed. Showing these on the home
 * page makes the examples instant and free, and means the page still works
 * when the model API is slow or down.
 */

const savedResultSchema = reviewOutputSchema.extend({
  model: z.string().nullable(),
  generatedAt: z.string(),
});

export type SavedResult = ReviewOutput & { model: string | null; generatedAt: string };

export function getSavedResult(exampleId: string): SavedResult | null {
  const raw = (savedResults as Record<string, unknown>)[exampleId];
  const parsed = savedResultSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
