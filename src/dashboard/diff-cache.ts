import type { GitHubClient, RepoRef } from "@/github/client";

/**
 * Remembers pull request diffs for a few minutes.
 *
 * The review page is re-rendered after every Confirm or Reject, and each
 * render used to ask GitHub for the same diff again, which made every click
 * wait on a network round trip. The key includes the head commit, so a new
 * push is never served the old diff.
 *
 * This is a per-instance memory cache. On serverless a cold instance starts
 * empty, which only costs one extra request.
 */

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 50;

type Entry = { diff: string; expiresAt: number };

const cache = new Map<string, Entry>();

/** What is needed to find the diff a review was written about. */
export type ReviewDiffTarget = {
  pullNumber: number;
  /** The commit the review is of. */
  headSha: string | null;
  /** The pull request's newest commit. */
  currentHeadSha: string;
  baseRef: string | null;
};

/**
 * The diff for a review, or null when it cannot be rebuilt.
 *
 * - A review of the newest commit uses the pull request's own diff.
 * - A review of an older commit compares that commit with the base branch.
 *   The pull request's current diff would show code the findings were not
 *   written about.
 */
export async function getReviewDiff(
  github: GitHubClient,
  repo: RepoRef,
  target: ReviewDiffTarget,
  now: number = Date.now(),
): Promise<string | null> {
  const { headSha } = target;
  if (headSha === null) {
    return null;
  }
  const isCurrent = headSha === target.currentHeadSha;
  if (!isCurrent && target.baseRef === null) {
    return null;
  }

  const key = `${repo.owner}/${repo.name}#${target.pullNumber}@${headSha}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.diff;
  }

  const diff = isCurrent
    ? await github.getPullRequestDiff(repo, target.pullNumber)
    : await github.getDiffAtCommit(repo, target.baseRef ?? "", headSha);
  if (cache.size >= MAX_ENTRIES) {
    // Maps keep insertion order, so the first key is the oldest entry.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, { diff, expiresAt: now + TTL_MS });
  return diff;
}

/** For tests. */
export function clearDiffCache(): void {
  cache.clear();
}
