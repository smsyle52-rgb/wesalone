CREATE TYPE "pointGrantStatus" AS ENUM('active', 'exhausted', 'expired', 'frozen', 'reversed');--> statement-breakpoint
CREATE TYPE "pointGrantType" AS ENUM('monthly_subscription', 'purchased', 'admin_adjustment', 'refund', 'promotional');--> statement-breakpoint
CREATE TYPE "pointLedgerTransactionType" AS ENUM('credit', 'debit', 'expiration', 'reversal', 'refund', 'admin_adjustment');--> statement-breakpoint
CREATE TYPE "pointWalletStatus" AS ENUM('active', 'frozen', 'suspended');--> statement-breakpoint
CREATE TABLE "PointGrant" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"walletId" bigint NOT NULL,
	"grantType" "pointGrantType" NOT NULL,
	"originalMicroPoints" bigint NOT NULL,
	"remainingMicroPoints" bigint NOT NULL,
	"startsAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp(6) with time zone,
	"status" "pointGrantStatus" DEFAULT 'active'::"pointGrantStatus" NOT NULL,
	"sourceType" text,
	"sourceId" text,
	"idempotencyKey" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'
);
--> statement-breakpoint
CREATE TABLE "PointLedger" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"walletId" bigint NOT NULL,
	"grantId" bigint,
	"transactionType" "pointLedgerTransactionType" NOT NULL,
	"microPoints" bigint NOT NULL,
	"sourceType" text,
	"sourceId" text,
	"idempotencyKey" text NOT NULL,
	"reason" text,
	"actorType" text,
	"actorId" text,
	"metadata" jsonb DEFAULT '{}'
);
--> statement-breakpoint
CREATE TABLE "PointWallet" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"userId" bigint NOT NULL,
	"status" "pointWalletStatus" DEFAULT 'active'::"pointWalletStatus" NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "PointGrant_idempotencyKey_key" ON "PointGrant" ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "PointGrant_walletId_status_idx" ON "PointGrant" ("walletId","status");--> statement-breakpoint
CREATE INDEX "PointGrant_walletId_expiresAt_idx" ON "PointGrant" ("walletId","expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "PointLedger_idempotencyKey_key" ON "PointLedger" ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "PointLedger_walletId_createdAt_idx" ON "PointLedger" ("walletId","createdAt");--> statement-breakpoint
CREATE INDEX "PointLedger_grantId_idx" ON "PointLedger" ("grantId");--> statement-breakpoint
CREATE UNIQUE INDEX "PointWallet_userId_key" ON "PointWallet" ("userId");--> statement-breakpoint
ALTER TABLE "PointGrant" ADD CONSTRAINT "PointGrant_walletId_PointWallet_id_fkey" FOREIGN KEY ("walletId") REFERENCES "PointWallet"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "PointLedger" ADD CONSTRAINT "PointLedger_walletId_PointWallet_id_fkey" FOREIGN KEY ("walletId") REFERENCES "PointWallet"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "PointLedger" ADD CONSTRAINT "PointLedger_grantId_PointGrant_id_fkey" FOREIGN KEY ("grantId") REFERENCES "PointGrant"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "PointWallet" ADD CONSTRAINT "PointWallet_userId_User_id_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;