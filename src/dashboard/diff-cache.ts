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

export async function getDiffCached(
  github: GitHubClient,
  repo: RepoRef,
  pullNumber: number,
  headSha: string | null,
  now: number = Date.now(),
): Promise<string> {
  // Without a commit to key on, caching could serve a stale diff.
  if (headSha === null) {
    return github.getPullRequestDiff(repo, pullNumber);
  }
  const key = `${repo.owner}/${repo.name}#${pullNumber}@${headSha}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.diff;
  }

  const diff = await github.getPullRequestDiff(repo, pullNumber);
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
