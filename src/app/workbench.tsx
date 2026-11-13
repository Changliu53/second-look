"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AddOnLine, DiffFile } from "@/components/review/diff-file";
import { FindingFields } from "@/components/review/finding-fields";
import { FindingOutline } from "@/components/review/finding-outline";
import { FindingKeys } from "@/components/review/finding-keys";
import { ReasonTip } from "@/components/reason-tip";
import { SiteHeader } from "@/components/site-header";
import { SummaryCard } from "@/components/summary-card";
import { ALL_DECIDED_MESSAGE, Toast } from "@/components/toast";
import { BUTTON, BUTTON_PRIMARY, INPUT, KBD, SECTION_LABEL } from "@/components/ui";
import { buildReviewView } from "@/dashboard/diff-view";
import type { Finding } from "@/db/schema";
import type { Example } from "@/examples/examples";
import type { SavedResult } from "@/examples/saved";
import type { Resolution } from "@/github/publish";
import type { PasteSuccess } from "@/paste/handle-paste";
import { parseUnifiedDiff } from "@/review/diff";
import { PASTED_FILE_NAME, toReviewableDiff } from "@/review/paste";
import { CATEGORIES, SEVERITIES, type ReviewSummary } from "@/review/schema";
import {
  countByStatus,
  publishBlockedReason,
  sandboxReducer,
  toSandboxFindings,
  type SandboxAction,
} from "@/sandbox/model";
import { ArrivalStep } from "./playground/arrival-step";
import { AuthorStep } from "./playground/author-step";
import { PublishStep } from "./playground/publish-step";
import { StepsBar, type PlaygroundStep, type StepStatus } from "./playground/steps-bar";
import { SandboxFindingCard } from "./sandbox-finding-card";

/**
 * The home page: the whole product loop in one screen, with no login.
 * Left: pick an example or paste code. Right: the same steps as a real
 * review, in order. The pull request arrives and the first pass runs, the
 * visitor confirms or rejects the findings, publishes, and sees what the
 * author would receive. Nothing is stored or posted.
 */

type Review = {
  /** The exact code that was reviewed, so the diff matches the findings. */
  code: string;
  /** Stands in for the pull request title in the fix prompt. */
  title: string;
  summary: ReviewSummary;
  /** Shown above the result: where it came from. */
  origin: string;
  /** Heading of the first step: an example, or the visitor's own code. */
  label: string;
};

type Request =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string };

export type WorkbenchProps = {
  examples: Example[];
  selected: Example | null;
  saved: SavedResult | null;
};

function savedOrigin(saved: SavedResult): string {
  return `Saved result of a real run (${saved.model ?? "model"}, ${saved.generatedAt}). Loading it calls no API.`;
}

async function requestReview(
  code: string,
  description: string,
): Promise<{ ok: true; result: PasteSuccess } | { ok: false; message: string }> {
  try {
    const response = await fetch("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, description: description || undefined }),
    });
    const body = await response.json();
    if (!response.ok) {
      return { ok: false, message: body.error ?? "The request failed." };
    }
    return { ok: true, result: body as PasteSuccess };
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}

