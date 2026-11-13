"use client";

import { useEffect, useState } from "react";
import { REVIEW_STAGES, type ReviewStage } from "@/db/schema";
import { STAGE_LABELS } from "./stage-labels";

/**
 * Live view of a review that is still running: which step it is on and how
 * long it has taken. The page around it re-fetches every few seconds, so the
 * step advances and the findings appear without a manual reload.
 */

/**
 * Seconds since the review started, or null before the first tick. It starts
 * as null because the server and the browser read the clock at different
 * moments; rendering a number on both would make their HTML disagree.
 */
function useElapsedSeconds(startedAt: string): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (now === null) {
    return null;
  }
  return Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000));
}

type StepState = "done" | "current" | "todo";

function stepState(index: number, currentIndex: number): StepState {
  if (index < currentIndex) return "done";
  return index === currentIndex ? "current" : "todo";
}

function StepMark({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="grid size-5 place-items-center rounded-full bg-green-600 text-[0.625rem] font-bold text-white">
        ✓
      </span>
    );
  }
  if (state === "current") {
    return (
      <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900 motion-reduce:animate-none" />
    );
  }
  return <span className="size-5 rounded-full border-2 border-slate-200" />;
}

export function ReviewProgress({
  stage,
  startedAt,
}: {
  stage: ReviewStage | null;
  startedAt: string;
}) {
  const elapsed = useElapsedSeconds(startedAt);
  // Before the first stage is recorded, show the first step as in progress.
  const currentIndex = stage === null ? 0 : REVIEW_STAGES.indexOf(stage);

  return (
    <section role="status" className="mb-6 rounded-lg border border-blue-200 bg-accent-soft p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">AI first pass in progress</h2>
        <span className="font-mono text-sm text-ink-soft">
          {elapsed === null ? "" : `${elapsed}s`}
        </span>
      </div>
      <ol className="mt-4 space-y-3">
        {REVIEW_STAGES.map((name, index) => {
          const state = stepState(index, currentIndex);
          return (
            <li key={name} className="flex gap-3">
              <StepMark state={state} />
              <div className={state === "todo" ? "opacity-50" : ""}>
                <p className="text-sm font-medium">{STAGE_LABELS[name].title}</p>
                {state === "current" && (
                  <p className="text-xs text-ink-soft">{STAGE_LABELS[name].detail}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-xs text-ink-soft">
        Nothing has been posted to the pull request. Findings will appear here for you to confirm
        or reject, usually within 40 seconds.
      </p>
    </section>
  );
}
