DROP INDEX "BillableUsageEvent_status_createdAt_idx";--> statement-breakpoint
CREATE INDEX "BillableUsageEvent_status_createdAt_idx" ON "BillableUsageEvent" ("status","updatedAt");