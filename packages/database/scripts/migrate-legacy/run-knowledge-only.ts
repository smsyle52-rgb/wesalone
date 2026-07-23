// Targeted runner: Step 1 (workspaces — idempotent, already present) then Step 6
// (knowledge) only. Used to confirm the knowledge migration end-to-end without
// waiting on the large Step 5 message loop. Same env vars as index.ts.
import { closeOldPool } from "./old-db"
import { migrateWorkspaces } from "./steps/01-workspaces"
import { migrateKnowledge } from "./steps/06-knowledge"

const main = async () => {
  const workspaces = await migrateWorkspaces()
  await migrateKnowledge(workspaces)
}

main()
  .catch((err) => {
    console.error("knowledge-only run failed:", err)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeOldPool()
  })
