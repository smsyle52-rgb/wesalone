-- Cloud SQL PostgreSQL compatibility for the isolated Wesal One deployment.
-- Cloud SQL does not provide TimescaleDB, so keep the application contract with
-- ordinary PostgreSQL tables, a compatible time_bucket function, and live views.

DO $$ BEGIN
  CREATE TYPE "analyticsBotResponseType" AS ENUM ('automated_response', 'ai_agent', 'flow', 'none');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "analyticsBotResult" AS ENUM ('success', 'fallback');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "analyticsBotRouteType" AS ENUM ('flow', 'agent', 'fallback');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "analyticsContactEventType" AS ENUM ('contact_created', 'contact_deleted', 'contact_blocked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "analyticsMessageEventType" AS ENUM ('message_human_sent', 'message_bot_sent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "analyticsContactSenderType" AS ENUM ('bot', 'human');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "analyticsConversationEventType" AS ENUM (
    'conversation_created',
    'conversation_assigned',
    'conversation_unassigned',
    'conversation_transferred_to_human',
    'conversation_transferred_to_bot',
    'conversation_followed',
    'conversation_unfollowed',
    'conversation_archived',
    'conversation_unarchived'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "AnalyticsBotMessageEvent" (
  "eventId" text NOT NULL,
  "workspaceId" bigint NOT NULL,
  "messageId" bigint NOT NULL,
  "conversationId" bigint NOT NULL,
  "occurredAt" timestamp(6) with time zone NOT NULL,
  "hasResponse" boolean DEFAULT false NOT NULL,
  "responseType" "analyticsBotResponseType",
  "routeType" "analyticsBotRouteType",
  "result" "analyticsBotResult",
  "aiProvider" text,
  "channel" text,
  "source" text,
  "metadata" jsonb,
  "insertedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "AnalyticsBotMessageEvent_pkey" PRIMARY KEY ("occurredAt", "eventId"),
  CONSTRAINT "AnalyticsBotMessageEvent_workspaceId_Workspace_id_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "AnalyticsContactEvent" (
  "eventId" text NOT NULL,
  "workspaceId" bigint NOT NULL,
  "contactId" bigint NOT NULL,
  "eventType" "analyticsContactEventType" NOT NULL,
  "occurredAt" timestamp(6) with time zone NOT NULL,
  "source" text,
  "sourceId" text,
  "channel" text,
  "country" text,
  "senderType" "analyticsContactSenderType",
  "adminId" bigint,
  "metadata" jsonb,
  "insertedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "AnalyticsContactEvent_pkey" PRIMARY KEY ("occurredAt", "eventId"),
  CONSTRAINT "AnalyticsContactEvent_workspaceId_Workspace_id_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "AnalyticsConversationEvent" (
  "eventId" text NOT NULL,
  "workspaceId" bigint NOT NULL,
  "conversationId" bigint NOT NULL,
  "eventType" "analyticsConversationEventType" NOT NULL,
  "occurredAt" timestamp(6) with time zone NOT NULL,
  "fromAssignee" bigint,
  "toAssignee" bigint,
  "channel" text,
  "metadata" jsonb,
  "insertedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "AnalyticsConversationEvent_pkey" PRIMARY KEY ("occurredAt", "eventId"),
  CONSTRAINT "AnalyticsConversationEvent_workspaceId_Workspace_id_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "AnalyticsMessageEvent" (
  "eventId" text NOT NULL,
  "workspaceId" bigint NOT NULL,
  "contactId" bigint NOT NULL,
  "eventType" "analyticsMessageEventType" NOT NULL,
  "occurredAt" timestamp(6) with time zone NOT NULL,
  "senderType" "analyticsContactSenderType",
  "adminId" bigint,
  "channel" text,
  "source" text,
  "sourceId" text,
  "metadata" jsonb,
  "insertedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "AnalyticsMessageEvent_pkey" PRIMARY KEY ("occurredAt", "eventId"),
  CONSTRAINT "AnalyticsMessageEvent_workspaceId_Workspace_id_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "AnalyticsBotMessageEvent_workspaceId_occurredAt_idx"
  ON "AnalyticsBotMessageEvent" ("workspaceId", "occurredAt");
CREATE INDEX IF NOT EXISTS "AnalyticsBotMessageEvent_workspaceId_aiProvider_occurredAt_idx"
  ON "AnalyticsBotMessageEvent" ("workspaceId", "aiProvider", "occurredAt");
CREATE INDEX IF NOT EXISTS "AnalyticsBotMessageEvent_workspaceId_hasResponse_result_occurredAt_idx"
  ON "AnalyticsBotMessageEvent" ("workspaceId", "hasResponse", "result", "occurredAt");
CREATE INDEX IF NOT EXISTS "AnalyticsContactEvent_workspaceId_occurredAt_eventType_idx"
  ON "AnalyticsContactEvent" ("workspaceId", "occurredAt", "eventType");
CREATE INDEX IF NOT EXISTS "AnalyticsContactEvent_workspaceId_eventType_occurredAt_idx"
  ON "AnalyticsContactEvent" ("workspaceId", "eventType", "occurredAt");
CREATE INDEX IF NOT EXISTS "AnalyticsContactEvent_workspaceId_adminId_occurredAt_idx"
  ON "AnalyticsContactEvent" ("workspaceId", "adminId", "occurredAt");
CREATE INDEX IF NOT EXISTS "AnalyticsContactEvent_workspaceId_eventType_occurredAt_covering_idx"
  ON "AnalyticsContactEvent" ("workspaceId", "eventType", "occurredAt" DESC)
  INCLUDE ("contactId", "channel", "country", "source");
CREATE INDEX IF NOT EXISTS "AnalyticsConversationEvent_workspaceId_occurredAt_eventType_idx"
  ON "AnalyticsConversationEvent" ("workspaceId", "occurredAt", "eventType");
CREATE INDEX IF NOT EXISTS "AnalyticsConversationEvent_workspaceId_toAssignee_occurredAt_idx"
  ON "AnalyticsConversationEvent" ("workspaceId", "toAssignee", "occurredAt");
CREATE INDEX IF NOT EXISTS "AnalyticsMessageEvent_workspaceId_occurredAt_eventType_idx"
  ON "AnalyticsMessageEvent" ("workspaceId", "occurredAt", "eventType");
CREATE INDEX IF NOT EXISTS "AnalyticsMessageEvent_workspaceId_eventType_occurredAt_idx"
  ON "AnalyticsMessageEvent" ("workspaceId", "eventType", "occurredAt");
CREATE INDEX IF NOT EXISTS "AnalyticsMessageEvent_workspaceId_adminId_occurredAt_idx"
  ON "AnalyticsMessageEvent" ("workspaceId", "adminId", "occurredAt");
CREATE INDEX IF NOT EXISTS "AnalyticsMessageEvent_workspaceId_senderType_occurredAt_idx"
  ON "AnalyticsMessageEvent" ("workspaceId", "senderType", "occurredAt");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.time_bucket(
  bucket_width interval,
  source_time timestamp with time zone
)
RETURNS timestamp with time zone
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN bucket_width = INTERVAL '1 month' THEN date_trunc('month', source_time)
    ELSE date_bin(bucket_width, source_time, TIMESTAMPTZ '1970-01-01 00:00:00+00')
  END
$$;
--> statement-breakpoint

CREATE OR REPLACE VIEW analytics_contact_events_hourly AS
SELECT
  time_bucket(INTERVAL '1 hour', "occurredAt") AS bucket,
  "workspaceId", "eventType", "channel", "senderType", "country", "source", "adminId",
  COUNT(*) AS count
FROM "AnalyticsContactEvent"
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8;
--> statement-breakpoint
CREATE OR REPLACE VIEW analytics_bot_message_events_hourly AS
SELECT
  time_bucket(INTERVAL '1 hour', "occurredAt") AS bucket,
  "workspaceId", "hasResponse", "responseType", "routeType", "result", "aiProvider",
  COUNT(*) AS count
FROM "AnalyticsBotMessageEvent"
GROUP BY 1, 2, 3, 4, 5, 6, 7;
--> statement-breakpoint
CREATE OR REPLACE VIEW analytics_conversation_events_hourly AS
SELECT
  time_bucket(INTERVAL '1 hour', "occurredAt") AS bucket,
  "workspaceId", "eventType", "toAssignee",
  COUNT(*) AS count
FROM "AnalyticsConversationEvent"
GROUP BY 1, 2, 3, 4;
--> statement-breakpoint
CREATE OR REPLACE VIEW analytics_message_events_hourly AS
SELECT
  time_bucket(INTERVAL '1 hour', "occurredAt") AS bucket,
  "workspaceId", "eventType", "channel", "senderType", "adminId",
  COUNT(*) AS count
FROM "AnalyticsMessageEvent"
GROUP BY 1, 2, 3, 4, 5, 6;
--> statement-breakpoint

ALTER TABLE "Attachment"
  ADD COLUMN IF NOT EXISTS "messageCreatedAt" timestamp(6) with time zone;
--> statement-breakpoint
UPDATE "Attachment" AS attachment
SET "messageCreatedAt" = (
  SELECT message."createdAt"
  FROM "Message" AS message
  WHERE message."id" = attachment."messageId"
  ORDER BY ABS(EXTRACT(EPOCH FROM (message."createdAt" - attachment."createdAt")))
  LIMIT 1
)
WHERE attachment."messageCreatedAt" IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Attachment" WHERE "messageCreatedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot backfill Attachment.messageCreatedAt: orphan attachment rows exist';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "Attachment"
  ALTER COLUMN "messageCreatedAt" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Attachment_message_idx"
  ON "Attachment" ("messageId", "messageCreatedAt" DESC);
