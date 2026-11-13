import type { ReviewStage } from "@/db/schema";

/**
 * Text for each step of a running review. This file has no "use client" on
 * purpose: both server components (the dashboard list) and client components
 * (the live progress panel) use it, and a server component cannot call a
 * function that lives in a client file.
 */
export const STAGE_LABELS: Record<ReviewStage, { title: string; detail: string }> = {
  fetching_diff: {
    title: "Fetching the diff",
    detail: "Asking GitHub for the pull request's changes.",
  },
  reading_files: {
    title: "Reading the changed files and team rules",
    detail: "Full file contents for context, and .second-look.md from the base branch.",
  },
  model_reviewing: {
    title: "The model is reviewing",
    detail: "One call. The code is passed as data, and the answer must match the findings schema.",
  },
};

/** Short label for lists. */
export function stageLabel(stage: ReviewStage | null): string {
  return stage === null ? "Starting" : STAGE_LABELS[stage].title;
}
