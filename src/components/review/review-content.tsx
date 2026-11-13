import { SummaryCard } from "@/components/summary-card";
import { LINK, SECTION_LABEL } from "@/components/ui";
import { buildReviewView } from "@/dashboard/diff-view";
import type { ReviewDetail } from "@/db/queries";
import { parseUnifiedDiff } from "@/review/diff";
import { getSkipReason } from "@/review/filters";
import { DiffFile } from "./diff-file";
import { FindingOutline } from "./finding-outline";
import { FollowUpPanel } from "./follow-up-panel";
import { FindingCard } from "./finding-card";

/**
 * The body of a review: PR header, summary, and the diff with findings
 * inline. Used by the reviewer's page and by the public read-only demo.
 * When `locked` is true no Confirm / Reject / Edit controls are rendered.
 */
export function ReviewContent({
  detail,
  diff,
  locked,
}: {
  detail: ReviewDetail;
  diff: string | null;
  locked: boolean;
}) {
  const { review, pullRequest, repository } = detail;
  const view = buildReviewView(diff === null ? [] : parseUnifiedDiff(diff), detail.findings);

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
        <p className="mt-6 text-sm text-ink-soft">
          The diff could not be loaded from GitHub. Findings are listed below without it.
        </p>
      )}

      {view.files.map((file) => (
        <DiffFile
          key={file.path}
          file={file}
          skippedAs={getSkipReason(file.path, false) ?? undefined}
          renderFinding={(finding) => <FindingCard finding={finding} locked={locked} />}
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
