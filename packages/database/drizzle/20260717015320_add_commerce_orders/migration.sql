CREATE TYPE "inventoryMovementReason" AS ENUM('reserve', 'release', 'consume', 'receive', 'adjustment');--> statement-breakpoint
CREATE TYPE "orderStatus" AS ENUM('draft', 'pending_payment', 'paid', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "paymentStatus" AS ENUM('pending', 'paid', 'failed', 'refunded');--> statement-breakpoint
CREATE TABLE "InventoryLocation" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"workspaceId" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "InventoryMovement" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"locationId" bigint NOT NULL,
	"productId" bigint NOT NULL,
	"productVariantId" bigint,
	"quantity" integer NOT NULL,
	"reason" "inventoryMovementReason" NOT NULL,
	"referenceType" text,
	"referenceId" bigint,
	"workspaceId" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "InventoryStock" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"locationId" bigint NOT NULL,
	"productId" bigint NOT NULL,
	"productVariantId" bigint,
	"onHand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"workspaceId" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Order" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"status" "orderStatus" DEFAULT 'draft'::"orderStatus" NOT NULL,
	"contactId" bigint,
	"currency" text DEFAULT 'USD' NOT NULL,
	"subtotal" double precision DEFAULT 0 NOT NULL,
	"taxTotal" double precision DEFAULT 0 NOT NULL,
	"discountTotal" double precision DEFAULT 0 NOT NULL,
	"total" double precision DEFAULT 0 NOT NULL,
	"idempotencyKey" text,
	"checkoutIdempotencyKey" text,
	"expiresAt" timestamp(6) with time zone,
	"workspaceId" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "OrderItem" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"orderId" bigint NOT NULL,
	"productId" bigint NOT NULL,
	"productVariantId" bigint,
	"locationId" bigint,
	"quantity" integer NOT NULL,
	"unitPrice" double precision NOT NULL,
	"unitTax" double precision DEFAULT 0 NOT NULL,
	"lineTotal" double precision NOT NULL,
	"reservedAt" timestamp(6) with time zone,
	"reservationReleasedAt" timestamp(6) with time zone,
	"workspaceId" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Payment" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"orderId" bigint NOT NULL,
	"provider" text NOT NULL,
	"status" "paymentStatus" DEFAULT 'pending'::"paymentStatus" NOT NULL,
	"amount" double precision NOT NULL,
	"currency" text NOT NULL,
	"checkoutReference" text,
	"providerPaymentReference" text,
	"idempotencyKey" text NOT NULL,
	"confirmedAt" timestamp(6) with time zone,
	"failureReason" text,
	"workspaceId" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PaymentWebhookEvent" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"providerEventId" text NOT NULL,
	"paymentId" bigint,
	"receivedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"payloadSummary" jsonb,
	"workspaceId" bigint
);
--> statement-breakpoint
CREATE INDEX "InventoryLocation_workspaceId_idx" ON "InventoryLocation" ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "InventoryLocation_workspaceId_default_key" ON "InventoryLocation" ("workspaceId") WHERE "isDefault" = true;--> statement-breakpoint
CREATE INDEX "InventoryMovement_workspaceId_idx" ON "InventoryMovement" ("workspaceId");--> statement-breakpoint
CREATE INDEX "InventoryMovement_reference_idx" ON "InventoryMovement" ("referenceType","referenceId");--> statement-breakpoint
CREATE UNIQUE INDEX "InventoryStock_location_variant_key" ON "InventoryStock" ("locationId","productVariantId") WHERE "productVariantId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "InventoryStock_location_product_novariant_key" ON "InventoryStock" ("locationId","productId") WHERE "productVariantId" IS NULL;--> statement-breakpoint
CREATE INDEX "InventoryStock_workspaceId_idx" ON "InventoryStock" ("workspaceId");--> statement-breakpoint
CREATE INDEX "InventoryStock_productId_idx" ON "InventoryStock" ("productId");--> statement-breakpoint
CREATE INDEX "Order_workspaceId_idx" ON "Order" ("workspaceId");--> statement-breakpoint
CREATE INDEX "Order_workspaceId_status_idx" ON "Order" ("workspaceId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "Order_workspaceId_idempotencyKey_key" ON "Order" ("workspaceId","idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "Order_workspaceId_checkoutIdempotencyKey_key" ON "Order" ("workspaceId","checkoutIdempotencyKey") WHERE "checkoutIdempotencyKey" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem" ("orderId");--> statement-breakpoint
CREATE INDEX "OrderItem_workspaceId_idx" ON "OrderItem" ("workspaceId");--> statement-breakpoint
CREATE INDEX "Payment_orderId_idx" ON "Payment" ("orderId");--> statement-breakpoint
CREATE INDEX "Payment_workspaceId_idx" ON "Payment" ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "Payment_workspaceId_idempotencyKey_key" ON "Payment" ("workspaceId","idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX "Payment_provider_providerPaymentReference_key" ON "Payment" ("provider","providerPaymentReference") WHERE "providerPaymentReference" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_eventId_key" ON "PaymentWebhookEvent" ("provider","providerEventId");--> statement-breakpoint
CREATE INDEX "PaymentWebhookEvent_paymentId_idx" ON "PaymentWebhookEvent" ("paymentId");--> statement-breakpoint
ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_locationId_InventoryLocation_id_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_productId_Product_id_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_productVariantId_ProductVariant_id_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "InventoryStock" ADD CONSTRAINT "InventoryStock_locationId_InventoryLocation_id_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "InventoryStock" ADD CONSTRAINT "InventoryStock_productId_Product_id_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "InventoryStock" ADD CONSTRAINT "InventoryStock_productVariantId_ProductVariant_id_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "InventoryStock" ADD CONSTRAINT "InventoryStock_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "Order" ADD CONSTRAINT "Order_contactId_Contact_id_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "Order" ADD CONSTRAINT "Order_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_Order_id_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_Product_id_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productVariantId_ProductVariant_id_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_locationId_InventoryLocation_id_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_Order_id_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "PaymentWebhookEvent" ADD CONSTRAINT "PaymentWebhookEvent_paymentId_Payment_id_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "PaymentWebhookEvent" ADD CONSTRAINT "PaymentWebhookEvent_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;