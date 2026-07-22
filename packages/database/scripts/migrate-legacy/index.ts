// One-off legacy data migration: old Wesal One (khadamatak) -> new Wesal One
// (this repo, ChatbotX-based). NEVER run this against real production databases
// directly — point OLD_DATABASE_URL / DATABASE_URL at scratch copies until the
// approved plan's Phase 3 (real cutover) explicitly says otherwise.
//
// Usage (deliberately NOT wired through the repo's shared .env — both URLs must
// be passed explicitly every time, so there is no silent fallback to whatever
// DATABASE_URL happens to be configured for normal dev/deploy use):
//   OLD_DATABASE_URL=postgres://.../scratch_old \
//   DATABASE_URL=postgres://.../scratch_new \
//   pnpm --filter @chatbotx.io/database migrate:legacy
//
// Steps run in dependency order; each is safe to re-run (upsert-by-id /
// onConflictDoNothing), so the whole step is retried on a transient connection
// drop rather than failing the run — running over a Cloud SQL proxy tunnel from
// outside GCP has shown real intermittent ECONNRESETs during Phase 2.
//
// Explicitly NOT migrated here, per the approved plan's decisions:
//   - WhatsApp/Meta channel credentials (merchants reconnect via embedded-signup in Phase 3)
//   - Passwords (migrated owners authenticate via a forced password reset in Phase 3)
//   - Knowledge-base embeddings (768 -> 1536 dimension mismatch; re-embedded after import, not copied)
//   - Message attachments / file bytes (a separate storage-to-storage copy, out of scope)

import { closeOldPool } from "./old-db"
import { migrateWorkspaces } from "./steps/01-workspaces"
import { migrateSubscriptionPayments } from "./steps/02-billing"
import { migratePoints } from "./steps/03-points"
import { migrateContacts } from "./steps/04-contacts"
import { migrateConversations } from "./steps/05-conversations"
import { migrateKnowledge } from "./steps/06-knowledge"

const TRANSIENT_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE"])
// pg-pool's connect-timeout errors carry no syscall `code`, only a message —
// match those (and any nested cause message) too so a flaky proxy tunnel drop
// at connect time is retried rather than aborting the whole run.
const TRANSIENT_MESSAGE = /econnreset|connection terminated|connection timeout|timeout expired|server closed/i

const collectMessages = (error: unknown, out: string[] = [], depth = 0): string[] => {
  if (!error || depth > 5) {
    return out
  }
  const err = error as { code?: string; message?: string; cause?: unknown }
  if (err.code) {
    out.push(err.code)
  }
  if (err.message) {
    out.push(err.message)
  }
  return collectMessages(err.cause, out, depth + 1)
}

const isTransient = (error: unknown): boolean => {
  const signals = collectMessages(error)
  return signals.some(
    (s) => TRANSIENT_CODES.has(s) || TRANSIENT_MESSAGE.test(s),
  )
}

const withRetry = async <T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 5,
): Promise<T> => {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isTransient(error) || attempt === attempts) {
        throw error
      }
      const backoffMs = 1000 * attempt
      console.warn(
        `${label}: transient connection error, retry ${attempt}/${attempts} after ${backoffMs}ms`,
      )
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
  throw lastError
}

const main = async () => {
  const workspaces = await withRetry("Step 1", () => migrateWorkspaces())
  await withRetry("Step 2", () => migrateSubscriptionPayments(workspaces))
  await withRetry("Step 3", () => migratePoints(workspaces))
  await withRetry("Step 4", () => migrateContacts(workspaces))
  await withRetry("Step 5", () => migrateConversations(workspaces))
  await withRetry("Step 6", () => migrateKnowledge(workspaces))

  console.log(`Done. ${workspaces.length} workspace(s) migrated.`)
}

main()
  .catch((err) => {
    console.error("Migration failed:", err)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeOldPool()
  })
