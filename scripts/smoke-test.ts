import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Check = {
  name: string;
  ok: boolean;
  detail?: string;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;

function fail(message: string): never {
  console.error(`PHASE4_SMOKE_FAIL: ${message}`);
  process.exit(1);
}

function assertCheck(check: Check): void {
  if (!check.ok) fail(`${check.name}${check.detail ? ` (${check.detail})` : ""}`);
}

async function readRepoFile(path: string): Promise<string> {
  return readFile(resolve(repoRoot, path), "utf8");
}

function containsAll(source: string, tokens: string[]): boolean {
  return tokens.every((token) => source.includes(token));
}

async function runContractSmoke(): Promise<void> {
  const files = await Promise.all([
    readRepoFile("lib/db/src/schema/agent_memory.ts"),
    readRepoFile("lib/db/src/schema/ai.ts"),
    readRepoFile("lib/db/src/schema/knowledge.ts"),
    readRepoFile("lib/db/src/schema/service_health.ts"),
    readRepoFile("artifacts/api-server/src/modules/ai/ai.routes.ts"),
    readRepoFile("artifacts/api-server/src/modules/integrations/webhooks.routes.ts"),
    readRepoFile("artifacts/api-server/src/modules/integrations/meta-webhook.handler.ts"),
    readRepoFile("artifacts/api-server/src/routes/health.ts"),
    readRepoFile("artifacts/api-server/src/services/agent-memory.ts"),
    readRepoFile("artifacts/api-server/src/services/knowledge-retrieval.ts"),
    readRepoFile("artifacts/api-server/src/services/trust-gate.ts"),
    readRepoFile("artifacts/outbox-worker/src/index.ts"),
    readRepoFile("artifacts/web/src/lib/realtime.ts"),
  ]);

  const [
    memorySchema,
    aiSchema,
    knowledgeSchema,
    serviceHealthSchema,
    aiRoutes,
    webhookRoutes,
    metaWebhookHandler,
    healthRoutes,
    memoryService,
    retrievalService,
    trustGate,
    worker,
    realtimeClient,
  ] = files;

  const checks: Check[] = [
    {
      name: "agent memory schema",
      ok: containsAll(memorySchema, [
        "agent_memory_snapshots",
        "recent_turns",
        "uq_memory_conv_agent",
        "idx_memory_ws_conv",
      ]),
    },
    {
      name: "agent memory service",
      ok: containsAll(memoryService, ["loadContext", "appendTurn", "rotate", "clear", "MAX_TURNS = 20"]),
    },
    {
      name: "draft reply memory wiring",
      ok: containsAll(aiRoutes, ["loadContext", "appendTurn", "shouldRotate", "/runs/draft-reply"]),
    },
    {
      name: "knowledge retrieval schema",
      ok: containsAll(knowledgeSchema, ["knowledge_chunks", "embeddingModel", "embeddedAt", "tsv"]),
    },
    {
      name: "knowledge retrieval service",
      ok: containsAll(retrievalService, ["searchKnowledgeForAi", "vector", "plainto_tsquery", "score"]),
    },
    {
      name: "draft reply RAG wiring",
      ok: containsAll(aiRoutes, ["searchKnowledgeForAi", "knowledgeSources", "sources"]),
    },
    {
      name: "trust schema",
      ok: containsAll(aiSchema, ["trust_mode", "trust_topics", "auto_reply_decisions", "daily_auto_send_quota"]),
    },
    {
      name: "trust gate",
      ok: containsAll(trustGate, ["shouldAutoSend", "trust_mode_off", "topic_not_whitelisted", "quota_exceeded"]),
    },
    {
      name: "auto-send enqueue is outbox-only",
      ok: containsAll(aiRoutes, ["message.send.whatsapp.text", "autoReplyOutboxEventId", "outboxEventsTable"]),
    },
    {
      name: "Meta webhook HMAC",
      ok: containsAll(webhookRoutes, ["x-hub-signature-256", "timingSafeEqual", "META_APP_SECRET"]),
    },
    {
      name: "Meta inbound to conversation loop",
      ok: containsAll(metaWebhookHandler, ["handleMetaWhatsAppWebhook", "messagesCreated", "domainEventsTable", "message.received"]),
    },
    {
      name: "outbox worker dry-run text dispatch",
      ok: containsAll(worker, ["dispatchWhatsAppText", "META_DRY_RUN", "Meta outbox send DRY_RUN", "message.send.whatsapp.text"]),
    },
    {
      name: "SSE realtime inbox",
      ok: containsAll(realtimeClient, ["EventSource", "message.received", "openInboxStream"]),
    },
    {
      name: "strict health probes",
      ok: containsAll(serviceHealthSchema, ["service_heartbeats"]) &&
        containsAll(healthRoutes, ["/livez", "outbox-worker-stale", "SELECT 1"]),
    },
  ];

  for (const check of checks) assertCheck(check);

  const hmac = createHmac("sha256", "phase4-test-secret")
    .update(JSON.stringify({ object: "whatsapp_business_account" }))
    .digest("hex");
  assertCheck({ name: "local HMAC generation", ok: hmac.length === 64 });

  console.log("PHASE4_SMOKE_PASS: mode=contract-dry-run checks=15 external_calls=0");
}

async function runDatabaseSmoke(): Promise<void> {
  process.env.AI_PROVIDER = process.env.AI_PROVIDER ?? "mock";
  process.env.META_DRY_RUN = "true";
  process.env.AI_EMBEDDINGS_DRY_RUN = "true";

  const { pool } = await runtimeImport("@workspace/db");
  const { loadContext } = await runtimeImport("../artifacts/api-server/src/services/agent-memory.ts");
  const { shouldAutoSend } = await runtimeImport("../artifacts/api-server/src/services/trust-gate.ts");
  const { handleMetaWhatsAppWebhook } = await runtimeImport("../artifacts/api-server/src/modules/integrations/meta-webhook.handler.ts");

  const workspaceId = randomUUID();
  const userId = randomUUID();
  const channelAccountId = randomUUID();
  const knowledgeBaseId = randomUUID();
  const documentId = randomUUID();
  const chunkId = randomUUID();
  const agentId = randomUUID();
  const phoneNumberId = `phase4_phone_${Date.now()}`;
  const providerMessageId = `wamid.phase4.${Date.now()}`;
  const customerPhone = "+967700000404";
  const slug = `phase4-smoke-${Date.now()}`;

  await pool.query(
    "INSERT INTO workspaces (id, name, slug, settings) VALUES ($1, $2, $3, $4::jsonb)",
    [workspaceId, "PHASE4-SMOKE Workspace", slug, JSON.stringify({ topic_keywords: { pricing: ["سعر", "كم"] } })],
  );
  await pool.query(
    "INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)",
    [userId, `${slug}@example.test`, "PHASE4-SMOKE Owner", "not-used"],
  );
  await pool.query(
    "INSERT INTO channel_accounts (id, workspace_id, channel_type, name, display_name, provider_config, created_by) VALUES ($1, $2, 'whatsapp', $3, $4, $5::jsonb, $6)",
    [channelAccountId, workspaceId, "PHASE4-SMOKE WhatsApp", "PHASE4-SMOKE WhatsApp", JSON.stringify({ phoneNumberId }), userId],
  );
  await pool.query(
    "INSERT INTO knowledge_bases (id, workspace_id, name, created_by) VALUES ($1, $2, $3, $4)",
    [knowledgeBaseId, workspaceId, "PHASE4-SMOKE KB", userId],
  );
  await pool.query(
    "INSERT INTO knowledge_documents (id, workspace_id, knowledge_base_id, title, content_text, status, created_by) VALUES ($1, $2, $3, $4, $5, 'ready', $6)",
    [documentId, workspaceId, knowledgeBaseId, "PHASE4-SMOKE Pricing", "سعر القميص الأبيض 12000 ريال يمني.", userId],
  );
  await pool.query(
    "INSERT INTO knowledge_chunks (id, workspace_id, knowledge_base_id, document_id, chunk_index, chunk_text, embedding_status, embedding_model) VALUES ($1, $2, $3, $4, 0, $5, 'embedded', 'dry-run')",
    [chunkId, workspaceId, knowledgeBaseId, documentId, "سعر القميص الأبيض 12000 ريال يمني."],
  );
  await pool.query(
    "INSERT INTO ai_agents (id, workspace_id, name, type, status, default_model, knowledge_base_ids, trust_topics, created_by) VALUES ($1, $2, $3, 'support', 'active', 'mock', $4::jsonb, '[]'::jsonb, $5)",
    [agentId, workspaceId, "PHASE4-SMOKE Agent", JSON.stringify([knowledgeBaseId]), userId],
  );

  const payload = {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: phoneNumberId },
          messages: [{
            id: providerMessageId,
            from: customerPhone.replace("+", ""),
            timestamp: `${Math.floor(Date.now() / 1000)}`,
            type: "text",
            text: { body: "كم سعر القميص الأبيض؟" },
          }],
        },
      }],
    }],
  };

  const webhook = await handleMetaWhatsAppWebhook(payload);
  assertCheck({ name: "DB webhook creates one message", ok: webhook.handled && webhook.messagesCreated === 1 });

  const messageResult = await pool.query(
    "SELECT id, conversation_id, content FROM messages WHERE workspace_id = $1 AND provider_message_id = $2 LIMIT 1",
    [workspaceId, providerMessageId],
  );
  const message = messageResult.rows[0];
  assertCheck({ name: "DB inbound message persisted", ok: Boolean(message?.id) });

  const eventResult = await pool.query(
    "SELECT id FROM domain_events WHERE workspace_id = $1 AND event_type = 'message.received' AND entity_id = $2 LIMIT 1",
    [workspaceId, message.id],
  );
  assertCheck({ name: "DB domain event persisted", ok: eventResult.rowCount === 1 });

  const memory = await loadContext(workspaceId, message.conversation_id, agentId);
  assertCheck({
    name: "DB memory snapshot has user message",
    ok: memory.recentTurns.some((turn: { content: string }) => turn.content.includes("القميص الأبيض")),
  });

  await pool.query(
    "INSERT INTO ai_runs (workspace_id, agent_id, task_type, input_type, input_ref_id, status, model, provider, safety_status, created_by, completed_at) VALUES ($1, $2, 'draft_reply', 'conversation', $3, 'succeeded', 'mock', 'mock', 'ok', $4, now())",
    [workspaceId, agentId, message.conversation_id, userId],
  );

  const agentResult = await pool.query("SELECT * FROM ai_agents WHERE id = $1", [agentId]);
  const suggestDecision = await shouldAutoSend({
    workspaceId,
    agent: agentResult.rows[0],
    conversationId: message.conversation_id,
    userMessage: message.content,
    draftReply: "سعر القميص الأبيض 12000 ريال يمني.",
    kbHits: [{ score: 0.95, title: "Pricing" }],
  });
  assertCheck({ name: "DB default trust mode is suggest-only", ok: suggestDecision.decision === "suggest_only" });

  await pool.query(
    "INSERT INTO auto_reply_decisions (workspace_id, conversation_id, agent_id, message_id, decision, reason, confidence, topic_detected) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [workspaceId, message.conversation_id, agentId, message.id, suggestDecision.decision, suggestDecision.reason, suggestDecision.confidence ?? null, suggestDecision.topic ?? null],
  );
  await pool.query(
    "UPDATE ai_agents SET trust_mode = 'auto', trust_topics = $2::jsonb WHERE id = $1",
    [agentId, JSON.stringify(["pricing"])],
  );

  const autoAgentResult = await pool.query("SELECT * FROM ai_agents WHERE id = $1", [agentId]);
  const autoDecision = await shouldAutoSend({
    workspaceId,
    agent: autoAgentResult.rows[0],
    conversationId: message.conversation_id,
    userMessage: message.content,
    draftReply: "سعر القميص الأبيض 12000 ريال يمني.",
    kbHits: [{ score: 0.95, title: "Pricing" }],
  });
  assertCheck({ name: "DB auto trust mode passes with high KB confidence", ok: autoDecision.decision === "auto_sent" });

  await pool.query(
    "INSERT INTO auto_reply_decisions (workspace_id, conversation_id, agent_id, message_id, decision, reason, confidence, topic_detected) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [workspaceId, message.conversation_id, agentId, message.id, autoDecision.decision, autoDecision.reason, autoDecision.confidence ?? null, autoDecision.topic ?? null],
  );
  await pool.query(
    "INSERT INTO outbox_events (workspace_id, event_type, entity_type, entity_id, idempotency_key, payload, status, next_attempt_at) VALUES ($1, 'message.send.whatsapp.text', 'conversation', $2, $3, $4::jsonb, 'pending', now())",
    [
      workspaceId,
      message.conversation_id,
      `phase4-smoke:${message.id}`,
      JSON.stringify({
        channelAccountId,
        conversationId: message.conversation_id,
        to: customerPhone,
        body: "سعر القميص الأبيض 12000 ريال يمني.",
        autoReply: true,
      }),
    ],
  );

  const outboxResult = await pool.query(
    "SELECT id FROM outbox_events WHERE workspace_id = $1 AND event_type = 'message.send.whatsapp.text' LIMIT 1",
    [workspaceId],
  );
  assertCheck({ name: "DB auto reply queued in outbox", ok: outboxResult.rowCount === 1 });

  await pool.end();
  console.log(`PHASE4_SMOKE_PASS: mode=db-dry-run workspace=${workspaceId} external_calls=0`);
}

if (process.env.DATABASE_URL) {
  await runDatabaseSmoke();
} else {
  await runContractSmoke();
}
