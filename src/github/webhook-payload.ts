import { z } from "zod";

/** Only the fields of a pull_request webhook that this app reads. */
export const pullRequestEventSchema = z.object({
  action: z.string(),
  number: z.number().int(),
  pull_request: z.object({
    title: z.string(),
    body: z.string().nullable(),
    draft: z.boolean().optional(),
    user: z.object({ login: z.string() }),
    head: z.object({ sha: z.string() }),
    base: z.object({ ref: z.string(), sha: z.string().optional() }),
  }),
  repository: z.object({
    id: z.number().int(),
    name: z.string(),
    owner: z.object({ login: z.string() }),
  }),
  installation: z.object({ id: z.number().int() }),
});

export type PullRequestEvent = z.infer<typeof pullRequestEventSchema>;

/**
 * PR actions that mean "there is new code to review". A draft PR is skipped
 * until its author marks it ready, which arrives as "ready_for_review".
 */
const REVIEWABLE_ACTIONS = new Set([
  "opened",
  "synchronize",
  "reopened",
  "ready_for_review",
]);

export function isReviewableAction(action: string): boolean {
  return REVIEWABLE_ACTIONS.has(action);
}
