-- A short, per-merchant order number the customer can actually repeat back.
--
-- `Order.id` is a 17-digit snowflake, and the two places it surfaced disagreed:
-- the agent read the whole id out loud ("سجّلت طلبك رقم 11686817378942976")
-- while the merchant's list rendered `id.slice(-8)` — so the number a customer
-- quoted never matched the number the merchant could find. One counter fixes
-- both.
--
-- Per workspace, not global: a merchant's first order should read 5000, not
-- whatever the platform-wide count happens to be. Starting at 5000 rather than
-- 1 is the merchant's own request — a business that opens on #1 looks new.
ALTER TABLE "Order" ADD COLUMN "orderNumber" integer;--> statement-breakpoint

-- Backfill in id order so existing orders keep their real chronology.
UPDATE "Order" o
   SET "orderNumber" = n.num
  FROM (
    SELECT id,
           4999 + row_number() OVER (PARTITION BY "workspaceId" ORDER BY id) AS num
      FROM "Order"
  ) n
 WHERE o.id = n.id;--> statement-breakpoint

-- Unique per workspace. NULLs stay distinct in Postgres, so a row that somehow
-- misses a number never blocks the others.
CREATE UNIQUE INDEX "Order_workspaceId_orderNumber_key" ON "Order" ("workspaceId","orderNumber");
