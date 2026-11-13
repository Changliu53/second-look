import type { CheckRunUpdate } from "./client";

/**
 * Maps the state of a review to what the GitHub check run should show.
 *
 * The check stays "in progress" until a human publishes the review. If it
 * turned green as soon as the AI finished, a pull request could be merged
 * before any engineer looked at the findings, which defeats the point.
 */

export type CheckState =
  | { kind: "reviewing" }
  | { kind: "awaiting_reviewer"; findingCount: number; tooLarge: boolean }
  | { kind: "published"; confirmedCount: number; confirmedCriticalCount: number }
  | { kind: "superseded" }
  | { kind: "failed" };

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function checkRunFor(state: CheckState): CheckRunUpdate {
  switch (state.kind) {
    case "reviewing":
      return {
        status: "in_progress",
        title: "Reviewing",
        summary: "The automatic first-pass review is running.",
      };

    case "awaiting_reviewer":
      return {
        status: "in_progress",
        title: "Waiting for a reviewer",
        summary: state.tooLarge
          ? "This pull request is too large for an automatic review. A reviewer needs to look at it in the Second Look dashboard."
          : `The first pass produced ${plural(state.findingCount, "possible finding")}. A reviewer needs to confirm or reject them in the Second Look dashboard before this check completes.`,
      };

    case "published":
      if (state.confirmedCriticalCount > 0) {
        return {
          status: "completed",
          conclusion: "action_required",
          title: `${plural(state.confirmedCriticalCount, "critical finding")} to fix`,
          summary: `A reviewer confirmed ${plural(state.confirmedCriticalCount, "critical finding")}. Push a fix to start a new review.`,
        };
      }
      return {
        status: "completed",
        conclusion: "success",
        title: "No critical findings",
        summary: `A reviewer published the review with ${plural(state.confirmedCount, "confirmed finding")}, none of them critical.`,
      };

    case "superseded":
      // This check belongs to an old commit. Branch protection looks at the
      // newest commit, which has its own check, so "neutral" blocks nothing.
      return {
        status: "completed",
        conclusion: "neutral",
        title: "Superseded by a newer commit",
        summary: "A newer commit was pushed while this review was running. See the check on the latest commit.",
      };

    case "failed":
      return {
        status: "completed",
        conclusion: "failure",
        title: "Review failed",
        summary:
          "The automatic review could not be completed. Close and reopen the pull request to try again.",
      };
  }
}
