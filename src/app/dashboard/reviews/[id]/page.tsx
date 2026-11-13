import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getSignedInLogin } from "@/auth";
import { AllDecidedToast } from "@/components/all-decided-toast";
import { AutoRefresh } from "@/components/auto-refresh";
import { CopyButton } from "@/components/copy-button";
import { FindingKeys } from "@/components/review/finding-keys";
import { FixPromptBlock } from "@/components/review/fix-prompt-block";
import { ReviewContent } from "@/components/review/review-content";
import { parseComposeTarget } from "@/dashboard/compose-target";
import { ActivityLog } from "@/components/review/activity-log";
import { ReviewProgress } from "@/components/review/review-progress";
import { ReasonTip } from "@/components/reason-tip";
import { SiteHeader } from "@/components/site-header";
import { BUTTON_APPROVE, BUTTON_PRIMARY, BUTTON_PRIMARY_SMALL, INPUT, KBD, SECTION_LABEL } from "@/components/ui";
import { ACTION_ERRORS, getReviewFor, rerunProblem, type ActionErrorCode } from "@/dashboard/service";
import { isStaleRunning, type ReviewDetail } from "@/db/queries";
import { fixPromptFor } from "@/github/publish";
import { BUDGET_REACHED } from "@/github/review-pull-request";
import { countByStatus, publishBlockedReason } from "@/sandbox/model";
import { publishReviewAction, rerunReviewAction } from "../../actions";
import { dashboardDeps } from "../../deps";

export const dynamic = "force-dynamic";

// "Run the review again" is a server action on this page, and the review it
// starts keeps running in after() within this page's time limit. The same
// limit as the webhook, which starts the same work.
export const maxDuration = 300;

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; compose?: string; decided?: string }>;
};

/** Why the review cannot be changed any more, or null if it can. */
function lockedReason(detail: ReviewDetail): string | null {
  const { review } = detail;
  if (review.publishedAt !== null) {
    return `Published by ${review.publishedBy ?? "a reviewer"}. Findings can no longer be changed.`;
  }
  if (review.status === "superseded") {
    return "A newer commit was pushed to this pull request. This review is out of date.";
  }
  if (isStaleRunning(review)) {
    return "The AI review did not finish. It may have timed out.";
  }
  if (review.status === "failed" && review.errorMessage === BUDGET_REACHED) {
    return "Not reviewed automatically: this month's model budget is used up. Review the diff by hand, or raise MONTHLY_TOKEN_BUDGET.";
  }
  if (review.status === "failed") {
    return "The AI review failed.";
  }
  return null;
}

function pullRequestUrl(detail: ReviewDetail): string {
  const { repository, pullRequest } = detail;
  return `https://github.com/${repository.owner}/${repository.name}/pull/${pullRequest.number}`;
}

/** Stays visible while scrolling: how far along the reviewer is. */
function ProgressBar({ detail, locked }: { detail: ReviewDetail; locked: boolean }) {
  const counts = countByStatus(detail.findings);
  const critical = detail.findings.filter(
    (f) => f.severity === "critical" && f.status !== "rejected",
  ).length;

  return (
    <div className="sticky top-0 z-10 border-b border-edge bg-surface-raised/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-5 py-2">
        <p className="text-sm">
          <span className="font-semibold">{counts.pending}</span>
          <span className="text-ink-soft"> pending</span>
          <span className="mx-2 text-slate-300">·</span>
          <span className="font-semibold text-green-700">{counts.confirmed}</span>
          <span className="text-ink-soft"> confirmed</span>
          <span className="mx-2 text-slate-300">·</span>
          <span className="font-semibold">{counts.rejected}</span>
          <span className="text-ink-soft"> rejected</span>
          {critical > 0 && (
            <>
              <span className="mx-2 text-slate-300">·</span>
              <span className="font-semibold text-red-700">{critical}</span>
              <span className="text-ink-soft"> critical in play</span>
            </>
          )}
        </p>
        <div className="ml-auto flex items-center gap-4">
          {!locked && <FindingKeys pending={counts.pending} />}
          {!locked && <PublishShortcut pending={counts.pending} />}
        </div>
      </div>
    </div>
  );
}

/**
 * The publish control in the sticky bar. It jumps to the publish form, and
 * while a finding is pending it is disabled and says why, the same as the
 * button in the form itself.
 */
function PublishShortcut({ pending }: { pending: number }) {
  const blocked = publishBlockedReason(pending);
  if (blocked) {
    return (
      <ReasonTip reason={blocked} side="bottom" align="end">
        <button type="button" disabled className={BUTTON_PRIMARY_SMALL}>
          Publish
        </button>
      </ReasonTip>
    );
  }
  return (
    <a href="#publish" className={BUTTON_PRIMARY_SMALL}>
      Publish
    </a>
  );
}

