CREATE TYPE "pointPurchaseOrderPaymentMethod" AS ENUM('kuraimi', 'jawali', 'bank_transfer', 'cash');--> statement-breakpoint
CREATE TYPE "pointPurchaseOrderStatus" AS ENUM('pending_payment', 'under_review', 'approved', 'rejected', 'expired', 'cancelled', 'refunded', 'chargeback');--> statement-breakpoint
CREATE TABLE "PointPurchaseOrder" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"userId" bigint NOT NULL,
	"topupProductId" bigint NOT NULL,
	"productSlugSnapshot" text NOT NULL,
	"productNameSnapshot" text NOT NULL,
	"pointsSnapshot" integer NOT NULL,
	"priceCentsSnapshot" integer NOT NULL,
	"currencySnapshot" text DEFAULT 'USD' NOT NULL,
	"status" "pointPurchaseOrderStatus" DEFAULT 'pending_payment'::"pointPurchaseOrderStatus" NOT NULL,
	"paymentMethod" "pointPurchaseOrderPaymentMethod",
	"reference" text,
	"receiptFileId" bigint,
	"receiptNote" text,
	"reviewedBy" bigint,
	"reviewedAt" timestamp(6) with time zone,
	"rejectionReason" text,
	"creditedGrantId" bigint
);
--> statement-breakpoint
CREATE TABLE "PointTopupProduct" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"slug" text NOT NULL,
	"nameAr" text NOT NULL,
	"nameEn" text NOT NULL,
	"descriptionAr" text,
	"descriptionEn" text,
	"points" integer NOT NULL,
	"priceCents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 100 NOT NULL,
	"allowedPlanSlugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"effectiveFrom" timestamp(6) with time zone,
	"effectiveUntil" timestamp(6) with time zone
);
--> statement-breakpoint
CREATE INDEX "PointPurchaseOrder_userId_status_idx" ON "PointPurchaseOrder" ("userId","status");--> statement-breakpoint
CREATE INDEX "PointPurchaseOrder_status_createdAt_idx" ON "PointPurchaseOrder" ("status","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "PointTopupProduct_slug_key" ON "PointTopupProduct" ("slug");--> statement-breakpoint
ALTER TABLE "PointPurchaseOrder" ADD CONSTRAINT "PointPurchaseOrder_userId_User_id_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "PointPurchaseOrder" ADD CONSTRAINT "PointPurchaseOrder_topupProductId_PointTopupProduct_id_fkey" FOREIGN KEY ("topupProductId") REFERENCES "PointTopupProduct"("id");--> statement-breakpoint
ALTER TABLE "PointPurchaseOrder" ADD CONSTRAINT "PointPurchaseOrder_receiptFileId_File_id_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "File"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "PointPurchaseOrder" ADD CONSTRAINT "PointPurchaseOrder_reviewedBy_User_id_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "PointPurchaseOrder" ADD CONSTRAINT "PointPurchaseOrder_creditedGrantId_PointGrant_id_fkey" FOREIGN KEY ("creditedGrantId") REFERENCES "PointGrant"("id") ON DELETE SET NULL;