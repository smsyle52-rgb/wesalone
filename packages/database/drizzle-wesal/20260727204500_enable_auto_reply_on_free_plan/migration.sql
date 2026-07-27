-- Auto-reply is no longer withheld from the free plan. Gating it there took
-- the agent offline for real merchants the moment the gate shipped —
-- including a paying one whose UserQuota row had never been stamped with
-- its plan, so it read as free.
--
-- Every plan now grants autoReply (see wesal-one-plans.ts), so every existing
-- row becomes true. The column and the reply-path gate stay in place: they
-- remain the mechanism for suspending a specific workspace later.
UPDATE "UserQuota" SET "autoReplyEnabled" = true;
