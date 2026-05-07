-- Phase 7C: Schema Debt — safe type migrations
-- Reviewed: no destructive operations, no data deletion, no DROP statements.
--
-- is_archived: text → boolean
--   Safe because: all existing values are 'true' or 'false' only (verified 2026-05-02).
--   Must DROP DEFAULT first (PostgreSQL cannot auto-cast text default to boolean).
--   USING clause converts 'true' → true, anything else → false.
--
-- team_id (tickets + conversations): text → uuid + FK to teams(id)
--   Safe because: tickets table is empty (0 rows); conversations.team_id is all NULL (2 rows).
--
-- Rollback SQL (apply before this migration if needed):
--   ALTER TABLE "report_definitions" ALTER COLUMN "is_archived" DROP DEFAULT;
--   ALTER TABLE "report_definitions" ALTER COLUMN "is_archived" SET DATA TYPE text USING (is_archived::text);
--   ALTER TABLE "report_definitions" ALTER COLUMN "is_archived" SET DEFAULT 'false';
--   ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_team_id_teams_id_fk";
--   ALTER TABLE "conversations" ALTER COLUMN "team_id" SET DATA TYPE text;
--   ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_team_id_teams_id_fk";
--   ALTER TABLE "tickets" ALTER COLUMN "team_id" SET DATA TYPE text;

ALTER TABLE "report_definitions" ALTER COLUMN "is_archived" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "report_definitions" ALTER COLUMN "is_archived" SET DATA TYPE boolean USING (is_archived = 'true');--> statement-breakpoint
ALTER TABLE "report_definitions" ALTER COLUMN "is_archived" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "team_id" SET DATA TYPE uuid USING (team_id::uuid);--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "team_id" SET DATA TYPE uuid USING (team_id::uuid);--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
