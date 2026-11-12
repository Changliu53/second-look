CREATE TYPE "public"."finding_category" AS ENUM('bug', 'security', 'logic', 'error-handling', 'hallucinated-api', 'scope-creep', 'missing-tests', 'style');--> statement-breakpoint
CREATE TYPE "public"."finding_source" AS ENUM('ai', 'human');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('pending', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."review_source" AS ENUM('github', 'paste');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('running', 'completed', 'failed', 'too_large', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('critical', 'warning', 'nit');--> statement-breakpoint
CREATE TABLE "findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" integer NOT NULL,
	"source" "finding_source" DEFAULT 'ai' NOT NULL,
	"file_path" text NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"category" "finding_category" NOT NULL,
	"explanation" text NOT NULL,
	"suggested_fix" text,
	"confidence" real NOT NULL,
	"status" "finding_status" DEFAULT 'pending' NOT NULL,
	"edited_explanation" text,
	"edited_suggested_fix" text,
	"rejection_reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"author_login" text NOT NULL,
	"head_sha" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" serial PRIMARY KEY NOT NULL,
	"github_repo_id" bigint NOT NULL,
	"installation_id" bigint NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repositories_github_repo_id_unique" UNIQUE("github_repo_id")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" "review_source" NOT NULL,
	"pull_request_id" integer,
	"head_sha" text,
	"status" "review_status" DEFAULT 'running' NOT NULL,
	"summary" jsonb,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"error_message" text,
	"check_run_id" bigint,
	"reviewer_note" text,
	"published_by" text,
	"published_at" timestamp with time zone,
	"github_review_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "findings_review_idx" ON "findings" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_repo_number_idx" ON "pull_requests" USING btree ("repository_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limits_key_window_idx" ON "rate_limits" USING btree ("key","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_pr_sha_idx" ON "reviews" USING btree ("pull_request_id","head_sha") WHERE "reviews"."pull_request_id" is not null;--> statement-breakpoint
CREATE INDEX "reviews_created_at_idx" ON "reviews" USING btree ("created_at");