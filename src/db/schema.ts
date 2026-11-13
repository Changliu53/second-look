import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const reviewSourceEnum = pgEnum("review_source", ["github", "paste"]);

export const reviewStatusEnum = pgEnum("review_status", [
  "running",
  "completed",
  "failed",
  "too_large",
  // A newer commit was pushed, so this review no longer describes the PR.
  "superseded",
]);

export const riskLevelEnum = pgEnum("risk_level", ["low", "medium", "high"]);

export const severityEnum = pgEnum("finding_severity", [
  "critical",
  "warning",
  "nit",
]);

export const categoryEnum = pgEnum("finding_category", [
  "bug",
  "security",
  "logic",
  "error-handling",
  "hallucinated-api",
  "scope-creep",
  "missing-tests",
  "style",
  // Added after the first release, so they come last: Postgres appends new
  // enum values and the order here must match the migrations.
  "access-control",
  "data-loss",
]);

export const findingStatusEnum = pgEnum("finding_status", [
  "pending",
  "confirmed",
  "rejected",
]);

export const findingSourceEnum = pgEnum("finding_source", ["ai", "human"]);

/** Who makes the fixes after the review is published. */
export const resolutionEnum = pgEnum("review_resolution", [
  // The author gets the comments and a prompt for their AI tool.
  "author_fixes",
  // The reviewer fixes the pull request themselves.
  "reviewer_takes_over",
]);

/**
 * How a finding from the previous review of the same pull request looks at
 * this commit. The earlier finding's text is copied in, so the follow-up can
 * be shown without loading the old review.
 */
export type FollowUpEntry = {
  previousFindingId: number;
  status: "fixed" | "still_present" | "unclear";
  note: string;
  filePath: string;
  startLine: number;
  severity: "critical" | "warning" | "nit";
  explanation: string;
};

/** The steps of a running review, in order. */
export const REVIEW_STAGES = ["fetching_diff", "reading_files", "model_reviewing"] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];

/** The plain-English summary shown to a non-technical PR author. */
export type ReviewSummary = {
  whatChanged: string;
  riskLevel: "low" | "medium" | "high";
  doubleCheck: string[];
};

export const repositories = pgTable("repositories", {
  id: serial("id").primaryKey(),
  githubRepoId: bigint("github_repo_id", { mode: "number" }).notNull().unique(),
  // Needed to get an installation token for this repo later (dashboard, publish).
  installationId: bigint("installation_id", { mode: "number" }).notNull(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const pullRequests = pgTable(
  "pull_requests",
  {
    id: serial("id").primaryKey(),
    repositoryId: integer("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    authorLogin: text("author_login").notNull(),
    headSha: text("head_sha").notNull(),
    // The branch the PR targets. Needed to rebuild the diff of an older commit.
    baseRef: text("base_ref"),
    // Set when the PR is closed or merged, cleared when it is reopened.
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("pull_requests_repo_number_idx").on(
      table.repositoryId,
      table.number,
    ),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    source: reviewSourceEnum("source").notNull(),
    // Null for paste mode, which has no PR.
    pullRequestId: integer("pull_request_id").references(
      () => pullRequests.id,
      { onDelete: "cascade" },
    ),
    headSha: text("head_sha"),
    status: reviewStatusEnum("status").notNull().default("running"),
    // What a running review is doing right now, shown live to the reviewer.
    stage: text("stage").$type<ReviewStage>(),
    summary: jsonb("summary").$type<ReviewSummary>(),
    followUp: jsonb("follow_up").$type<FollowUpEntry[]>(),
    resolution: resolutionEnum("resolution"),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    // Short, safe-to-store reason. Never contains code or secrets.
    errorMessage: text("error_message"),
    checkRunId: bigint("check_run_id", { mode: "number" }),
    reviewerNote: text("reviewer_note"),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    githubReviewId: bigint("github_review_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    // One review per commit of a PR. Makes webhook redelivery a no-op.
    uniqueIndex("reviews_pr_sha_idx")
      .on(table.pullRequestId, table.headSha)
      .where(sql`${table.pullRequestId} is not null`),
    index("reviews_created_at_idx").on(table.createdAt),
  ],
);

export const findings = pgTable(
  "findings",
  {
    id: serial("id").primaryKey(),
    reviewId: integer("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    source: findingSourceEnum("source").notNull().default("ai"),
    filePath: text("file_path").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    severity: severityEnum("severity").notNull(),
    category: categoryEnum("category").notNull(),
    // The model's original text. Never overwritten, so we can later compare
    // what the AI said with what the reviewer decided.
    explanation: text("explanation").notNull(),
    suggestedFix: text("suggested_fix"),
    confidence: real("confidence").notNull(),
    status: findingStatusEnum("status").notNull().default("pending"),
    // Reviewer's rewrite. When set, these are published instead of the originals.
    editedExplanation: text("edited_explanation"),
    editedSuggestedFix: text("edited_suggested_fix"),
    rejectionReason: text("rejection_reason"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("findings_review_idx").on(table.reviewId)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    id: serial("id").primaryKey(),
    // A salted hash of the caller's IP. The raw IP is never stored.
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("rate_limits_key_window_idx").on(table.key, table.windowStart),
  ],
);

export type Repository = typeof repositories.$inferSelect;
export type PullRequest = typeof pullRequests.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
