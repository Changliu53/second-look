import type { GitHubClient, RepoRef } from "./client";

/**
 * Signing in proves who you are, not what you may see. Any GitHub user can
 * sign in, so every dashboard read and write also checks that the user has
 * write access to the repository in question. We ask GitHub each time instead
 * of keeping our own member list, so removing someone from the repo removes
 * their dashboard access too.
 */
const REVIEWER_PERMISSIONS = new Set(["admin", "write"]);

export async function canReviewRepository(
  github: GitHubClient,
  repo: RepoRef,
  login: string,
): Promise<boolean> {
  const permission = await github.getPermission(repo, login);
  return REVIEWER_PERMISSIONS.has(permission);
}

type CachedAnswer = { allowed: boolean; expiresAt: number };

// Above this many entries, expired ones are swept out on the next write.
const SWEEP_AT = 5_000;

/**
 * Remembers permission answers for a short time. The dashboard asks on every
 * page and every Confirm or Reject, and with many reviewers that is many
 * calls against the installation's GitHub rate limit, each one a round trip
 * the reviewer waits for.
 *
 * The cost is that a change of access takes up to `ttlMs` to be noticed:
 * someone removed from a repository can keep acting on it for that long.
 * One minute is short enough for that, and long enough to absorb a reviewer
 * working through a review.
 */
export class PermissionCache {
  private readonly entries = new Map<string, CachedAnswer>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async canReview(github: GitHubClient, repo: RepoRef, login: string): Promise<boolean> {
    // GitHub logins and repository names are not case sensitive.
    const key = `${repo.owner}/${repo.name}:${login}`.toLowerCase();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) {
      return cached.allowed;
    }
    const allowed = await canReviewRepository(github, repo, login);
    this.remember(key, allowed);
    return allowed;
  }

  private remember(key: string, allowed: boolean): void {
    const now = this.now();
    if (this.entries.size >= SWEEP_AT) {
      for (const [entryKey, entry] of this.entries) {
        if (entry.expiresAt <= now) {
          this.entries.delete(entryKey);
        }
      }
    }
    this.entries.set(key, { allowed, expiresAt: now + this.ttlMs });
  }
}
