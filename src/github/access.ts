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
