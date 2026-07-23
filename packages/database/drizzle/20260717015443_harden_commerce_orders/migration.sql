ALTER TYPE "orderStatus" ADD VALUE 'payment_review' BEFORE 'cancelled';--> statement-breakpoint
ALTER TYPE "orderStatus" ADD VALUE 'refunded' BEFORE 'cancelled';--> statement-breakpoint
ALTER TABLE "Order" ALTER COLUMN "subtotal" SET DATA TYPE numeric(20,2) USING "subtotal"::numeric(20,2);--> statement-breakpoint
ALTER TABLE "Order" ALTER COLUMN "subtotal" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "Order" ALTER COLUMN "taxTotal" SET DATA TYPE numeric(20,2) USING "taxTotal"::numeric(20,2);--> statement-breakpoint
ALTER TABLE "Order" ALTER COLUMN "taxTotal" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "Order" ALTER COLUMN "discountTotal" SET DATA TYPE numeric(20,2) USING "discountTotal"::numeric(20,2);--> statement-breakpoint
ALTER TABLE "Order" ALTER COLUMN "discountTotal" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "Order" ALTER COLUMN "total" SET DATA TYPE numeric(20,2) USING "total"::numeric(20,2);--> statement-breakpoint
ALTER TABLE "Order" ALTER COLUMN "total" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "OrderItem" ALTER COLUMN "unitPrice" SET DATA TYPE numeric(20,2) USING "unitPrice"::numeric(20,2);--> statement-breakpoint
ALTER TABLE "OrderItem" ALTER COLUMN "unitTax" SET DATA TYPE numeric(20,2) USING "unitTax"::numeric(20,2);--> statement-breakpoint
ALTER TABLE "OrderItem" ALTER COLUMN "unitTax" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "OrderItem" ALTER COLUMN "lineTotal" SET DATA TYPE numeric(20,2) USING "lineTotal"::numeric(20,2);--> statement-breakpoint
ALTER TABLE "Payment" ALTER COLUMN "amount" SET DATA TYPE numeric(20,2) USING "amount"::numeric(20,2);--> statement-breakpoint
CREATE UNIQUE INDEX "Payment_provider_checkoutReference_key" ON "Payment" ("provider","checkoutReference") WHERE "checkoutReference" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_quantity_nonzero" CHECK ("quantity" <> 0);--> statement-breakpoint
ALTER TABLE "InventoryStock" ADD CONSTRAINT "InventoryStock_onHand_nonnegative" CHECK ("onHand" >= 0);--> statement-breakpoint
ALTER TABLE "InventoryStock" ADD CONSTRAINT "InventoryStock_reserved_nonnegative" CHECK ("reserved" >= 0);--> statement-breakpoint
ALTER TABLE "InventoryStock" ADD CONSTRAINT "InventoryStock_reserved_not_over_onHand" CHECK ("reserved" <= "onHand");--> statement-breakpoint
ALTER TABLE "Order" ADD CONSTRAINT "Order_subtotal_nonnegative" CHECK ("subtotal" >= 0);--> statement-breakpoint
ALTER TABLE "Order" ADD CONSTRAINT "Order_taxTotal_nonnegative" CHECK ("taxTotal" >= 0);--> statement-breakpoint
ALTER TABLE "Order" ADD CONSTRAINT "Order_discountTotal_nonnegative" CHECK ("discountTotal" >= 0);--> statement-breakpoint
ALTER TABLE "Order" ADD CONSTRAINT "Order_total_nonnegative" CHECK ("total" >= 0);--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0);--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_unitPrice_nonnegative" CHECK ("unitPrice" >= 0);--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_unitTax_nonnegative" CHECK ("unitTax" >= 0);--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_lineTotal_nonnegative" CHECK ("lineTotal" >= 0);--> statement-breakpoint
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);