-- W5-T1 (partial): self-reported presence on workspace_memberships. Additive.
-- Auto-assignment (which would also write conversations.agent_status) stays
-- deferred with W3-T1.

DO $$
BEGIN
  ALTER TABLE workspace_memberships ADD COLUMN availability text NOT NULL DEFAULT 'offline';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
