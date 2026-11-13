import Link from "next/link";
import { SECTION_LABEL } from "@/components/ui";
import type { ReviewRound } from "@/db/queries";

function outcome(round: ReviewRound): { text: string; className: string } {
  if (round.confirmedCriticalCount > 0) {
    return {
      text: `${round.confirmedCriticalCount} critical to fix`,
      className: "text-red-700",
    };
  }
  return { text: "check passed", className: "text-green-700" };
}

function resolutionText(round: ReviewRound): string {
  if (round.confirmedCount === 0) {
    return "approved, no changes";
  }
  const sent = `${round.confirmedCount} sent`;
  if (round.resolution === "reviewer_takes_over") {
    return `${sent}, taken over by ${round.publishedBy ?? "the reviewer"}`;
  }
  return `${sent} back to the author`;
}

/**
 * The history of a pull request: one step per published review, in order.
 * Shown once a pull request has been through more than one round, so a
 * reviewer can see how it got here and open an earlier round.
 */
export function RoundsStrip({
  rounds,
  currentReviewId,
  hrefFor,
}: {
  rounds: ReviewRound[];
  currentReviewId: number;
  /** Where a round's link goes. Receives the round and its 1-based number. */
  hrefFor: (round: ReviewRound, number: number) => string;
}) {
  // The page may be showing a review that is not published yet. It is the
  // next round, so it gets a place at the end of the strip.
  const viewingUnpublished = !rounds.some((round) => round.reviewId === currentReviewId);
  const total = rounds.length + (viewingUnpublished ? 1 : 0);
  if (total < 2) {
    return null;
  }
  return (
    <nav aria-label="Review rounds" className="mt-4">
      <p className={SECTION_LABEL}>Review rounds</p>
      <ol className="mt-2 flex flex-wrap gap-2">
        {rounds.map((round, index) => {
          const current = round.reviewId === currentReviewId;
          const result = outcome(round);
          return (
            <li key={round.reviewId}>
              <Link
                href={hrefFor(round, index + 1)}
                aria-current={current ? "page" : undefined}
                className="block rounded-md border border-edge bg-surface-raised px-3 py-2 text-xs transition hover:border-accent aria-[current]:border-accent aria-[current]:bg-accent-soft"
              >
                <span className="block font-semibold">
                  Round {index + 1}
                  <span className="ml-2 font-mono font-normal text-ink-soft">
                    {round.headSha?.slice(0, 7)}
                  </span>
                </span>
                <span className="block text-ink-soft">{resolutionText(round)}</span>
                <span className={`block font-medium ${result.className}`}>{result.text}</span>
              </Link>
            </li>
          );
        })}
        {viewingUnpublished && (
          <li
            aria-current="page"
            className="rounded-md border border-accent bg-accent-soft px-3 py-2 text-xs"
          >
            <span className="block font-semibold">Round {total}</span>
            <span className="block text-ink-soft">this review</span>
            <span className="block font-medium text-ink-soft">not published yet</span>
          </li>
        )}
      </ol>
    </nav>
  );
}
