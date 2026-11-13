"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { RiskBadge } from "@/components/badges";
import { MarkdownLite } from "@/components/markdown-lite";
import { AddOnLine, DiffFile } from "@/components/review/diff-file";
import { FindingFields } from "@/components/review/finding-fields";
import { FindingOutline } from "@/components/review/finding-outline";
import { FixPromptBlock } from "@/components/review/fix-prompt-block";
import { FindingKeys } from "@/components/review/finding-keys";
import { ReasonTip } from "@/components/reason-tip";
import { SiteHeader } from "@/components/site-header";
import { Toast } from "@/components/toast";
import { BUTTON, BUTTON_PRIMARY, INPUT, KBD, SECTION_LABEL } from "@/components/ui";
import { buildReviewView } from "@/dashboard/diff-view";
import type { Finding } from "@/db/schema";
import type { Example } from "@/examples/examples";
import type { SavedResult } from "@/examples/saved";
import { checkRunFor } from "@/github/check-run";
import {
  buildReviewParts,
  fixPromptFor,
  fixPromptSection,
  type Resolution,
} from "@/github/publish";
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
import { SandboxFindingCard } from "./sandbox-finding-card";

/**
 * The home page: the whole product loop in one screen, with no login.
 * Left: pick an example or paste code. Right: the AI's findings inline in the
 * code, which the visitor confirms or rejects, and a preview of what the pull
 * request author would then receive.
 */

type Review = {
  /** The exact code that was reviewed, so the diff matches the findings. */
  code: string;
  /** Stands in for the pull request title in the fix prompt. */
  title: string;
  summary: ReviewSummary;
  /** Shown above the result: where it came from. */
  origin: string;
};

type Request =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string };

type Tab = "review" | "author";

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
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("review");
  const [review, setReview] = useState<Review | null>(
    selected && saved
      ? {
          code: selected.code,
          title: selected.description,
          summary: saved.summary,
          origin: savedOrigin(saved),
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
    });
    setFindings(toSandboxFindings(outcome.result.findings));
    setPublished(null);
    setTab("review");
    setRequest({ phase: "idle" });
  }

  /** The simulated publish: nothing leaves the browser. */
  function publish(resolution: Resolution) {
    setPublished(resolution);
    setToast(
      resolution === "reviewer_takes_over"
        ? "Published (simulated). The author is told you are taking this over."
        : "Published (simulated). The author gets your comments and the fix prompt.",
    );
    document.getElementById("result")?.scrollTo({ top: 0 });
  }

  /** Back to the review as the AI returned it, to try a different path. */
  function startOver() {
    // Drop findings the visitor added and undo every decision.
    setFindings((current) => current.filter((f) => f.source === "ai").map(resetDecision));
    setPublished(null);
    setTab("review");
    document.getElementById("result")?.scrollTo({ top: 0 });
  }

  /** Switches tab and returns to the top, since the two tabs differ in length. */
  function showTab(next: Tab) {
    setTab(next);
    document.getElementById("result")?.scrollTo({ top: 0 });
  }

  function act(action: SandboxAction) {
    setFindings((current) => sandboxReducer(current, action));
  }

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
            tab={tab}
            onTab={showTab}
            published={published}
            onPublish={publish}
            onStartOver={startOver}
            onAction={act}
          />
        ) : (
          <EmptyState />
        )}
      </div>
      </main>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
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
  tab,
  onTab,
  onAction,
  published,
  onPublish,
  onStartOver,
}: {
  review: Review;
  findings: Finding[];
  tab: Tab;
  onTab: (tab: Tab) => void;
  onAction: (action: SandboxAction) => void;
  /** Set once the visitor has pressed Publish. Decisions are then fixed. */
  published: Resolution | null;
  onPublish: (resolution: Resolution) => void;
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

  const tabClass = (name: Tab) =>
    `rounded-md px-2.5 py-1 text-sm font-medium transition ${
      tab === name ? "bg-slate-900 text-white" : "text-ink-soft hover:bg-slate-100 hover:text-ink"
    }`;

  return (
    <div className="animate-rise-in">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge bg-surface-raised/95 px-5 py-2.5 backdrop-blur">
        <div className="flex gap-1" role="tablist">
          <button role="tab" aria-selected={tab === "review"} className={tabClass("review")} onClick={() => onTab("review")}>
            1. Your review
          </button>
          <ReasonTip reason={blocked} side="bottom">
            <button
              role="tab"
              aria-selected={tab === "author"}
              disabled={blocked !== null}
              className={`${tabClass("author")} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink-soft`}
              onClick={() => onTab("author")}
            >
              2. Publish
            </button>
          </ReasonTip>
        </div>
        <p className="text-xs text-ink-soft">
          <span className="font-semibold text-ink">{counts.pending}</span> pending
          <span className="mx-1.5">·</span>
          <span className="font-semibold text-green-700">{counts.confirmed}</span> confirmed
          <span className="mx-1.5">·</span>
          <span className="font-semibold text-ink">{counts.rejected}</span> rejected
        </p>
        <div className="ml-auto">{tab === "review" && !published && <FindingKeys />}</div>
      </div>

      <div className="mx-auto max-w-4xl p-5">
        {tab === "review" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">
                {findings.length === 0
                  ? "No findings"
                  : `${findings.length} finding${findings.length === 1 ? "" : "s"} to go through`}
              </h2>
              <RiskBadge riskLevel={review.summary.riskLevel} />
            </div>
            <p className="mt-1 text-xs text-ink-soft">{review.origin}</p>
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
                    onClick={() => onTab("author")}
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
        ) : (
          <AuthorView
            review={review}
            findings={findings}
            files={files}
            blocked={blocked}
            published={published}
            onPublish={onPublish}
            onStartOver={onStartOver}
          />
        )}
      </div>
    </div>
  );
}

