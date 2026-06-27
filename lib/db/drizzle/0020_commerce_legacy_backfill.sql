INSERT INTO stock_locations (workspace_id, name, type, is_default)
SELECT DISTINCT p.workspace_id, 'الموقع الافتراضي', 'virtual', true
FROM inventory_products p
WHERE NOT EXISTS (
  SELECT 1 FROM stock_locations s
  WHERE s.workspace_id = p.workspace_id AND s.is_default = true
)
ON CONFLICT (workspace_id, name) DO NOTHING;

WITH legacy_products AS (
  SELECT p.*,
         COUNT(*) FILTER (WHERE p.sku IS NOT NULL) OVER (PARTITION BY p.workspace_id, p.sku) AS sku_count,
         COUNT(*) FILTER (WHERE p.barcode IS NOT NULL) OVER (PARTITION BY p.workspace_id, p.barcode) AS barcode_count
  FROM inventory_products p
)
INSERT INTO product_variants
  (workspace_id, product_id, title, sku, barcode, option_values, price, cost, currency,
   low_stock_threshold, is_default, status)
SELECT p.workspace_id, p.id, 'افتراضي',
       CASE WHEN p.sku IS NOT NULL AND p.sku_count = 1 THEN p.sku ELSE NULL END,
       CASE WHEN p.barcode IS NOT NULL AND p.barcode_count = 1 THEN p.barcode ELSE NULL END,
       '{}'::jsonb, p.price, p.cost, p.currency, p.low_stock_threshold, true,
       CASE WHEN p.is_archived THEN 'archived' ELSE 'active' END
FROM legacy_products p
WHERE NOT EXISTS (
  SELECT 1 FROM product_variants v
  WHERE v.workspace_id = p.workspace_id AND v.product_id = p.id
);

INSERT INTO inventory_stock_levels
  (workspace_id, product_variant_id, location_id, on_hand, reserved, incoming)
SELECT p.workspace_id, v.id, s.id, GREATEST(COALESCE(p.quantity_available, 0), 0), 0, 0
FROM inventory_products p
JOIN product_variants v
  ON v.workspace_id = p.workspace_id AND v.product_id = p.id AND v.is_default = true
JOIN stock_locations s
  ON s.workspace_id = p.workspace_id AND s.is_default = true
ON CONFLICT (workspace_id, product_variant_id, location_id) DO NOTHING;

INSERT INTO inventory_movements
  (workspace_id, product_variant_id, location_id, quantity, movement_type, reason,
   correlation_id, idempotency_key, metadata)
SELECT p.workspace_id, v.id, s.id, p.quantity_available, 'Initial',
       'ترحيل الرصيد القديم من inventory_products.quantity_available',
       'migration:0020:' || p.id::text,
       'migration:0020:initial:' || p.id::text,
       jsonb_build_object('legacyProductId', p.id, 'sourceColumn', 'quantity_available')
FROM inventory_products p
JOIN product_variants v
  ON v.workspace_id = p.workspace_id AND v.product_id = p.id AND v.is_default = true
JOIN stock_locations s
  ON s.workspace_id = p.workspace_id AND s.is_default = true
WHERE COALESCE(p.quantity_available, 0) > 0
ON CONFLICT (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

UPDATE order_items oi
SET product_variant_id = v.id,
    location_id = s.id,
    snapshot = jsonb_build_object(
      'productName', oi.name,
      'variantTitle', v.title,
      'unitPrice', oi.unit_price,
      'discount', oi.discount,
      'tax', oi.tax,
      'currency', oi.currency,
      'migratedFromLegacy', true
    ) || COALESCE(oi.snapshot, '{}'::jsonb),
    updated_at = now()
FROM product_variants v, stock_locations s
WHERE oi.inventory_product_id IS NOT NULL
  AND oi.product_variant_id IS NULL
  AND v.workspace_id = oi.workspace_id
  AND v.product_id = oi.inventory_product_id
  AND v.is_default = true
  AND s.workspace_id = oi.workspace_id
  AND s.is_default = true;

UPDATE orders SET status = CASE status
  WHEN 'new' THEN 'Draft'
  WHEN 'confirmed' THEN 'Confirmed'
  WHEN 'processing' THEN 'Preparing'
  WHEN 'ready' THEN 'Ready'
  WHEN 'delivered' THEN 'Delivered'
  WHEN 'returned' THEN 'Returned'
  WHEN 'cancelled' THEN 'Cancelled'
  ELSE status
END;

UPDATE orders SET payment_status = CASE payment_status
  WHEN 'unpaid' THEN 'Unpaid'
  WHEN 'pending' THEN 'Pending'
  WHEN 'partial' THEN 'PartiallyPaid'
  WHEN 'paid' THEN 'Paid'
  WHEN 'refunded' THEN 'Refunded'
  ELSE payment_status
END;

UPDATE payments SET
  status = CASE status
    WHEN 'pending' THEN 'Pending'
    WHEN 'confirmed' THEN 'Paid'
    WHEN 'rejected' THEN 'Failed'
    WHEN 'cancelled' THEN 'Cancelled'
    ELSE status
  END,
  method = CASE method
    WHEN 'cash' THEN 'Cash'
    WHEN 'transfer' THEN 'BankTransfer'
    WHEN 'bank' THEN 'BankTransfer'
    WHEN 'kuraimi' THEN 'Wallet'
    WHEN 'jawali' THEN 'Wallet'
    WHEN 'other' THEN 'ManualPayment'
    ELSE method
  END,
  external_reference = COALESCE(external_reference, reference),
  recorded_by = COALESCE(recorded_by, created_by),
  correlation_id = COALESCE(correlation_id, 'migration:0020:' || id::text),
  idempotency_key = COALESCE(idempotency_key, 'legacy:payment:' || id::text);
