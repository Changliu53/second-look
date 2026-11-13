CREATE TYPE "public"."review_resolution" AS ENUM('author_fixes', 'reviewer_takes_over');--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "follow_up" jsonb;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "resolution" "review_resolution";