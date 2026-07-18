CREATE TYPE "platformSubscriptionPaymentStatus" AS ENUM('under_review', 'confirmed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "PlatformSubscriptionPayment" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"workspaceId" bigint NOT NULL,
	"planSlug" text NOT NULL,
	"billingCycle" text NOT NULL,
	"paymentMethod" text NOT NULL,
	"reference" text,
	"receiptFileId" bigint,
	"receiptNote" text,
	"status" "platformSubscriptionPaymentStatus" DEFAULT 'under_review'::"platformSubscriptionPaymentStatus" NOT NULL,
	"reviewedBy" bigint,
	"reviewedAt" timestamp(6) with time zone,
	"rejectionReason" text
);
--> statement-breakpoint
CREATE INDEX "PlatformSubscriptionPayment_workspaceId_idx" ON "PlatformSubscriptionPayment" ("workspaceId");--> statement-breakpoint
CREATE INDEX "PlatformSubscriptionPayment_workspaceId_status_idx" ON "PlatformSubscriptionPayment" ("workspaceId","status");--> statement-breakpoint
ALTER TABLE "PlatformSubscriptionPayment" ADD CONSTRAINT "PlatformSubscriptionPayment_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "PlatformSubscriptionPayment" ADD CONSTRAINT "PlatformSubscriptionPayment_receiptFileId_File_id_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "File"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "PlatformSubscriptionPayment" ADD CONSTRAINT "PlatformSubscriptionPayment_reviewedBy_User_id_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL;