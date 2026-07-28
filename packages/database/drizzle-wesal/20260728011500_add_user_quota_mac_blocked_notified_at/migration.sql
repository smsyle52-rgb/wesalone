-- One-shot marker for the "your workspace is frozen, its monthly active
-- contact allowance is used up" email, mirroring how channelsTornDownAt marks
-- the trial teardown.
--
-- Deliberately a timestamp rather than a boolean: the notice is due again
-- whenever this is NULL *or* older than the row's current periodStart, so a
-- period rollover re-arms it on its own. Nothing has to remember to reset a
-- flag — which matters because the private quota-worker owns period resets
-- and lives outside this repo.
ALTER TABLE "UserQuota" ADD COLUMN "macBlockedNotifiedAt" timestamp(6) with time zone;--> statement-breakpoint

CREATE INDEX "UserQuota_mac_blocked_notify_idx"
  ON "UserQuota" ("macBlockedNotifiedAt")
  WHERE "macLimit" IS NOT NULL;
