CREATE TYPE "billableUsageCategory" AS ENUM('language', 'image_analysis', 'image_generation', 'image_editing', 'transcription', 'speech', 'embedding_document', 'embedding_query', 'knowledge_search', 'summarization', 'web_search', 'tool');--> statement-breakpoint
CREATE TYPE "billableUsageStatus" AS ENUM('reserved', 'settled', 'released', 'settlement_pending');--> statement-breakpoint
CREATE TYPE "platformSubscriptionBillingCycle" AS ENUM('monthly', 'annual');--> statement-breakpoint
CREATE TYPE "platformSubscriptionSource" AS ENUM('free', 'manual', 'gateway', 'admin');--> statement-breakpoint
CREATE TYPE "platformSubscriptionStatus" AS ENUM('active', 'past_due', 'cancel_at_period_end', 'cancelled', 'expired');--> statement-breakpoint

CREATE TABLE "PlatformSubscription" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"userId" bigint NOT NULL,
	"workspaceId" bigint,
	"planSlug" text NOT NULL,
	"billingCycle" "platformSubscriptionBillingCycle" NOT NULL,
	"status" "platformSubscriptionStatus" DEFAULT 'active'::"platformSubscriptionStatus" NOT NULL,
	"source" "platformSubscriptionSource" NOT NULL,
	"periodStart" timestamp(6) with time zone NOT NULL,
	"periodEnd" timestamp(6) with time zone NOT NULL,
	"nextGrantAt" timestamp(6) with time zone NOT NULL,
	"cancelAtPeriodEnd" boolean DEFAULT false NOT NULL,
	"priceCents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"priceVersion" text NOT NULL
);--> statement-breakpoint

CREATE TABLE "BillableUsageEvent" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"userId" bigint NOT NULL,
	"workspaceId" bigint NOT NULL,
	"walletId" bigint NOT NULL,
	"operationId" text NOT NULL,
	"category" "billableUsageCategory" NOT NULL,
	"status" "billableUsageStatus" DEFAULT 'reserved'::"billableUsageStatus" NOT NULL,
	"provider" text,
	"model" text,
	"rateVersion" text NOT NULL,
	"reservedMicroPoints" bigint NOT NULL,
	"settledMicroPoints" bigint,
	"actualCostMicroUsd" bigint,
	"inputUnits" bigint,
	"outputUnits" bigint,
	"cachedInputUnits" bigint,
	"reasoningUnits" bigint,
	"usage" jsonb DEFAULT '{}',
	"metadata" jsonb DEFAULT '{}',
	"settledAt" timestamp(6) with time zone,
	"releasedAt" timestamp(6) with time zone,
	"error" text
);--> statement-breakpoint

ALTER TABLE "UserQuota" ADD COLUMN "agentsLimit" integer;--> statement-breakpoint
ALTER TABLE "UserQuota" ADD COLUMN "knowledgeDocumentsLimit" integer;--> statement-breakpoint
ALTER TABLE "UserQuota" ADD COLUMN "productsLimit" integer;--> statement-breakpoint
ALTER TABLE "UserQuota" ADD COLUMN "autoReplyEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint

ALTER TABLE "PlatformSubscriptionPayment" ADD COLUMN "priceCentsSnapshot" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "PlatformSubscriptionPayment" ADD COLUMN "currencySnapshot" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "PlatformSubscriptionPayment" ADD COLUMN "priceVersion" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "PlatformSubscriptionPayment" ADD COLUMN "subscriptionId" bigint;--> statement-breakpoint

UPDATE "PlatformSubscriptionPayment"
SET "priceCentsSnapshot" = CASE
	WHEN "planSlug" = 'starter' AND "billingCycle" = 'annual' THEN 18200
	WHEN "planSlug" = 'starter' THEN 1900
	WHEN "planSlug" = 'growth' AND "billingCycle" = 'annual' THEN 47000
	WHEN "planSlug" = 'growth' THEN 4900
	WHEN "planSlug" = 'professional' AND "billingCycle" = 'annual' THEN 134400
	WHEN "planSlug" = 'professional' THEN 14000
	ELSE 0
END,
"priceVersion" = 'legacy-backfill-2026-07-27';--> statement-breakpoint

WITH ranked AS (
	SELECT "id", row_number() OVER (PARTITION BY "workspaceId" ORDER BY "createdAt" DESC, "id" DESC) AS rn
	FROM "PlatformSubscriptionPayment"
	WHERE "status" = 'under_review'
)
UPDATE "PlatformSubscriptionPayment" p
SET "status" = 'cancelled', "updatedAt" = now()
FROM ranked r
WHERE p."id" = r."id" AND r.rn > 1;--> statement-breakpoint

ALTER TABLE "PointGrant" ADD CONSTRAINT "PointGrant_originalMicroPoints_nonnegative" CHECK ("originalMicroPoints" >= 0);--> statement-breakpoint
ALTER TABLE "PointGrant" ADD CONSTRAINT "PointGrant_remainingMicroPoints_nonnegative" CHECK ("remainingMicroPoints" >= 0);--> statement-breakpoint
ALTER TABLE "PointGrant" ADD CONSTRAINT "PointGrant_remaining_not_above_original" CHECK ("remainingMicroPoints" <= "originalMicroPoints");--> statement-breakpoint

CREATE UNIQUE INDEX "PlatformSubscription_userId_key" ON "PlatformSubscription" ("userId");--> statement-breakpoint
CREATE INDEX "PlatformSubscription_status_nextGrantAt_idx" ON "PlatformSubscription" ("status", "nextGrantAt");--> statement-breakpoint
CREATE INDEX "PlatformSubscription_periodEnd_idx" ON "PlatformSubscription" ("periodEnd");--> statement-breakpoint
CREATE UNIQUE INDEX "BillableUsageEvent_operationId_key" ON "BillableUsageEvent" ("operationId");--> statement-breakpoint
CREATE INDEX "BillableUsageEvent_workspaceId_createdAt_idx" ON "BillableUsageEvent" ("workspaceId", "createdAt");--> statement-breakpoint
CREATE INDEX "BillableUsageEvent_walletId_status_idx" ON "BillableUsageEvent" ("walletId", "status");--> statement-breakpoint
CREATE INDEX "BillableUsageEvent_status_createdAt_idx" ON "BillableUsageEvent" ("status", "createdAt");--> statement-breakpoint
CREATE INDEX "PlatformSubscriptionPayment_subscriptionId_idx" ON "PlatformSubscriptionPayment" ("subscriptionId");--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformSubscriptionPayment_one_under_review_key" ON "PlatformSubscriptionPayment" ("workspaceId") WHERE "status" = 'under_review';--> statement-breakpoint

ALTER TABLE "PlatformSubscription" ADD CONSTRAINT "PlatformSubscription_userId_User_id_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "PlatformSubscription" ADD CONSTRAINT "PlatformSubscription_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "BillableUsageEvent" ADD CONSTRAINT "BillableUsageEvent_userId_User_id_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "BillableUsageEvent" ADD CONSTRAINT "BillableUsageEvent_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "BillableUsageEvent" ADD CONSTRAINT "BillableUsageEvent_walletId_PointWallet_id_fkey" FOREIGN KEY ("walletId") REFERENCES "PointWallet"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "PlatformSubscriptionPayment" ADD CONSTRAINT "PlatformSubscriptionPayment_subscriptionId_PlatformSubscription_id_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PlatformSubscription"("id") ON DELETE SET NULL;