export function Workbench({ examples, selected, saved }: WorkbenchProps) {
  const [code, setCode] = useState(selected?.code ?? "");
  const [description, setDescription] = useState(selected?.description ?? "");
  const [request, setRequest] = useState<Request>({ phase: "idle" });
  const [published, setPublished] = useState<Resolution | null>(null);
  const [toast, setToast] = useState<{ message: string; toPublish?: boolean } | null>(null);
  // A saved example starts at the first step, with its first pass replayed.
  const [step, setStep] = useState<PlaygroundStep>(selected && saved ? "arrives" : "review");
  const [firstPassDone, setFirstPassDone] = useState(false);
  const [note, setNote] = useState("");
  const [review, setReview] = useState<Review | null>(
    selected && saved
      ? {
          code: selected.code,
          title: selected.description,
          summary: saved.summary,
          origin: savedOrigin(saved),
          label: "Example pull request",
        }
      : null,
  );
  const [findings, setFindings] = useState<Finding[]>(
    saved ? toSandboxFindings(saved.findings) : [],
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setRequest({ phase: "loading" });
    const outcome = await requestReview(code, description);
    if (!outcome.ok) {
      setRequest({ phase: "error", message: outcome.message });
      return;
    }
    setReview({
      code,
      title: description.trim() || "this change",
      summary: outcome.result.summary,
      origin: "Reviewed just now. Your code was sent to the model and was not stored.",
      label: "Your code, as a pull request",
    });
    setFindings(toSandboxFindings(outcome.result.findings));
    setPublished(null);
    setNote("");
    // The first pass has really just run, so there is nothing to replay.
    setFirstPassDone(true);
    setStep("review");
    setRequest({ phase: "idle" });
  }

  function scrollResultToTop() {
    document.getElementById("result")?.scrollTo({ top: 0 });
  }

  // Stable, so the toast's timer is not restarted by every render.
  const dismissToast = useCallback(() => setToast(null), []);

  /** The first pass is over: replayed to the end, or skipped. */
  const finishFirstPass = useCallback(() => {
    setFirstPassDone(true);
    // Move on by itself, as the dashboard does when a review finishes, unless
    // the visitor has already gone somewhere else.
    setStep((current) => (current === "arrives" ? "review" : current));
  }, []);

  /** The simulated publish: nothing leaves the browser. */
  function publish(resolution: Resolution) {
    setPublished(resolution);
    setToast({
      message:
        resolution === "reviewer_takes_over"
          ? "Published (simulated). The author is told you are taking this over."
          : "Published (simulated). The author gets your comments and the fix prompt.",
    });
    // On to what was posted, as a reviewer would go and look at the pull request.
    setStep("author");
    scrollResultToTop();
  }

  /** Back to the review as the AI returned it, to try a different path. */
  function startOver() {
    // Drop findings the visitor added and undo every decision.
    setFindings((current) => current.filter((f) => f.source === "ai").map(resetDecision));
    setPublished(null);
    setNote("");
    setStep("review");
    scrollResultToTop();
  }

  /** Switches step and returns to the top, since the steps differ in length. */
  function showStep(next: PlaygroundStep) {
    // Leaving the first step while the replay runs is the same as skipping it.
    if (next !== "arrives") {
      setFirstPassDone(true);
    }
    setStep(next);
    scrollResultToTop();
  }

  function act(action: SandboxAction) {
    setFindings((current) => sandboxReducer(current, action));
  }

  // The decision that leaves nothing pending is worth announcing: the review
  // is done and the next thing to do is publish. Watched as a change in the
  // count, so it holds however the last decision was made (button or key).
  const pendingCount = countByStatus(findings).pending;
  const previousPending = useRef(pendingCount);
  useEffect(() => {
    if (previousPending.current > 0 && pendingCount === 0 && findings.length > 0) {
      setToast({ message: ALL_DECIDED_MESSAGE, toPublish: true });
    }
    previousPending.current = pendingCount;
  }, [pendingCount, findings.length]);

  return (
    // The page is a column: top bar, a one-line introduction, then the two
    // panes, which take the rest of the window and scroll on their own.
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <SiteHeader current="/" wide />
      <div className="shrink-0 border-b border-edge bg-surface px-5 py-2.5">
        <p className="text-sm">
          <span className="font-semibold">
            AI writes the code faster than you can read it. This reads it first, and you still
            decide.
          </span>{" "}
          <span className="text-ink-soft">
            The AI does the first pass on a pull request, you confirm or reject each finding, and
            the author gets one review with only what you confirmed.
          </span>
        </p>
      </div>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Left pane: what to review. Everything in it changes the right pane
          and nothing in it leaves the page. */}
      <aside className="flex w-full shrink-0 flex-col gap-6 border-b border-edge bg-surface-raised p-5 lg:h-full lg:w-[25rem] lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <header>
          <h1 className="text-base font-semibold tracking-tight">Playground</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Go through a review the way a reviewer does. Pick a change below or paste your own.
            Nothing here is saved or posted anywhere.
          </p>
        </header>

        <section>
          <h2 className={SECTION_LABEL}>Example changes</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {examples.map((example) => (
              <li key={example.id}>
                <Link
                  href={`/?example=${example.id}#result`}
                  aria-current={selected?.id === example.id ? "true" : undefined}
                  className="group flex items-start gap-2.5 rounded-md border border-edge px-3 py-2 text-left transition hover:border-accent hover:bg-accent-soft aria-[current]:border-accent aria-[current]:bg-accent-soft"
                >
                  {/* A radio dot: one of these is shown on the right at a time. */}
                  <span
                    aria-hidden
                    className="mt-1 grid size-3.5 shrink-0 place-items-center rounded-full border border-slate-400 group-aria-[current]:border-accent"
                  >
                    <span className="size-1.5 rounded-full bg-accent opacity-0 group-aria-[current]:opacity-100" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{example.label}</span>
                    <span className="block text-xs leading-snug text-ink-soft">{example.teaser}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {/* On a phone the review is below this whole panel. */}
          <a href="#result" className="mt-2 inline-block text-sm text-accent underline-offset-2 hover:underline lg:hidden">
            Jump down to the review
          </a>
        </section>

        <section>
          <h2 className={SECTION_LABEL}>Your own code or diff</h2>
          <p className="mt-1 text-xs text-ink-soft">
            The examples are saved results and open instantly. This one calls the model, which
            takes about 30 seconds.
          </p>
          <form onSubmit={onSubmit} className="mt-2 space-y-2">
            <input
              className={INPUT}
              value={description}
              maxLength={500}
              placeholder="What is the change supposed to do? (optional)"
              aria-label="What the change is supposed to do"
              onChange={(e) => setDescription(e.target.value)}
            />
            <textarea
              className={`${INPUT} h-44 font-mono text-xs leading-relaxed`}
              value={code}
              required
              spellCheck={false}
              placeholder="Paste a function, a file, or a git diff"
              aria-label="Code or diff"
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                // Cmd+Enter (Ctrl+Enter on Windows and Linux) submits, as in most editors.
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button type="submit" disabled={request.phase === "loading"} className={`${BUTTON_PRIMARY} w-full`}>
              {request.phase === "loading" ? (
                <>
                  <span aria-hidden className="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent motion-reduce:animate-none" />
                  Reviewing, about 30 seconds
                </>
              ) : (
                "Review with the model"
              )}
            </button>
            <p className="text-xs text-ink-soft">
              <kbd className={KBD}>⌘</kbd> <kbd className={KBD}>Enter</kbd> also submits.
            </p>
            {request.phase === "error" && (
              <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
                {request.message}
              </p>
            )}
          </form>
        </section>

        <footer className="mt-auto pt-2 text-xs leading-relaxed text-ink-soft">
          Pasted code is sent to the model for one review and is not stored. Live reviews are rate
          limited. Nothing you confirm or reject here is saved or posted anywhere.
        </footer>
      </aside>

      <div id="result" className="min-w-0 flex-1 lg:h-full lg:overflow-y-auto">
        {request.phase === "loading" ? (
          <Reviewing />
        ) : review ? (
          <ResultPane
            review={review}
            findings={findings}
            step={step}
            onStep={showStep}
            firstPassDone={firstPassDone}
            onFirstPassDone={finishFirstPass}
            published={published}
            onPublish={publish}
            note={note}
            onNote={setNote}
            onStartOver={startOver}
            onAction={act}
          />
        ) : (
          <EmptyState />
        )}
      </div>
      </main>
      {toast && (
        <Toast
          message={toast.message}
          onDone={dismissToast}
          action={
            toast.toPublish ? (
              <button
                className="font-medium underline underline-offset-2"
                onClick={() => {
                  setToast(null);
                  showStep("publish");
                }}
              >
                Continue to publish
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}

/** A finding as the AI returned it, with any decision removed. */
function resetDecision(finding: Finding): Finding {
  return {
    ...finding,
    status: "pending",
    editedExplanation: null,
    editedSuggestedFix: null,
    rejectionReason: null,
    decidedBy: null,
  };
}

const STEPS = [
  {
    title: "A pull request arrives",
    body: "A GitHub App receives it and the AI reviews the diff against your team's rules. Nothing is posted yet.",
  },
  {
    title: "You go through the findings",
    body: "Each one sits under the line it is about. Confirm it, reject it with a reason, or rewrite it in your own words.",
  },
  {
    title: "The author hears from you once",
    body: "One GitHub review with only what you confirmed, a plain-English summary, and a check that blocks the merge while a critical finding stands.",
  },
];

/** Shown in the result pane while a live review is running. */
function Reviewing() {
  const steps = [
    "Wrapping your code in a section the model treats as data, not instructions",
    "Checking it against the review rules",
    "Validating the answer against the findings schema",
  ];
  return (
    <div role="status" className="mx-auto flex h-full max-w-xl flex-col justify-center gap-5 p-8">
      <h2 className="flex items-center gap-3 text-xl font-semibold tracking-tight">
        <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900 motion-reduce:animate-none" />
        Reading your code
      </h2>
      <p className="text-sm leading-relaxed text-slate-600">
        This is one model call and usually takes 20 to 40 seconds. The built-in examples are
        instant because their results were saved from an earlier real run.
      </p>
      <ul className="space-y-2 text-sm text-ink-soft">
        {steps.map((step) => (
          <li key={step} className="flex gap-2">
            <span aria-hidden>·</span>
            {step}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-8 p-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">How a review goes</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Pick an example on the left to go through one yourself. The examples are real output
          from the model, saved so they open instantly.
        </p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="rounded-lg border border-edge bg-surface-raised p-4">
            <span className="grid size-6 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">
              {index + 1}
            </span>
            <h3 className="mt-3 text-sm font-semibold">{step.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">{step.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ResultPane({
  review,
  findings,
  step,
  onStep,
  firstPassDone,
  onFirstPassDone,
  onAction,
  published,
  onPublish,
  note,
  onNote,
  onStartOver,
}: {
  review: Review;
  findings: Finding[];
  step: PlaygroundStep;
  onStep: (step: PlaygroundStep) => void;
  firstPassDone: boolean;
  onFirstPassDone: () => void;
  onAction: (action: SandboxAction) => void;
  /** Set once the visitor has pressed Publish. Decisions are then fixed. */
  published: Resolution | null;
  onPublish: (resolution: Resolution) => void;
  note: string;
  onNote: (note: string) => void;
  onStartOver: () => void;
}) {
  const files = useMemo(() => parseUnifiedDiff(toReviewableDiff(review.code)), [review.code]);
  const view = useMemo(() => buildReviewView(files, findings), [files, findings]);
  const counts = countByStatus(findings);
  // Publishing waits for every finding to have a decision, as it does in the
  // dashboard, and each publish control says so when hovered.
  const blocked = published ? null : publishBlockedReason(counts.pending);
  // Plain pasted code becomes a one-file "diff"; show it as code, not a diff.
  const isSnippet = files.length === 1 && files[0]?.path === PASTED_FILE_NAME;
  // The line a visitor clicked to write a finding of their own.
  const [composing, setComposing] = useState<{ path: string; line: number } | null>(null);

  function addFinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!composing) {
      return;
    }
    const form = new FormData(event.currentTarget);
    const explanation = String(form.get("explanation") ?? "").trim();
    const severity = SEVERITIES.find((value) => value === form.get("severity"));
    const category = CATEGORIES.find((value) => value === form.get("category"));
    if (explanation === "" || !severity || !category) {
      return;
    }
    const through = Number(form.get("endLine"));
    const suggestedFix = String(form.get("suggestedFix") ?? "").trim();
    onAction({
      type: "add",
      finding: {
        filePath: composing.path,
        startLine: composing.line,
        endLine: Number.isInteger(through) && through >= composing.line ? through : composing.line,
        severity,
        category,
        explanation,
        suggestedFix: suggestedFix === "" ? null : suggestedFix,
      },
    });
    setComposing(null);
  }

  const status: Record<PlaygroundStep, StepStatus> = {
    arrives: { done: firstPassDone, blocked: null },
    review: { done: firstPassDone && (counts.pending === 0 || published !== null), blocked: null },
    publish: { done: published !== null, blocked },
    author: {
      done: false,
      blocked: published ? null : "Publish the review first. This step shows what the author gets.",
    },
  };

  return (
    <div className="animate-rise-in">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge bg-surface-raised/95 px-5 py-2.5 backdrop-blur">
        <StepsBar current={step} status={status} onStep={onStep} />
        <p className="text-xs text-ink-soft">
          <span className="font-semibold text-ink">{counts.pending}</span> pending
          <span className="mx-1.5">·</span>
          <span className="font-semibold text-green-700">{counts.confirmed}</span> confirmed
          <span className="mx-1.5">·</span>
          <span className="font-semibold text-ink">{counts.rejected}</span> rejected
        </p>
        <div className="ml-auto">{step === "review" && !published && <FindingKeys pending={counts.pending} hints={false} />}</div>
      </div>

      <div className="mx-auto max-w-4xl p-5">
        {step === "arrives" && (
          <ArrivalStep
            label={review.label}
            title={review.title}
            fileCount={files.length}
            lineCount={review.code.split("\n").length}
            findingCount={findings.filter((finding) => finding.source === "ai").length}
            finished={firstPassDone}
            onFinished={onFirstPassDone}
            onOpenReview={() => onStep("review")}
          />
        )}
        {step === "publish" && (
          <PublishStep
            title={review.title}
            findings={findings}
            blocked={blocked}
            published={published}
            note={note}
            onNote={onNote}
            onPublish={onPublish}
            onSeeAuthor={() => onStep("author")}
          />
        )}
        {step === "author" && published && (
          <AuthorStep
            title={review.title}
            summary={review.summary}
            findings={findings}
            files={files}
            resolution={published}
            note={note}
            onStartOver={onStartOver}
          />
        )}
        {step === "review" && (
          <>
            <h2 className="text-lg font-semibold tracking-tight">
              {findings.length === 0
                ? "No findings"
                : `${findings.length} finding${findings.length === 1 ? "" : "s"} to go through`}
            </h2>
            <p className="mt-1 text-xs text-ink-soft">{review.origin}</p>
            {/* As on the dashboard: what the first pass wrote for the author. */}
            <div className="mt-4">
              <SummaryCard summary={review.summary} />
            </div>
            {findings.length === 0 ? (
              <p className="mt-4 rounded-lg border border-edge bg-surface-raised p-4 text-sm">
                The first pass saw nothing worth your time in this change.
              </p>
            ) : (
              <div className="mt-4">
                <FindingOutline findings={findings} />
              </div>
            )}
            {!published && (
              <p className="mt-3 text-xs leading-relaxed text-ink-soft">
                <span className="font-medium text-ink">Confirm</span> sends a finding to the author.{" "}
          <span className="font-medium text-ink">Reject</span> keeps it here and the author never
          sees it. <span className="font-medium text-ink">Edit</span> rewrites it in your words.
          Missed something? Hover a line and click{" "}
          <span className="rounded bg-accent px-1 font-bold text-white">+</span> to add your own.
                <span className="hidden lg:inline">
                  {" "}
                  Keys: <kbd className={KBD}>j</kbd> <kbd className={KBD}>k</kbd> move,{" "}
                  <kbd className={KBD}>c</kbd> confirm, <kbd className={KBD}>r</kbd> reject,{" "}
                  <kbd className={KBD}>e</kbd> edit, <kbd className={KBD}>n</kbd> next pending.
                </span>
              </p>
            )}
            {view.files.map((file) => (
              <DiffFile
                key={file.path}
                file={file}
                plain={isSnippet}
                title={isSnippet ? "The code under review" : undefined}
                renderFinding={(finding) => (
                  <SandboxFindingCard finding={finding} onAction={onAction} locked={published !== null} />
                )}
                slots={published ? undefined : {
                  lineNumber: (line) => (
                    <button
                      type="button"
                      title="Add your own finding on this line"
                      className="w-full hover:text-ink"
                      onClick={() => {
                        setComposing({ path: file.path, line });
                        // The form opens under the line, which may be at the
                        // bottom of the window. Bring all of it into view.
                        requestAnimationFrame(() =>
                          document
                            .getElementById("compose")
                            ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
                        );
                      }}
                    >
                      <AddOnLine line={line} />
                    </button>
                  ),
                  afterLine: (line) =>
                    composing?.path === file.path && composing.line === line ? (
                      <form
                        id="compose"
                        data-composer
                        onSubmit={addFinding}
                        // The margins keep it clear of the sticky bars.
                        className="scroll-mb-20 scroll-mt-16 border-y border-accent bg-accent-soft px-4 py-3 font-sans"
                      >
                        <p className="mb-2 text-sm font-semibold">Your finding on line {line}</p>
                        <FindingFields startLine={line} />
                        <div className="mt-3 flex items-center gap-3">
                          <button className={BUTTON_PRIMARY}>Add finding</button>
                          <button type="button" data-cancel className={BUTTON} onClick={() => setComposing(null)}>
                            Cancel
                          </button>
                          <span className="hidden text-xs text-ink-soft sm:inline">
                            <kbd className={KBD}>⌘</kbd> <kbd className={KBD}>Enter</kbd> to add,{" "}
                            <kbd className={KBD}>Esc</kbd> to cancel
                          </span>
                        </div>
                      </form>
                    ) : null,
                }}
              />
            ))}
            {view.unplaced.length > 0 && (
              <section className="mt-6">
                <h2 className={SECTION_LABEL}>Findings outside the changed lines</h2>
                {view.unplaced.map((finding) => (
                  <SandboxFindingCard
                    key={finding.id}
                    finding={finding}
                    onAction={onAction}
                    locked={published !== null}
                  />
                ))}
              </section>
            )}
            {findings.length > 0 && !published && (
              <div className="sticky bottom-0 -mx-5 mt-6 flex flex-wrap items-center gap-3 border-t border-edge bg-surface-raised/95 px-5 py-3 backdrop-blur">
                <ReasonTip reason={blocked}>
                  <button
                    className={BUTTON_PRIMARY}
                    disabled={blocked !== null}
                    onClick={() => onStep("publish")}
                  >
                    Continue to publish
                  </button>
                </ReasonTip>
                <span className="text-xs text-ink-soft">
                  {blocked ??
                    `All decided: ${counts.confirmed} to send, ${counts.rejected} rejected.`}
                </span>
              </div>
            )}
            {published && (
              <p className="mt-6 rounded-md border border-edge bg-surface-raised p-3 text-sm text-ink-soft">
                This review is published (simulated), so its findings can no longer be changed.{" "}
                <button className="text-accent underline-offset-2 hover:underline" onClick={onStartOver}>
                  Start over
                </button>{" "}
                to try a different path.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
