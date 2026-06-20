-- النطاق 11 (توسعة التوصيل): حقول التسليم والشحن والدفع عند الاستلام على الطلبات.
-- idempotent: ADD COLUMN IF NOT EXISTS مع defaults آمنة — يمكن تطبيقه على الإنتاج قبل نشر الكود بلا ضرر.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_type text NOT NULL DEFAULT 'pickup';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_agent_phone text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_phone text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_receipt_url text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_enabled boolean NOT NULL DEFAULT false;
