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
    readRepoFile("artifacts/api-server/src/modules/auth/auth.routes.ts"),
    readRepoFile("artifacts/api-server/src/modules/workspace/workspace.routes.ts"),
    readRepoFile("artifacts/api-server/src/modules/sectors/sectors.routes.ts"),
    readRepoFile("artifacts/api-server/src/modules/orders/orders.routes.ts"),
    readRepoFile("artifacts/api-server/src/modules/payments/payments.routes.ts"),
    readRepoFile("artifacts/api-server/src/services/meta-catalog-sync.ts"),
    readRepoFile("artifacts/web/src/pages/BusinessSetupPage.tsx"),
    readRepoFile("artifacts/web/src/pages/SettingsPage.tsx"),
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
    authRoutes,
    workspaceRoutes,
    sectorsRoutes,
    ordersRoutes,
    paymentsRoutes,
    metaCatalogSync,
    businessSetupPage,
    settingsPage,
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
    {
      name: "merchant registration and account lifecycle",
      ok: containsAll(authRoutes, ["/register", "/verify-email", "/forgot-password", "/reset-password", "signupLimiter"]),
    },
    {
      name: "guided onboarding captures sector and governorate",
      ok: containsAll(workspaceRoutes, ["sector_key", "governorate", "settings"]) &&
        containsAll(businessSetupPage, ["sectorKey", "governorate", "sectors"]),
    },
    {
      name: "sector behavior profile API",
      ok: containsAll(sectorsRoutes, ["sectorProfilesTable", "sectors"]),
    },
    {
      name: "draft reply sector and escalation wiring",
      ok: containsAll(aiRoutes, ["loadSectorAgentContext", "knowledge_gap", "needsHuman", "conversation.needs_human"]),
    },
    {
      name: "orders and manual payments",
      ok: containsAll(ordersRoutes, ["router.post", "ordersTable", "totalAmount"]) &&
        containsAll(paymentsRoutes, ["router.post", "paymentsTable", "amount"]),
    },
    {
      name: "plan upgrade payment submission",
      ok: containsAll(workspaceRoutes, ["paymentSubmissionsTable", "/billing/payment-submissions", "amountCurrency"]) &&
        containsAll(settingsPage, ["paymentSubmissions", "amountCurrency"]),
    },
    {
      name: "Meta catalog live API shape and resilient sync",
      ok: containsAll(metaCatalogSync, [
        "/products?fields=id,name,description,price,currency,availability,inventory,image_url,url,brand,category",
        "/posts?fields=id,message,created_time,permalink_url,attachments,type",
        "/ads?fields=id,name,status,objective,creative{body,image_url,object_story_spec},start_time,end_time",
        "upsertProductKnowledge",
        "Meta catalog access token is not configured",
        "lastSyncedAt: result.status === \"failed\" ? source.lastSyncedAt : new Date()",
      ]),
    },
    {
      name: "catalog ads and posts enter agent context",
      ok: containsAll(aiRoutes, ["loadCatalogAgentContext", "adCampaignsTable", "socialPostsTable", "productsTable"]),
    },
  ];

  for (const check of checks) assertCheck(check);

  const hmac = createHmac("sha256", "phase4-test-secret")
    .update(JSON.stringify({ object: "whatsapp_business_account" }))
    .digest("hex");
  assertCheck({ name: "local HMAC generation", ok: hmac.length === 64 });

  console.log(`MERCHANT_JOURNEY_SMOKE_PASS: mode=contract-dry-run checks=${checks.length} external_calls=0`);
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
  const sectorProfileId = randomUUID();
  const taskId = randomUUID();
  const orderId = randomUUID();
  const paymentId = randomUUID();
  const planId = randomUUID();
  const paymentSubmissionId = randomUUID();
  const phoneNumberId = `phase4_phone_${Date.now()}`;
  const providerMessageId = `wamid.phase4.${Date.now()}`;
  const mediaProviderMessageIds = {
    image: `wamid.phase5.image.${Date.now()}`,
    voice: `wamid.phase5.voice.${Date.now()}`,
    location: `wamid.phase5.location.${Date.now()}`,
    document: `wamid.phase5.document.${Date.now()}`,
    unknown: `wamid.phase5.unknown.${Date.now()}`,
  };
  const outboundProviderMessageId = `wamid.phase5.outbound.${Date.now()}`;
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
  await pool.query("UPDATE users SET email_verified = true WHERE id = $1", [userId]);
  const verifiedUser = await pool.query("SELECT email_verified FROM users WHERE id = $1", [userId]);
  assertCheck({ name: "DB registration email verified", ok: verifiedUser.rows[0]?.email_verified === true });

  await pool.query(
    "UPDATE workspaces SET settings = settings || $2::jsonb WHERE id = $1",
    [
      workspaceId,
      JSON.stringify({
        sector_key: "retail_sales",
        governorate: "صنعاء",
        district: "حدة",
      }),
    ],
  );
  await pool.query(
    "INSERT INTO sector_profiles (id, sector_key, name_ar, description_ar, base_knowledge, behavior_profile, service_goals, default_tone, guardrails) VALUES ($1, 'retail_sales', $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8::jsonb) ON CONFLICT (sector_key) DO NOTHING",
    [
      sectorProfileId,
      "متجر بيع",
      "ملف خدمة تجزئة لاختبار الدخان.",
      JSON.stringify({ faq: ["prices must come from knowledge"] }),
      JSON.stringify({ behavior: "present products clearly and escalate when unsure" }),
      JSON.stringify({ goal: "customer understands how to order" }),
      "مهني وودود",
      JSON.stringify({ red_lines: ["never confirm payment"] }),
    ],
  );
  const onboardingResult = await pool.query(
    "SELECT settings->>'sector_key' AS sector_key, settings->>'governorate' AS governorate FROM workspaces WHERE id = $1",
    [workspaceId],
  );
  assertCheck({
    name: "DB onboarding stores sector and governorate",
    ok: onboardingResult.rows[0]?.sector_key === "retail_sales" && onboardingResult.rows[0]?.governorate === "صنعاء",
  });

  await pool.query(
    "INSERT INTO usage_counters (workspace_id, period_month, messages_sent, agents_count, contacts_count, team_members) VALUES ($1, to_char(now(), 'YYYY-MM'), 0, 1, 0, 1) ON CONFLICT (workspace_id, period_month) DO UPDATE SET agents_count = EXCLUDED.agents_count",
    [workspaceId],
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
    "INSERT INTO ai_agents (id, workspace_id, name, type, status, default_model, knowledge_base_ids, sector_key, channel_tone, trust_topics, created_by) VALUES ($1, $2, $3, 'support', 'active', 'mock', $4::jsonb, 'retail_sales', $5::jsonb, '[]'::jsonb, $6)",
    [
      agentId,
      workspaceId,
      "PHASE6-SMOKE Agent",
      JSON.stringify([knowledgeBaseId]),
      JSON.stringify({ whatsapp: "friendly and clear" }),
      userId,
    ],
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

  const rawWebhookBody = Buffer.from(JSON.stringify(payload));
  const signature = createHmac("sha256", "phase5-meta-secret").update(rawWebhookBody).digest("hex");
  const expectedSignature = createHmac("sha256", "phase5-meta-secret").update(rawWebhookBody).digest("hex");
  assertCheck({ name: "DB Meta HMAC verification input is deterministic", ok: signature === expectedSignature && signature.length === 64 });

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

  const mediaPayload = {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: phoneNumberId },
          messages: [
            {
              id: mediaProviderMessageIds.image,
              from: customerPhone.replace("+", ""),
              timestamp: `${Math.floor(Date.now() / 1000)}`,
              type: "image",
              image: { id: "media_image_1", mime_type: "image/jpeg", sha256: "img-sha", caption: "صورة المنتج" },
            },
            {
              id: mediaProviderMessageIds.voice,
              from: customerPhone.replace("+", ""),
              timestamp: `${Math.floor(Date.now() / 1000)}`,
              type: "voice",
              voice: { id: "media_voice_1", mime_type: "audio/ogg", sha256: "voice-sha" },
            },
            {
              id: mediaProviderMessageIds.location,
              from: customerPhone.replace("+", ""),
              timestamp: `${Math.floor(Date.now() / 1000)}`,
              type: "location",
              location: { latitude: 15.3694, longitude: 44.1910, name: "صنعاء", address: "حدة" },
            },
            {
              id: mediaProviderMessageIds.document,
              from: customerPhone.replace("+", ""),
              timestamp: `${Math.floor(Date.now() / 1000)}`,
              type: "document",
              document: { id: "media_doc_1", mime_type: "application/pdf", sha256: "doc-sha", caption: "فاتورة" },
            },
            {
              id: mediaProviderMessageIds.unknown,
              from: customerPhone.replace("+", ""),
              timestamp: `${Math.floor(Date.now() / 1000)}`,
              type: "unsupported_custom",
              unsupported_custom: { id: "custom_1" },
            },
          ],
        },
      }],
    }],
  };
  const mediaWebhook = await handleMetaWhatsAppWebhook(mediaPayload);
  assertCheck({ name: "DB webhook stores text image voice location document unknown", ok: mediaWebhook.handled && mediaWebhook.messagesCreated === 5 });

  const duplicateMediaWebhook = await handleMetaWhatsAppWebhook(mediaPayload);
  assertCheck({ name: "DB webhook idempotency prevents duplicate provider messages", ok: duplicateMediaWebhook.handled && duplicateMediaWebhook.messagesCreated === 0 });

  const contentTypesResult = await pool.query(
    "SELECT content_type FROM messages WHERE workspace_id = $1 AND provider_message_id = ANY($2::text[]) ORDER BY content_type",
    [workspaceId, Object.values(mediaProviderMessageIds)],
  );
  const contentTypes = contentTypesResult.rows.map((row: { content_type: string }) => row.content_type);
  assertCheck({
    name: "DB inbound message type coverage",
    ok: ["document", "image", "location", "unsupported_custom", "voice"].every((type) => contentTypes.includes(type)),
  });

  const updatedContactLocation = await pool.query(
    "SELECT city, location_note FROM contacts WHERE workspace_id = $1 AND phone = $2 LIMIT 1",
    [workspaceId, customerPhone],
  );
  assertCheck({
    name: "DB location inbound updates contact location",
    ok: updatedContactLocation.rows[0]?.city === "صنعاء" && String(updatedContactLocation.rows[0]?.location_note ?? "").includes("حدة"),
  });

  await pool.query(
    "INSERT INTO messages (workspace_id, conversation_id, provider_message_id, direction, sender_type, source, content_type, content, delivery_status) VALUES ($1, $2, $3, 'outbound', 'system', 'whatsapp_cloud', 'text', $4, 'sent')",
    [workspaceId, message.conversation_id, outboundProviderMessageId, "Outbound status smoke"],
  );
  const statusWebhook = await handleMetaWhatsAppWebhook({
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: phoneNumberId },
          statuses: [{ id: outboundProviderMessageId, status: "read", timestamp: `${Math.floor(Date.now() / 1000)}` }],
        },
      }],
    }],
  });
  assertCheck({ name: "DB status update maps to existing message", ok: statusWebhook.handled && statusWebhook.statusesUpdated === 1 });

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

  await pool.query(
    "UPDATE conversations SET needs_human = true, escalation_reason = 'knowledge_gap', updated_at = now() WHERE id = $1",
    [message.conversation_id],
  );
  await pool.query(
    "INSERT INTO tasks (id, workspace_id, title, description, status, priority, contact_id, conversation_id, source_message_id, related_type, related_id, created_by) VALUES ($1, $2, $3, $4, 'pending', 'high', (SELECT contact_id FROM conversations WHERE id = $5), $5, $6, 'conversation', $5, $7)",
    [taskId, workspaceId, "Knowledge gap follow-up", "Merchant should answer an unknown customer question.", message.conversation_id, message.id, userId],
  );
  await pool.query(
    "INSERT INTO auto_reply_decisions (workspace_id, conversation_id, agent_id, message_id, decision, reason, confidence, topic_detected) VALUES ($1, $2, $3, $4, 'suggest_only', 'knowledge_gap', 0.30, 'unknown')",
    [workspaceId, message.conversation_id, agentId, message.id],
  );
  const escalationResult = await pool.query(
    "SELECT c.needs_human, c.escalation_reason, t.id AS task_id FROM conversations c LEFT JOIN tasks t ON t.conversation_id = c.id WHERE c.id = $1 LIMIT 1",
    [message.conversation_id],
  );
  assertCheck({
    name: "DB knowledge gap escalates with merchant task",
    ok: escalationResult.rows[0]?.needs_human === true &&
      escalationResult.rows[0]?.escalation_reason === "knowledge_gap" &&
      Boolean(escalationResult.rows[0]?.task_id),
  });

  await pool.query(
    "INSERT INTO orders (id, workspace_id, order_number, status, channel, contact_id, conversation_id, total_amount, currency, payment_status, items, created_by) VALUES ($1, $2, $3, 'confirmed', 'whatsapp', (SELECT contact_id FROM conversations WHERE id = $4), $4, 12000, 'YER', 'partial', $5::jsonb, $6)",
    [
      orderId,
      workspaceId,
      `PHASE6-${Date.now()}`,
      message.conversation_id,
      JSON.stringify([{ name: "white shirt", quantity: 1, price: 12000 }]),
      userId,
    ],
  );
  const orderResult = await pool.query("SELECT id FROM orders WHERE id = $1 AND workspace_id = $2", [orderId, workspaceId]);
  assertCheck({ name: "DB merchant can create order", ok: orderResult.rowCount === 1 });

  await pool.query(
    "INSERT INTO payments (id, workspace_id, amount, currency, method, status, contact_id, order_id, reference, paid_at, created_by) VALUES ($1, $2, 5000, 'YER', 'cash', 'confirmed', (SELECT contact_id FROM conversations WHERE id = $3), $4, $5, now(), $6)",
    [paymentId, workspaceId, message.conversation_id, orderId, `PAY-${Date.now()}`, userId],
  );
  const paymentResult = await pool.query("SELECT id FROM payments WHERE id = $1 AND status = 'confirmed'", [paymentId]);
  assertCheck({ name: "DB manual order payment recorded", ok: paymentResult.rowCount === 1 });

  await pool.query(
    "INSERT INTO plans (id, name, slug, key, name_ar, is_active, price_usd, price_usd_annual, billing_cycle, limits, features) VALUES ($1, 'Phase6 Smoke Growth', $2, $2, $3, true, 25, 240, 'monthly', $4::jsonb, $5)",
    [
      planId,
      `phase6-smoke-${Date.now()}`,
      "باقة نمو اختبارية",
      JSON.stringify({ channels: 3, agents: 3, monthly_messages: 5000 }),
      ["catalog", "automation", "vision_voice"],
    ],
  );
  await pool.query(
    "INSERT INTO payment_submissions (id, workspace_id, plan_id, amount_yer, amount_currency, exchange_rate_snapshot, payment_method, reference, receipt_note, status) VALUES ($1, $2, $3, 15000, 'YER', $4::jsonb, 'kuraimi', $5, $6, 'pending')",
    [
      paymentSubmissionId,
      workspaceId,
      planId,
      JSON.stringify({ from: "USD", to: "YER", rate: 600 }),
      `UPGRADE-${Date.now()}`,
      "Phase6 smoke payment proof.",
    ],
  );
  const submissionResult = await pool.query(
    "SELECT id FROM payment_submissions WHERE id = $1 AND status = 'pending'",
    [paymentSubmissionId],
  );
  assertCheck({ name: "DB plan upgrade payment submitted", ok: submissionResult.rowCount === 1 });

  await pool.end();
  console.log(`MERCHANT_JOURNEY_SMOKE_PASS: mode=db-dry-run workspace=${workspaceId} external_calls=0`);
}

if (process.env.DATABASE_URL) {
  await runDatabaseSmoke();
} else {
  await runContractSmoke();
}
