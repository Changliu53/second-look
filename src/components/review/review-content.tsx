import Link from "next/link";
import { addFindingAction } from "@/app/dashboard/actions";
import { SummaryCard } from "@/components/summary-card";
import { BUTTON_PRIMARY, KBD, LINK, SECTION_LABEL } from "@/components/ui";
import { buildReviewView, fileStats, shouldFoldQuietFiles } from "@/dashboard/diff-view";
import type { ReviewDetail, ReviewRound } from "@/db/queries";
import { parseUnifiedDiff } from "@/review/diff";
import { getSkipReason } from "@/review/filters";
import { composeHref, type ComposeTarget } from "@/dashboard/compose-target";
import { AddOnLine, DiffFile } from "./diff-file";
import { FindingOutline } from "./finding-outline";
import { FollowUpPanel } from "./follow-up-panel";
import { RoundsStrip } from "./rounds-strip";
import { FindingCard } from "./finding-card";
import { FindingFields } from "./finding-fields";
import { AddFindingTip } from "./add-finding-tip";

function Composer({ reviewId, target }: { reviewId: number; target: ComposeTarget }) {
  return (
    <form
      id="compose"
      data-composer
      action={addFindingAction}
      className="scroll-mt-24 border-y border-accent bg-accent-soft px-4 py-3 font-sans"
    >
      <input type="hidden" name="reviewId" value={reviewId} />
      <input type="hidden" name="filePath" value={target.path} />
      <input type="hidden" name="startLine" value={target.line} />
      <p className="mb-2 text-sm font-semibold">Your finding on line {target.line}</p>
      <FindingFields startLine={target.line} />
      <div className="mt-3 flex items-center gap-3">
        <button className={BUTTON_PRIMARY}>Add finding</button>
        <Link data-cancel href={`/dashboard/reviews/${reviewId}`} className={`${LINK} text-sm`}>
          Cancel
        </Link>
        <span className="hidden text-xs text-ink-soft sm:inline">
          <kbd className={KBD}>⌘</kbd> <kbd className={KBD}>Enter</kbd> to add,{" "}
          <kbd className={KBD}>Esc</kbd> to cancel
        </span>
      </div>
    </form>
  );
}

/**
 * The body of a review: PR header, summary, and the diff with findings
 * inline. Used by the reviewer's page and by the public read-only demo.
 * When `locked` is true no Confirm / Reject / Edit controls are rendered.
 */
export function ReviewContent({
  detail,
  diff,
  locked,
  rounds = [],
  roundHref,
  compose = null,
}: {
  detail: ReviewDetail;
  diff: string | null;
  locked: boolean;
  rounds?: ReviewRound[];
  roundHref?: (round: ReviewRound, number: number) => string;
  /** The line a new finding is being written on, from the URL. */
  compose?: ComposeTarget | null;
}) {
  const { review, pullRequest, repository } = detail;
  const view = buildReviewView(diff === null ? [] : parseUnifiedDiff(diff), detail.findings);
  const foldQuiet = shouldFoldQuietFiles(view);

  /** The folded line for a file without findings in a long diff, or undefined. */
  function quietNote(file: (typeof view.files)[number]): string | undefined {
    if (!foldQuiet || compose?.path === file.path) {
      return undefined;
    }
    const stats = fileStats(file);
    return stats.findings > 0 ? undefined : `+${stats.added} −${stats.removed}, no findings. Click to show.`;
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{pullRequest.title}</h1>
      <p className="mt-1 text-sm text-ink-soft">
        <a
          className={LINK}
          href={`https://github.com/${repository.owner}/${repository.name}/pull/${pullRequest.number}`}
        >
          {repository.owner}/{repository.name}#{pullRequest.number}
        </a>{" "}
        by {pullRequest.authorLogin}, commit{" "}
        <span className="font-mono">{review.headSha?.slice(0, 7)}</span>
      </p>

      {roundHref && (
        <RoundsStrip rounds={rounds} currentReviewId={review.id} hrefFor={roundHref} />
      )}

      {review.summary && (
        <div className="mt-6">
          <SummaryCard summary={review.summary} />
        </div>
      )}

      {review.followUp && review.followUp.length > 0 && (
        <FollowUpPanel entries={review.followUp} />
      )}

      {detail.findings.length > 0 && (
        <div className="mt-4">
          <FindingOutline findings={detail.findings} />
        </div>
      )}

      {diff === null && (
        <p className="mt-6 rounded-md border border-edge bg-surface-raised p-3 text-sm text-ink-soft">
          The diff could not be loaded from GitHub. The findings are listed below without it.
        </p>
      )}

      {!locked && view.files.length > 0 && <AddFindingTip />}
      {!locked && view.files.length > 0 && (
        <p className="mt-4 text-xs leading-relaxed text-ink-soft">
          <span className="font-medium text-ink">Confirm</span> sends a finding to the author.{" "}
          <span className="font-medium text-ink">Reject</span> keeps it here and the author never
          sees it. <span className="font-medium text-ink">Edit</span> rewrites it in your words.
        </p>
      )}

      {foldQuiet && (
        <p className="mt-4 text-xs text-ink-soft">
          This is a long diff, so the{" "}
          {view.files.filter((file) => fileStats(file).findings === 0).length} files without findings
          are folded. Open any of them to read it or add a finding of your own.
        </p>
      )}

      {view.files.map((file) => (
        <DiffFile
          key={file.path}
          file={file}
          skippedAs={getSkipReason(file.path, false) ?? undefined}
          foldedNote={quietNote(file)}
          githubHref={
            review.headSha
              ? `https://github.com/${repository.owner}/${repository.name}/blob/${review.headSha}/${file.path.split("/").map(encodeURIComponent).join("/")}`
              : undefined
          }
          renderFinding={(finding) => <FindingCard finding={finding} locked={locked} />}
          slots={
            locked
              ? undefined
              : {
                  lineNumber: (line) => (
                    <Link
                      href={composeHref(review.id, file.path, line)}
                      title="Add your own finding on this line"
                      className="block hover:text-ink"
                    >
                      <AddOnLine line={line} />
                    </Link>
                  ),
                  afterLine: (line) =>
                    compose?.path === file.path && compose.line === line ? (
                      <Composer reviewId={review.id} target={compose} />
                    ) : null,
                }
          }
        />
      ))}

      {view.unplaced.length > 0 && (
        <section className="mt-8">
          <h2 className={SECTION_LABEL}>Findings outside the changed lines</h2>
          {view.unplaced.map((finding) => (
            <FindingCard key={finding.id} finding={finding} locked={locked} />
          ))}
        </section>
      )}
    </>
  );
}
