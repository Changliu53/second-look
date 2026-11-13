"use client";

import { useEffect, useState } from "react";
import { ReviewProgress } from "@/components/review/review-progress";
import { BUTTON, BUTTON_PRIMARY, SECTION_LABEL } from "@/components/ui";
import { REVIEW_STAGES, type ReviewStage } from "@/db/schema";
import { checkRunFor } from "@/github/check-run";
import { CheckStatus } from "./check-status";

// How long each stage is shown in the replay. A real first pass takes 20 to
// 40 seconds, nearly all of it in the last stage; nobody should wait that
// long for a saved result.
const REPLAY_MS: Record<ReviewStage, number> = {
  fetching_diff: 700,
  reading_files: 900,
  model_reviewing: 1600,
};

/**
 * Walks through the stages of a review on a timer and calls `onDone` after
 * the last one. Returns the stage to show.
 */
function useReplay(finished: boolean, onDone: () => void): ReviewStage {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (finished) {
      return;
    }
    const stage = REVIEW_STAGES[index];
    if (!stage) {
      onDone();
      return;
    }
    const timer = setTimeout(() => setIndex(index + 1), REPLAY_MS[stage]);
    return () => clearTimeout(timer);
  }, [finished, index, onDone]);
  return REVIEW_STAGES[Math.min(index, REVIEW_STAGES.length - 1)]!;
}

/**
 * Step one: a pull request has been opened and the first pass runs. It uses
 * the dashboard's own progress panel and the real check text. For a saved
 * example the stages are replayed on a timer, and the page says so.
 */
export function ArrivalStep({
  label,
  title,
  fileCount,
  lineCount,
  findingCount,
  finished,
  onFinished,
  onOpenReview,
}: {
  /** Where the change came from: an example, or the visitor's own code. */
  label: string;
  title: string;
  fileCount: number;
  lineCount: number;
  findingCount: number;
  /** True once the first pass is over (replayed, skipped, or really run). */
  finished: boolean;
  onFinished: () => void;
  onOpenReview: () => void;
}) {
  const stage = useReplay(finished, onFinished);
  // Only read inside an effect by the progress panel, so the server and the
  // browser may disagree about it without the HTML differing.
  const [startedAt] = useState(() => new Date().toISOString());
  const check = finished
    ? checkRunFor({ kind: "awaiting_reviewer", findingCount, tooLarge: false })
    : checkRunFor({ kind: "reviewing" });

  return (
    <div className="space-y-4">
      <header>
        <p className={SECTION_LABEL}>{label}</p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Opened by a teammate who is not an engineer, with code an AI tool wrote: {fileCount}{" "}
          file{fileCount === 1 ? "" : "s"}, {lineCount} lines. On a real repository a GitHub App
          receives the pull request and the first pass starts by itself. You open the dashboard
          and see this.
        </p>
      </header>

      <CheckStatus check={check} />

      {finished ? (
        <section className="rounded-lg border border-edge bg-surface-raised p-5">
          <h3 className="text-base font-semibold tracking-tight">First pass finished</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            {findingCount === 0
              ? "It found nothing worth your time."
              : `It found ${findingCount} possible problem${findingCount === 1 ? "" : "s"}.`}{" "}
            Nothing has been posted to the pull request, and the author has not heard anything.
            The check stays in progress until you publish, so the pull request cannot go green
            on the AI&apos;s word alone.
          </p>
          <button className={`${BUTTON_PRIMARY} mt-3`} onClick={onOpenReview}>
            Go through the findings
          </button>
        </section>
      ) : (
        <>
          <ReviewProgress stage={stage} startedAt={startedAt} />
          <div className="flex flex-wrap items-center gap-3">
            <button className={BUTTON} onClick={onFinished}>
              Skip the wait
            </button>
            <span className="text-xs text-ink-soft">
              This is a saved run, replayed in about three seconds. A real first pass takes 20 to
              40 seconds.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