const CHOICE =
  "flex cursor-pointer gap-3 rounded-md border border-edge p-3 transition hover:border-slate-400 has-[:checked]:border-accent has-[:checked]:bg-accent-soft";

function PublishForm({ detail }: { detail: ReviewDetail }) {
  const counts = countByStatus(detail.findings);
  const blocked = publishBlockedReason(counts.pending);
  const confirmedCritical = detail.findings.filter(
    (f) => f.status === "confirmed" && f.severity === "critical",
  ).length;
  const authorPrompt = fixPromptFor(detail.pullRequest.title, detail.findings, "author");
  const author = detail.pullRequest.authorLogin;
  // Every finding decided and none confirmed: the reviewer is approving.
  const approving = blocked === null && counts.confirmed === 0;

  if (approving) {
    return (
      <form
        id="publish"
        action={publishReviewAction}
        className="mt-8 scroll-mt-20 rounded-lg border border-green-200 bg-green-50 p-5"
      >
        <input type="hidden" name="reviewId" value={detail.review.id} />
        <h2 className={`${SECTION_LABEL} !text-green-900`}>Approve</h2>
        <p className="mt-2 text-sm leading-relaxed text-green-950">
          {detail.findings.length === 0
            ? "The first pass found nothing. "
            : `You rejected all ${detail.findings.length} findings, so there is nothing to send back. `}
          Approving posts a short review telling {author} that no changes are needed, and the
          check passes. Rejected findings and your reasons stay here.
        </p>
        <label className="mt-4 block text-sm text-green-950">
          Note to {author} (optional)
          <textarea
            name="note"
            rows={2}
            maxLength={2000}
            placeholder="For example: looks good, thanks."
            className={`mt-1 ${INPUT}`}
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className={BUTTON_APPROVE}>Approve: no changes needed</button>
          <span className="text-xs text-green-950">
            Saw something the first pass missed? Click the + next to a line to add it instead.
          </span>
        </div>
      </form>
    );
  }

  return (
    <form
      id="publish"
      action={publishReviewAction}
      className="mt-8 scroll-mt-20 rounded-lg border border-edge bg-surface-raised p-5"
    >
      <input type="hidden" name="reviewId" value={detail.review.id} />
      <h2 className={SECTION_LABEL}>Publish review</h2>
      <p className="mt-2 text-sm leading-relaxed">
        Posts the summary and {counts.confirmed} confirmed finding
        {counts.confirmed === 1 ? "" : "s"} to the pull request as one review.{" "}
        {counts.rejected > 0 &&
          `The ${counts.rejected} rejected finding${counts.rejected === 1 ? " is" : "s are"} not shown to the author. `}
        The check will then{" "}
        {confirmedCritical > 0 ? (
          <strong className="text-red-700">require action ({confirmedCritical} critical)</strong>
        ) : (
          <strong className="text-green-700">pass</strong>
        )}
        .
      </p>

      {counts.confirmed > 0 && (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Who makes the fixes?</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className={CHOICE}>
              <input type="radio" name="resolution" value="author_fixes" defaultChecked className="mt-1" />
              <span>
                <span className="block text-sm font-medium">Send back to {author}</span>
                <span className="block text-xs leading-relaxed text-ink-soft">
                  They get your comments and a prompt to paste into their AI tool, which tells it
                  to fix these findings and nothing else.
                </span>
              </span>
            </label>
            <label className={CHOICE}>
              <input type="radio" name="resolution" value="reviewer_takes_over" className="mt-1" />
              <span>
                <span className="block text-sm font-medium">I will fix it myself</span>
                <span className="block text-xs leading-relaxed text-ink-soft">
                  {author} is told they do not need to do anything. You get a checkout command and
                  a prompt for your own coding agent.
                </span>
              </span>
            </label>
          </div>
        </fieldset>
      )}

      {authorPrompt && (
        <div className="mt-3">
          <FixPromptBlock
            title="Fix prompt"
            hint="What the author gets if you send it back. Updates as you confirm and edit."
            prompt={authorPrompt}
          />
        </div>
      )}

      <label className="mt-4 block text-sm">
        Note to the author (optional)
        <textarea name="note" rows={2} maxLength={2000} className={`mt-1 ${INPUT}`} />
      </label>
      <div className="mt-3 flex items-center gap-3">
        <ReasonTip reason={blocked}>
          <button disabled={blocked !== null} className={BUTTON_PRIMARY}>
            Publish review
          </button>
        </ReasonTip>
        {blocked && (
          <span className="text-sm text-ink-soft">
            {blocked} Press <kbd className={KBD}>n</kbd> to jump to the next one.
          </span>
        )}
      </div>
    </form>
  );
}

