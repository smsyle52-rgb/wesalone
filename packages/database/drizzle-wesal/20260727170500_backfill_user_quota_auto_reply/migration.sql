-- The previous migration added "UserQuota"."autoReplyEnabled" with a
-- blanket DEFAULT false, with no regard for the row's actual plan. Every
-- paid plan (starter/growth/professional/business) grants auto-reply;
-- only the free plan withholds it (see packages/business/src/platform/wesal-one-plans.ts).
-- Backfill existing rows from their already-synced "planName" so paying
-- workspaces don't silently lose auto-reply until their next entitlement sync.
UPDATE "UserQuota"
SET "autoReplyEnabled" = CASE
	WHEN "planName" IN ('Starter', 'Growth', 'Professional', 'Business') THEN true
	ELSE false
END;
