/**
 * Provision the "Zawaya Makkah Travel" AI agent and re-open an expired trial
 * with a fixed allowance of bot replies.
 *
 * DRY-RUN BY DEFAULT: prints what it would do and writes nothing. Pass
 * `--apply` to write. Review the output of the dry run first.
 *
 * What `--apply` does (idempotent, safe to re-run):
 *   1. Creates the agent from docs/agents/zawaya-makkah.agent.json through
 *      `aiAgentService.create` (skipped if an agent with the same name exists).
 *   2. Calls `userQuotaService.grantTrialBotMessages` for the workspace owner:
 *      fresh trial window, bot-message limit = `--messages`, usage reset to 0.
 *      The worker's bot-message quota gate then stops replies after that many.
 *
 * Channels disconnected by the expired-trial teardown are NOT reconnected —
 * the owner must reconnect them in Settings → Channels.
 *
 * Usage:
 *   pnpm tsx scripts/provision-zawaya-agent.mts --workspace-id <id> \
 *     [--messages 50] [--trial-days 7] [--env .env.prod] [--apply]
 */
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"

const { values } = parseArgs({
  options: {
    "workspace-id": { type: "string" },
    messages: { type: "string", default: "50" },
    "trial-days": { type: "string", default: "7" },
    env: { type: "string", default: ".env.prod" },
    apply: { type: "boolean", default: false },
  },
})

const workspaceId = values["workspace-id"]
const messages = Number(values.messages)
const trialDays = Number(values["trial-days"])
if (!workspaceId) {
  console.error("--workspace-id is required")
  process.exit(2)
}

process.loadEnvFile(values.env)
process.env.SKIP_ENV_CHECK = "true"

const { workspaceService, aiAgentService, userQuotaService } = await import(
  "../packages/business/src/index.ts"
)

const workspace = await workspaceService.find({ where: { id: workspaceId } })
if (!workspace?.ownerId) {
  console.error(`Workspace ${workspaceId} not found or has no owner`)
  process.exit(1)
}
const ownerId = workspace.ownerId

const definition = JSON.parse(
  readFileSync(
    new URL("../docs/agents/zawaya-makkah.agent.json", import.meta.url),
    "utf8",
  ),
)
const existing = await aiAgentService.findBy({
  where: { workspaceId, name: definition.name },
})
const quota = await userQuotaService.getForUser(ownerId)

console.log(`Workspace : ${workspaceId} (owner ${ownerId})`)
console.log(
  `Quota now : status=${quota?.planStatus ?? "none"} periodEnd=${quota?.periodEnd?.toISOString() ?? "-"} ` +
    `botMessages=${quota?.botMessagesUsed ?? 0}/${quota?.botMessagesLimit ?? "∞"}`,
)
console.log(
  `Agent     : ${existing ? `exists (#${existing.id}), will skip` : "will be created"}`,
)
console.log(
  `Grant     : ${messages} bot replies, trial ${trialDays} days, usage reset to 0`,
)

if (!values.apply) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply to proceed.")
  process.exit(0)
}

if (!existing) {
  await aiAgentService.create(workspaceId, definition)
  console.log("✔ agent created")
}
await userQuotaService.grantTrialBotMessages({
  userId: ownerId,
  messages,
  trialDays,
})
console.log(
  `✔ granted ${messages} replies, trial reopened for ${trialDays} days`,
)
process.exit(0)
