CREATE TABLE IF NOT EXISTS quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  shortcut text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quick_replies_ws_shortcut ON quick_replies(workspace_id, shortcut);
CREATE INDEX IF NOT EXISTS idx_quick_replies_ws ON quick_replies(workspace_id);

CREATE TABLE IF NOT EXISTS saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  name text NOT NULL,
  resource text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}',
  is_pinned boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_views_ws_user ON saved_views(workspace_id, user_id, sort_order);

CREATE TABLE IF NOT EXISTS sla_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  channel_type text NULL,
  priority text NULL,
  first_response_minutes int NOT NULL,
  resolution_minutes int NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_sla_rules_ws_active ON sla_rules(workspace_id, active);

CREATE TABLE IF NOT EXISTS business_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  day_of_week int NOT NULL,
  open_time time NULL,
  close_time time NULL,
  is_closed boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'Asia/Aden'
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_hours_ws_day ON business_hours(workspace_id, day_of_week);