const CHECK_STYLES: Record<string, string> = {
  action_required: "border-red-200 bg-red-50 text-red-900",
  success: "border-green-200 bg-green-50 text-green-900",
};

// In the preview text a real reviewer's GitHub login would appear here.
const PREVIEW_REVIEWER = "The reviewer";

const MODES: Array<{ value: Resolution; label: string; detail: string }> = [
  {
    value: "author_fixes",
    label: "Send back to the author",
    detail: "They get your comments and a prompt for their AI tool.",
  },
  {
    value: "reviewer_takes_over",
    label: "I will fix it myself",
    detail: "The author is told to do nothing. You get a prompt for your own agent.",
  },
];

function AuthorView({
  review,
  findings,
  files,
  blocked,
  published,
  onPublish,
  onStartOver,
}: {
  review: Review;
  findings: Finding[];
  files: ReturnType<typeof parseUnifiedDiff>;
  /** Why publishing is unavailable, or null. The tab is disabled while this
   *  is set, so the button here is a second guard, not the usual path. */
  blocked: string | null;
  published: Resolution | null;
  onPublish: (resolution: Resolution) => void;
  onStartOver: () => void;
}) {
  const [chosen, setResolution] = useState<Resolution>("author_fixes");
  // Once published, the mode that was used is shown and cannot be changed.
  const resolution = published ?? chosen;
  const [copied, setCopied] = useState(false);
  const confirmed = findings.filter((finding) => finding.status === "confirmed");
  const takenOver = resolution === "reviewer_takes_over";
  const title = review.title;
  const parts = buildReviewParts({
    headSha: "",
    summary: review.summary,
    findings,
    files,
    reviewerLogin: PREVIEW_REVIEWER,
    reviewerNote: null,
    resolution,
    pullRequestTitle: title,
  });
  const engineerPrompt = takenOver ? fixPromptFor(title, findings, "engineer") : null;
  const check = checkRunFor({
    kind: "published",
    confirmedCount: confirmed.length,
    confirmedCriticalCount: confirmed.filter((f) => f.severity === "critical").length,
    takenOverBy: takenOver ? PREVIEW_REVIEWER : undefined,
  });

  async function copyMarkdown() {
    const comments = parts.comments.map(
      (comment) => `### ${comment.path}:${comment.line}\n\n${comment.body}`,
    );
    // Same order as the real review: body, fix prompt, footer, then comments.
    const promptSection = parts.fixPrompt ? [fixPromptSection(parts.fixPrompt)] : [];
    await navigator.clipboard.writeText(
      [parts.main, ...promptSection, parts.footer, ...comments].join("\n\n"),
    );
    setCopied(true);
  }

  return (
    <div className="space-y-4">
      {published ? (
        <section role="status" className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-950">
          <p className="text-base font-semibold">Review published (simulated)</p>
          <p className="mt-1 leading-relaxed">
            Nothing left your browser. On a real pull request, this is the moment the author first
            hears from Second Look: one GitHub review with the {confirmed.length} finding
            {confirmed.length === 1 ? "" : "s"} you confirmed, shown below.
          </p>
          <p className="mt-2 font-medium">What happens next</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 leading-relaxed">
            <li>
              {takenOver
                ? "You check out the branch and make the fixes, with the prompt below if you use a coding agent."
                : "The author pastes the fix prompt into their AI tool and pushes the result."}
            </li>
            <li>The push starts a second review. It says which findings are fixed and does not repeat what you rejected.</li>
            <li>You publish again, and the check turns green when no critical finding is left.</li>
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link href="/example" className={BUTTON_PRIMARY}>
              See real pull requests after round two
            </Link>
            <button className={BUTTON} onClick={onStartOver}>
              Start over
            </button>
          </div>
        </section>
      ) : (
        <header>
          <h2 className="text-lg font-semibold tracking-tight">Publish the review</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Until now nothing has reached the author. Choose who makes the fixes, check what will
            be posted, then publish. This is a playground, so pressing Publish only shows what
            would happen.
          </p>
        </header>
      )}

      {confirmed.length > 0 && (
        <fieldset>
          <legend className={SECTION_LABEL}>Who makes the fixes?</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {MODES.map((mode) => (
              <label
                key={mode.value}
                className="flex cursor-pointer gap-3 rounded-md border border-edge bg-surface-raised p-3 transition hover:border-slate-400 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
              >
                <input
                  type="radio"
                  name="resolution"
                  className="mt-1"
                  checked={resolution === mode.value}
                  disabled={published !== null}
                  onChange={() => setResolution(mode.value)}
                />
                <span>
                  <span className="block text-sm font-medium">{mode.label}</span>
                  <span className="block text-xs leading-relaxed text-ink-soft">{mode.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {!published && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-edge bg-surface-raised p-4">
          <ReasonTip reason={blocked}>
            <button className={BUTTON_PRIMARY} disabled={blocked !== null} onClick={() => onPublish(resolution)}>
              Publish review
            </button>
          </ReasonTip>
          <span className="text-xs leading-relaxed text-ink-soft">
            Posts one review with {confirmed.length} finding{confirmed.length === 1 ? "" : "s"} and
            sets the check. Below is exactly what would be posted.
          </span>
        </div>
      )}

      <div className={`rounded-lg border p-3 text-sm ${CHECK_STYLES[check.conclusion ?? ""] ?? "border-edge"}`}>
        <p className={SECTION_LABEL}>Check on the pull request</p>
        <p className="mt-1 font-semibold">Second Look: {check.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed opacity-90">{check.summary}</p>
      </div>

      <section className="rounded-lg border border-edge bg-surface-raised">
        <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-2">
          <p className={SECTION_LABEL}>{published ? "Review posted to GitHub" : "Review that will be posted"}</p>
          <button className={BUTTON} onClick={copyMarkdown}>
            {copied ? "Copied" : "Copy as Markdown"}
          </button>
        </div>
        <div className="space-y-3 p-4">
          <MarkdownLite text={parts.main} />
          <MarkdownLite text={parts.footer} />
        </div>
      </section>

      {parts.fixPrompt && (
        <FixPromptBlock
          title="Fix prompt, included in the review"
          hint="The author pastes this into their AI tool."
          prompt={parts.fixPrompt}
          open
        />
      )}
      {engineerPrompt && (
        <FixPromptBlock
          title="Prompt for your coding agent"
          hint="Shown to you in the dashboard after you publish. The author does not get it."
          prompt={engineerPrompt}
          open
        />
      )}

      {parts.comments.length > 0 && (
        <section>
          <p className={SECTION_LABEL}>
            {parts.comments.length} inline comment{parts.comments.length === 1 ? "" : "s"} on the diff
          </p>
          <ul className="mt-2 space-y-2">
            {parts.comments.map((comment, index) => (
              <li key={index} className="rounded-lg border border-edge bg-surface-raised p-3">
                <p className="font-mono text-xs text-ink-soft">
                  {comment.path === PASTED_FILE_NAME ? "line " : `${comment.path}:`}
                  {comment.start_line ? `${comment.start_line}-` : ""}
                  {comment.line}
                </p>
                <div className="mt-1.5">
                  <MarkdownLite text={comment.body} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs leading-relaxed text-ink-soft">
        Rejected findings and your reasons stay in Second Look. The author sees one review, written
        as if by you, and nothing the AI got wrong.
      </p>
    </div>
  );
}
