CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  language text NOT NULL DEFAULT 'ar',
  category text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  meta_template_id text,
  rejection_reason text,
  channel_account_id uuid REFERENCES channel_accounts(id),
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_templates_ws_name_language ON whatsapp_templates(workspace_id, name, language);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_templates_ws_status ON whatsapp_templates(workspace_id, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES whatsapp_templates(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  status text NOT NULL,
  components jsonb NOT NULL,
  response_json jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_template_versions_template_version ON template_versions(template_id, version_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_template_versions_tpl ON template_versions(template_id, version_number DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  template_id uuid NOT NULL REFERENCES whatsapp_templates(id),
  channel_account_id uuid NOT NULL REFERENCES channel_accounts(id),
  audience_filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  variable_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  stats jsonb NOT NULL DEFAULT '{"total":0,"sent":0,"delivered":0,"read":0,"replied":0,"failed":0}'::jsonb,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_broadcasts_ws_status ON broadcasts(workspace_id, status, scheduled_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id),
  contact_channel_id uuid REFERENCES contact_channels(id),
  status text NOT NULL DEFAULT 'queued',
  message_id uuid REFERENCES messages(id),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  error_code text,
  error_message text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_broadcast_recipients_broadcast_contact ON broadcast_recipients(broadcast_id, contact_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_bc ON broadcast_recipients(broadcast_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_contact ON broadcast_recipients(workspace_id, contact_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger jsonb NOT NULL,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  last_run_at timestamptz,
  run_count int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_automations_ws_status ON automations(workspace_id, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status text NOT NULL,
  trigger_payload jsonb NOT NULL,
  conditions_evaluated jsonb,
  actions_executed jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_automation_runs_auto ON automation_runs(automation_id, started_at DESC);
