export {};

const PHASE2_TOOLS = [
  "create_order",
  "log_payment_claim",
  "schedule_followup",
  "send_product_media",
  "handoff_to_human",
] as const;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`PHASE2_TOOLS_ENABLE_FAIL: ${name} is required`);
    process.exit(1);
  }
  return value;
}

const agentId = requiredEnv("AGENT_ID");
requiredEnv("DATABASE_URL");
const workspaceId = process.env.WORKSPACE_ID?.trim();
const dryRun = process.env.DRY_RUN === "true";
const { pool } = await import("@workspace/db");

type AgentRow = {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
};

const agentResult = workspaceId
  ? await pool.query<AgentRow>(
    "SELECT id, workspace_id, name, status FROM ai_agents WHERE id=$1 AND workspace_id=$2 LIMIT 1",
    [agentId, workspaceId],
  )
  : await pool.query<AgentRow>(
    "SELECT id, workspace_id, name, status FROM ai_agents WHERE id=$1 LIMIT 1",
    [agentId],
  );
const agent = agentResult.rows[0];

if (!agent) {
  console.error("PHASE2_TOOLS_ENABLE_FAIL: agent not found");
  process.exit(1);
}

if (agent.status !== "active") {
  console.error(`PHASE2_TOOLS_ENABLE_FAIL: agent is not active (${agent.status})`);
  process.exit(1);
}

if (dryRun) {
  console.log(`PHASE2_TOOLS_ENABLE_DRY_RUN: agent=${agent.id} workspace=${agent.workspace_id} tools=${PHASE2_TOOLS.join(",")}`);
  await pool.end();
  process.exit(0);
}

for (const toolKey of PHASE2_TOOLS) {
  const existing = await pool.query<{ id: string }>(
    "SELECT id FROM ai_agent_tools WHERE workspace_id=$1 AND agent_id=$2 AND tool_key=$3 LIMIT 1",
    [agent.workspace_id, agent.id, toolKey],
  );

  if (existing.rows[0]) {
    await pool.query(
      "UPDATE ai_agent_tools SET is_enabled=true, requires_approval=false, updated_at=NOW() WHERE id=$1",
      [existing.rows[0].id],
    );
  } else {
    await pool.query(
      "INSERT INTO ai_agent_tools (workspace_id, agent_id, tool_key, is_enabled, requires_approval, config) VALUES ($1, $2, $3, true, false, '{}'::jsonb)",
      [agent.workspace_id, agent.id, toolKey],
    );
  }
}

await pool.end();
console.log(`PHASE2_TOOLS_ENABLED: agent=${agent.id} workspace=${agent.workspace_id} tools=${PHASE2_TOOLS.length}`);
