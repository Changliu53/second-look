import type {
  CheckRunUpdate,
  GitHubClient,
  RepoRef,
  ReviewPayload,
} from "@/github/client";

type FileKey = `${string}@${string}`;

/** In-memory GitHubClient. Records every write so tests can inspect them. */
export class FakeGitHub implements GitHubClient {
  diff = "";
  files = new Map<FileKey, string>();
  permissions = new Map<string, string>();
  checkRuns: Array<CheckRunUpdate & { id: number; headSha: string; detailsUrl: string }> = [];
  checkRunUpdates: Array<{ id: number; update: CheckRunUpdate }> = [];
  reviews: Array<{ pullNumber: number; payload: ReviewPayload }> = [];
  fileRequests: Array<{ path: string; ref: string }> = [];
  failOn: "diff" | "createCheckRun" | "createReview" | null = null;
  /** When set, getPullRequestDiff throws this exact error. */
  diffError: Error | null = null;

  setFile(path: string, ref: string, content: string): void {
    this.files.set(`${path}@${ref}`, content);
  }

  async getPullRequestDiff(): Promise<string> {
    if (this.diffError) {
      throw this.diffError;
    }
    if (this.failOn === "diff") {
      throw Object.assign(new Error("boom"), { status: 500 });
    }
    return this.diff;
  }

  async getFileContent(_repo: RepoRef, path: string, ref: string): Promise<string | null> {
    this.fileRequests.push({ path, ref });
    return this.files.get(`${path}@${ref}`) ?? null;
  }

  async createCheckRun(
    _repo: RepoRef,
    input: CheckRunUpdate & { headSha: string; detailsUrl: string },
  ): Promise<number> {
    if (this.failOn === "createCheckRun") {
      throw Object.assign(new Error("forbidden"), { status: 403 });
    }
    const id = 9000 + this.checkRuns.length;
    this.checkRuns.push({ ...input, id });
    return id;
  }

  async updateCheckRun(_repo: RepoRef, checkRunId: number, update: CheckRunUpdate): Promise<void> {
    this.checkRunUpdates.push({ id: checkRunId, update });
  }

  async createReview(_repo: RepoRef, pullNumber: number, payload: ReviewPayload): Promise<number> {
    if (this.failOn === "createReview") {
      throw Object.assign(new Error("unprocessable"), { status: 422 });
    }
    this.reviews.push({ pullNumber, payload });
    return 7000 + this.reviews.length;
  }

  async getPermission(_repo: RepoRef, username: string): Promise<string> {
    return this.permissions.get(username) ?? "none";
  }

  lastCheckUpdate(): CheckRunUpdate | undefined {
    return this.checkRunUpdates.at(-1)?.update;
  }
}
