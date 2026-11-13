import { App } from "@octokit/app";
import { requireEnv } from "@/lib/env";

export type RepoRef = {
  owner: string;
  name: string;
};

export type CheckRunUpdate = {
  status: "in_progress" | "completed";
  /** Required by GitHub when status is "completed". */
  conclusion?: "success" | "failure" | "action_required" | "neutral";
  title: string;
  summary: string;
};

export type ReviewComment = {
  path: string;
  body: string;
  line: number;
  side: "RIGHT";
  /** Set together with start_side for a multi-line comment. */
  start_line?: number;
  start_side?: "RIGHT";
};

export type ReviewPayload = {
  commitId: string;
  body: string;
  comments: ReviewComment[];
};

/**
 * The GitHub operations this app uses, and nothing else. Application code
 * depends on this interface, so tests can substitute an in-memory fake and the
 * Octokit details stay in one file.
 */
export interface GitHubClient {
  /** Throws DiffTooLargeError when GitHub refuses to render the diff. */
  getPullRequestDiff(repo: RepoRef, pullNumber: number): Promise<string>;
  /** Returns null when the file does not exist at that ref. */
  getFileContent(repo: RepoRef, path: string, ref: string): Promise<string | null>;
  createCheckRun(
    repo: RepoRef,
    input: CheckRunUpdate & { headSha: string; detailsUrl: string },
  ): Promise<number>;
  updateCheckRun(repo: RepoRef, checkRunId: number, update: CheckRunUpdate): Promise<void>;
  /** Posts one PR review and returns its id. */
  createReview(repo: RepoRef, pullNumber: number, payload: ReviewPayload): Promise<number>;
  /** "admin", "write", "read" or "none". */
  getPermission(repo: RepoRef, username: string): Promise<string>;
}

/** GitHub will not produce a diff above its own size limits (HTTP 406). */
export class DiffTooLargeError extends Error {
  readonly code = "diff_too_large";
  constructor() {
    super("GitHub could not produce a diff for this pull request.");
    this.name = "DiffTooLargeError";
  }
}

type InstallationOctokit = Awaited<ReturnType<App["getInstallationOctokit"]>>;

const CHECK_NAME = "Second Look";

function hasStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === status
  );
}

function isNotFound(error: unknown): boolean {
  return hasStatus(error, 404);
}

class OctokitGitHubClient implements GitHubClient {
  constructor(private readonly octokit: InstallationOctokit) {}

  async getPullRequestDiff(repo: RepoRef, pullNumber: number): Promise<string> {
    try {
      const response = await this.octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        {
          owner: repo.owner,
          repo: repo.name,
          pull_number: pullNumber,
          mediaType: { format: "diff" },
        },
      );
      // With the "diff" media type the body is plain text, but Octokit's
      // types still describe the JSON response.
      return response.data as unknown as string;
    } catch (error) {
      if (hasStatus(error, 406)) {
        throw new DiffTooLargeError();
      }
      throw error;
    }
  }

  async getFileContent(repo: RepoRef, path: string, ref: string): Promise<string | null> {
    try {
      const response = await this.octokit.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        {
          owner: repo.owner,
          repo: repo.name,
          path,
          ref,
          mediaType: { format: "raw" },
        },
      );
      const data: unknown = response.data;
      // A directory or submodule comes back as JSON, not text.
      return typeof data === "string" ? data : null;
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async createCheckRun(
    repo: RepoRef,
    input: CheckRunUpdate & { headSha: string; detailsUrl: string },
  ): Promise<number> {
    const response = await this.octokit.request(
      "POST /repos/{owner}/{repo}/check-runs",
      {
        owner: repo.owner,
        repo: repo.name,
        name: CHECK_NAME,
        head_sha: input.headSha,
        details_url: input.detailsUrl,
        status: input.status,
        conclusion: input.conclusion,
        output: { title: input.title, summary: input.summary },
      },
    );
    return Number(response.data.id);
  }

  async updateCheckRun(repo: RepoRef, checkRunId: number, update: CheckRunUpdate): Promise<void> {
    await this.octokit.request(
      "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
      {
        owner: repo.owner,
        repo: repo.name,
        check_run_id: checkRunId,
        status: update.status,
        conclusion: update.conclusion,
        output: { title: update.title, summary: update.summary },
      },
    );
  }

  async createReview(repo: RepoRef, pullNumber: number, payload: ReviewPayload): Promise<number> {
    const response = await this.octokit.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      {
        owner: repo.owner,
        repo: repo.name,
        pull_number: pullNumber,
        commit_id: payload.commitId,
        // COMMENT, not REQUEST_CHANGES: merge blocking is the check run's job.
        event: "COMMENT",
        body: payload.body,
        comments: payload.comments,
      },
    );
    return Number(response.data.id);
  }

  async getPermission(repo: RepoRef, username: string): Promise<string> {
    try {
      const response = await this.octokit.request(
        "GET /repos/{owner}/{repo}/collaborators/{username}/permission",
        { owner: repo.owner, repo: repo.name, username },
      );
      return response.data.permission;
    } catch (error) {
      if (isNotFound(error)) {
        return "none";
      }
      throw error;
    }
  }
}

let cachedApp: App | undefined;

function getApp(): App {
  if (!cachedApp) {
    cachedApp = new App({
      appId: requireEnv("GITHUB_APP_ID"),
      // Env files store the PEM on one line with literal "\n".
      privateKey: requireEnv("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"),
    });
  }
  return cachedApp;
}

/** A client that acts as the GitHub App installed on one account. */
export async function getInstallationClient(installationId: number): Promise<GitHubClient> {
  const octokit = await getApp().getInstallationOctokit(installationId);
  return new OctokitGitHubClient(octokit);
}