/** After publishing: what happens next, and what the reviewer needs for it. */
function Handoff({ detail }: { detail: ReviewDetail }) {
  const { review, pullRequest } = detail;
  const confirmed = detail.findings.filter((f) => f.status === "confirmed");
  // Reviews published before publish modes existed have no resolution and
  // were posted without a fix prompt, so there is nothing true to say here.
  if (review.publishedAt === null || review.resolution === null || confirmed.length === 0) {
    return null;
  }
  const takenOver = review.resolution === "reviewer_takes_over";
  const prompt = fixPromptFor(pullRequest.title, detail.findings, takenOver ? "engineer" : "author");

  return (
    <section className="mb-6 rounded-lg border border-edge bg-surface-raised p-5">
      <h2 className={SECTION_LABEL}>{takenOver ? "You took this over" : "Sent back to the author"}</h2>
      {takenOver ? (
        <>
          <p className="mt-2 text-sm leading-relaxed">
            {pullRequest.authorLogin} was told they do not need to do anything. Check out the
            branch, fix the {confirmed.length} confirmed finding{confirmed.length === 1 ? "" : "s"},
            and push. Your push starts a new review that says which ones are fixed.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="rounded bg-slate-100 px-2 py-1 font-mono text-xs">
              gh pr checkout {pullRequest.number}
            </code>
            <CopyButton text={`gh pr checkout ${pullRequest.number}`} />
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm leading-relaxed">
          {pullRequest.authorLogin} has your comments and the fix prompt on GitHub. When they push,
          a new review starts here and says which of these {confirmed.length} finding
          {confirmed.length === 1 ? " is" : "s are"} fixed.
        </p>
      )}
      {prompt && (
        <div className="mt-3">
          <FixPromptBlock
            title={takenOver ? "Prompt for your coding agent" : "Fix prompt"}
            hint={
              takenOver
                ? "Paste into your agent in the checked-out branch."
                : "Rebuilt from the confirmed findings. The copy on GitHub is what was sent."
            }
            prompt={prompt}
            open={takenOver}
          />
        </div>
      )}
    </section>
  );
}

export default async function ReviewPage({ params, searchParams }: PageProps) {
  const login = await getSignedInLogin();
  if (!login) {
    redirect("/dashboard");
  }
  const id = z.coerce.number().int().positive().safeParse((await params).id);
  if (!id.success) {
    notFound();
  }
  const loaded = await getReviewFor(id.data, login, dashboardDeps());
  if (!loaded) {
    notFound();
  }

  const { detail, diff, rounds, history, newerReviewId } = loaded;
  // Only known codes are shown. Anything else in the URL is ignored.
  const query = await searchParams;
  const errorCode = query.error ?? "";
  const error = errorCode in ACTION_ERRORS ? ACTION_ERRORS[errorCode as ActionErrorCode] : null;
  const isRunning = detail.review.status === "running" && !isStaleRunning(detail.review);
  const reason = lockedReason(detail);
  const locked = reason !== null || isRunning;

  return (
    <>
      <SiteHeader current="/dashboard">
        <span className="text-ink-soft">{login}</span>
      </SiteHeader>
      {isRunning && <AutoRefresh seconds={3} />}
      {detail.findings.length > 0 && <ProgressBar detail={detail} locked={locked} />}
      {/* Set by the action that decided the last pending finding. Checked
          against the data too, so a stale or hand-typed URL announces nothing. */}
      {query.decided === "all" && !locked && countByStatus(detail.findings).pending === 0 && (
        <AllDecidedToast nothingToSend={countByStatus(detail.findings).confirmed === 0} />
      )}

      <main className="mx-auto max-w-5xl px-5 py-8">
        {error && (
          <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        {reason && rerunProblem(detail.review) === null && (
          <form
            action={rerunReviewAction}
            className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <input type="hidden" name="reviewId" value={detail.review.id} />
            <span className="min-w-0 flex-1">
              {reason} Running it again reads the pull request from GitHub as it is now and makes
              one model call.
            </span>
            <button className={BUTTON_PRIMARY_SMALL}>Run the review again</button>
          </form>
        )}
        {reason && rerunProblem(detail.review) !== null && (
          <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {reason}
            {detail.review.publishedAt !== null && (
              <>
                {" "}
                <a className="font-medium underline" href={pullRequestUrl(detail)}>
                  See it on GitHub
                </a>
              </>
            )}
            {newerReviewId !== null && (
              <>
                {" "}
                <a className="font-medium underline" href={`/dashboard/reviews/${newerReviewId}`}>
                  Open the review of the latest commit
                </a>
              </>
            )}
          </p>
        )}

        {isRunning && (
          <ReviewProgress
            stage={detail.review.stage}
            startedAt={detail.review.createdAt.toISOString()}
          />
        )}

        <Handoff detail={detail} />

        <ReviewContent
          detail={detail}
          diff={diff}
          locked={locked}
          rounds={rounds}
          roundHref={(round) => `/dashboard/reviews/${round.reviewId}`}
          compose={parseComposeTarget(query.compose)}
        />

        {!locked && <PublishForm detail={detail} />}
        <ActivityLog events={history} findings={detail.findings} />
      </main>
    </>
  );
}
