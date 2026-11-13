CREATE TYPE "public"."finding_event_action" AS ENUM('confirmed', 'rejected', 'reset', 'edited', 'added', 'removed');--> statement-breakpoint
CREATE TABLE "finding_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" integer NOT NULL,
	"finding_id" integer NOT NULL,
	"actor" text NOT NULL,
	"action" "finding_event_action" NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finding_events" ADD CONSTRAINT "finding_events_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_events_review_idx" ON "finding_events" USING btree ("review_id","created_at");