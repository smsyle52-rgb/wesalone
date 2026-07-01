-- Billing admin/manual payment closure.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly';

ALTER TABLE payment_submissions
  ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly';

ALTER TABLE payment_submissions
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE INDEX IF NOT EXISTS idx_payment_submissions_type_status_created
  ON payment_submissions(submission_type, status, created_at);

CREATE INDEX IF NOT EXISTS idx_payment_submissions_subscription_review_guard
  ON payment_submissions(workspace_id, plan_id, billing_cycle, status)
  WHERE submission_type = 'subscription' AND status = 'under_review';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_submissions_status_lifecycle'
  ) THEN
    ALTER TABLE payment_submissions
      ADD CONSTRAINT chk_payment_submissions_status_lifecycle
      CHECK (status IN (
        'pending',
        'payment_submitted',
        'pending_payment',
        'under_review',
        'confirmed',
        'approved',
        'rejected',
        'cancelled',
        'expired',
        'refunded',
        'chargeback'
      ));
  END IF;
END $$;
