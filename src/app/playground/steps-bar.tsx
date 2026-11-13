import { Fragment } from "react";
import { ReasonTip } from "@/components/reason-tip";

/**
 * The playground follows a real review in order: the pull request arrives
 * and the first pass runs, the reviewer goes through the findings, publishes,
 * and then sees what the author received.
 */
export const PLAYGROUND_STEPS = ["arrives", "review", "publish", "author"] as const;
export type PlaygroundStep = (typeof PLAYGROUND_STEPS)[number];

const LABELS: Record<PlaygroundStep, string> = {
  arrives: "Pull request",
  review: "Review",
  publish: "Publish",
  author: "Result on GitHub",
};

export type StepStatus = {
  done: boolean;
  /** Why the step cannot be opened yet, or null when it can. */
  blocked: string | null;
};

function StepButton({
  number,
  label,
  current,
  done,
  disabled,
  onClick,
}: {
  number: number;
  label: string;
  current: boolean;
  done: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const circle = done
    ? "border-green-700 bg-green-700 text-white"
    : current
      ? "border-slate-900 bg-slate-900 text-white"
      : "border-slate-300 text-ink-soft";
  return (
    <button
      type="button"
      aria-current={current ? "step" : undefined}
      aria-label={`Step ${number}: ${label}`}
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
    >
      <span className={`grid size-5 shrink-0 place-items-center rounded-full border text-[0.6875rem] font-semibold ${circle}`}>
        {done ? "✓" : number}
      </span>
      {/* A phone has room for one label: the step you are on. */}
      <span className={current ? "font-semibold text-ink" : "hidden text-ink-soft sm:inline"}>{label}</span>
    </button>
  );
}

/**
 * Steps in order, not tabs: a step opens once the one before it is finished,
 * and the line between two steps turns green when the first is done. A step
 * that cannot be opened yet says why when hovered.
 */
export function StepsBar({
  current,
  status,
  onStep,
}: {
  current: PlaygroundStep;
  status: Record<PlaygroundStep, StepStatus>;
  onStep: (step: PlaygroundStep) => void;
}) {
  return (
    <nav aria-label="Steps of a review">
      <ol className="flex items-center gap-1">
        {PLAYGROUND_STEPS.map((step, index) => {
          const previous = PLAYGROUND_STEPS[index - 1];
          return (
            <Fragment key={step}>
              {previous && (
                <li
                  aria-hidden
                  className={`h-0.5 w-3 rounded-full transition-colors sm:w-5 ${status[previous].done ? "bg-green-700" : "bg-slate-300"}`}
                />
              )}
              <li>
                <ReasonTip reason={status[step].blocked} side="bottom">
                  <StepButton
                    number={index + 1}
                    label={LABELS[step]}
                    current={current === step}
                    done={status[step].done}
                    disabled={status[step].blocked !== null}
                    onClick={() => onStep(step)}
                  />
                </ReasonTip>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
