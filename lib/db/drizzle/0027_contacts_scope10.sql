ALTER TABLE contacts ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived_at timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contacts_ws_archived_created ON contacts(workspace_id, archived_at, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contacts_ws_phone ON contacts(workspace_id, phone);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contacts_ws_email ON contacts(workspace_id, lower(email));
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contacts_ws_name_trgm ON contacts USING gin (name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contacts_ws_company_trgm ON contacts USING gin (company gin_trgm_ops);
