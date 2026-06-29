ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'Draft';
ALTER TABLE orders ALTER COLUMN payment_status SET DEFAULT 'Unpaid';

UPDATE orders SET status = CASE
  WHEN status = 'new' THEN 'Draft'
  WHEN status = 'confirmed' THEN 'Confirmed'
  WHEN status = 'processing' THEN 'Preparing'
  WHEN status = 'ready' THEN 'Ready'
  WHEN status = 'delivered' THEN 'Delivered'
  WHEN status = 'cancelled' THEN 'Cancelled'
  WHEN status = 'returned' THEN 'Returned'
  ELSE status
END;

UPDATE orders SET payment_status = CASE
  WHEN payment_status = 'unpaid' THEN 'Unpaid'
  WHEN payment_status = 'pending' THEN 'Pending'
  WHEN payment_status = 'partial' THEN 'PartiallyPaid'
  WHEN payment_status = 'paid' THEN 'Paid'
  ELSE payment_status
END;
