-- MANUAL ROLLBACK ONLY. Take a database backup and stop writes before running.
-- This preserves legacy products/orders/payments and restores aggregate on-hand quantity.
BEGIN;

UPDATE inventory_products p
SET quantity_available = totals.on_hand,
    updated_at = now()
FROM (
  SELECT v.workspace_id, v.product_id, COALESCE(SUM(l.on_hand), 0)::integer AS on_hand
  FROM product_variants v
  LEFT JOIN inventory_stock_levels l
    ON l.workspace_id = v.workspace_id AND l.product_variant_id = v.id
  GROUP BY v.workspace_id, v.product_id
) totals
WHERE p.workspace_id = totals.workspace_id AND p.id = totals.product_id;

UPDATE orders SET status = CASE status
  WHEN 'Draft' THEN 'new'
  WHEN 'AwaitingConfirmation' THEN 'new'
  WHEN 'Confirmed' THEN 'confirmed'
  WHEN 'Reserved' THEN 'confirmed'
  WHEN 'Preparing' THEN 'processing'
  WHEN 'Ready' THEN 'ready'
  WHEN 'Shipped' THEN 'ready'
  WHEN 'Delivered' THEN 'delivered'
  WHEN 'Cancelled' THEN 'cancelled'
  WHEN 'Returned' THEN 'returned'
  WHEN 'Exchanged' THEN 'returned'
  ELSE status
END;

UPDATE orders SET payment_status = CASE payment_status
  WHEN 'Unpaid' THEN 'unpaid'
  WHEN 'Pending' THEN 'unpaid'
  WHEN 'PartiallyPaid' THEN 'partial'
  WHEN 'Paid' THEN 'paid'
  WHEN 'PartiallyRefunded' THEN 'partial'
  WHEN 'Refunded' THEN 'refunded'
  ELSE payment_status
END;

UPDATE payments SET status = CASE status
  WHEN 'Pending' THEN 'pending'
  WHEN 'Paid' THEN 'confirmed'
  WHEN 'Failed' THEN 'rejected'
  WHEN 'Cancelled' THEN 'cancelled'
  WHEN 'PartiallyRefunded' THEN 'confirmed'
  WHEN 'Refunded' THEN 'confirmed'
  ELSE status
END;

-- The following DROP statements intentionally come last. Do not run this rollback
-- if downstream integrations already depend on commerce movement/reservation IDs.
DROP TRIGGER IF EXISTS inventory_movements_immutable ON inventory_movements;
DROP FUNCTION IF EXISTS prevent_inventory_movement_mutation();
DROP TABLE IF EXISTS payment_refunds;
DROP TABLE IF EXISTS order_state_transitions;
DROP TABLE IF EXISTS inventory_movements;
DROP TABLE IF EXISTS inventory_reservations;
ALTER TABLE order_items DROP COLUMN IF EXISTS reservation_status;
ALTER TABLE order_items DROP COLUMN IF EXISTS snapshot;
ALTER TABLE order_items DROP COLUMN IF EXISTS tax;
ALTER TABLE order_items DROP COLUMN IF EXISTS location_id;
ALTER TABLE order_items DROP COLUMN IF EXISTS product_variant_id;
DROP TABLE IF EXISTS inventory_stock_levels;
DROP TABLE IF EXISTS stock_locations;
DROP TABLE IF EXISTS product_variants;

COMMIT;
