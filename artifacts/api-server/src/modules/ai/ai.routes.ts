import { Router, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  aiAgentsTable, aiAgentVersionsTable, aiAgentInstructionsTable, aiAgentChannelsTable,
  aiAgentToolsTable, aiRunsTable, aiMessagesTable, aiExtractionsTable,
  aiUsageTable, aiFeedbackTable, aiSafetyEventsTable, approvalRequestsTable,
  autoReplyDecisionsTable, outboxEventsTable, messagesTable, contactsTable, contactChannelsTable,
  conversationsTable, knowledgeChunksTable, faqEntriesTable, knowledgeDocumentsTable,
  channelAccountsTable,
  workspacesTable,
  tasksTable, learnedAnswersTable,
} from "@workspace/db";
import { eq, and, desc, gte, ilike, lte, or, sql } from "drizzle-orm";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import type { AuthenticatedRequest } from "../../lib/types";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { runAI, getProviderStatus, ACTIVE_PROVIDER, getDefaultModel, type AiMessage } from "../../lib/ai-provider";
import { checkActionSafety, recordSafetyBlock, isSuggestionSafe } from "../../lib/ai-safety";
import { aiRunLimiter } from "../../lib/rateLimiter";
import { runAgentReply, simulateAgentReply } from "../../lib/agent-reply";
import { defaultAgentToolPolicies, loadMetaStoreContext } from "../../lib/agent-tools";
import { loadSectorAgentContext } from "../../lib/agent-sector";
import { logger } from "../../lib/logger";
import { appendTurn, clear as clearAgentMemory, loadContext, rotate, shouldRotate } from "../../services/agent-memory";
import { searchKnowledgeForAi } from "../../services/knowledge-retrieval";
import { shouldAutoSend, type TrustDecision } from "../../services/trust-gate";
import { loadLearnedContext } from "../../services/agent-learning";
import { loadMediaContext } from "../../services/agent-media";
import { checkLimit } from "../../services/billing";
import { notifyWorkspace } from "../../services/notifications";
import { resolveWhatsAppConversationRecipient } from "../integrations/whatsapp-contact-identity";

const router = Router();
router.use(requireSession);

// ─── Provider Status ─────────────────────────────────────────────────────────

router.get("/provider-status", requirePermission("ai:read"), (req: AuthenticatedRequest, res: Response): void => {
  res.json(getProviderStatus());
});

router.get("/conversations/:id/memory", requirePermission("ai:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const parse = z.object({ agentId: z.string().uuid().optional() }).safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() });
    return;
  }

  const conversationId = String(req.params.id);
  const [conversation] = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!conversation) {
    res.status(404).json({ error: "المحادثة غير موجودة" });
    return;
  }

  const context = await loadContext(activeWorkspaceId, conversationId, parse.data.agentId ?? null);
  res.json({
    memory: {
      id: context.snapshot.id,
      conversationId,
      agentId: context.snapshot.agentId,
      summary: context.summary,
      recentTurns: context.recentTurns,
      lastMessageId: context.snapshot.lastMessageId,
      tokenEstimate: context.tokenEstimate,
      updatedAt: context.snapshot.updatedAt,
    },
  });
});

router.delete("/conversations/:id/memory", requirePermission("ai:manage"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const parse = z.object({ agentId: z.string().uuid().optional() }).safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() });
    return;
  }

  const conversationId = String(req.params.id);
  const [conversation] = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!conversation) {
    res.status(404).json({ error: "المحادثة غير موجودة" });
    return;
  }

  await clearAgentMemory(activeWorkspaceId, conversationId, parse.data.agentId ?? null);
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "agent_memory_clear",
    severity: "info",
    entityType: "conversation",
    entityId: conversationId,
    newData: { agentId: parse.data.agentId ?? null },
  });
  res.json({ ok: true });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function upsertUsage(params: {
  workspaceId: string;
  model: string;
  provider: string;
  taskType: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCost: number;
}): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const existing = await db
    .select()
    .from(aiUsageTable)
    .where(
      and(
        eq(aiUsageTable.workspaceId, params.workspaceId),
        eq(aiUsageTable.date, today),
        eq(aiUsageTable.model, params.model),
        eq(aiUsageTable.provider, params.provider),
        eq(aiUsageTable.taskType, params.taskType)
      )
    )
    .limit(1);

  const totalTokens = params.promptTokens + params.completionTokens;
  if (existing.length > 0) {
    await db
      .update(aiUsageTable)
      .set({
        totalRuns: sql`${aiUsageTable.totalRuns} + 1`,
        totalTokens: sql`${aiUsageTable.totalTokens} + ${totalTokens}`,
        estimatedCost: sql`COALESCE(${aiUsageTable.estimatedCost}, 0) + ${params.estimatedCost}`,
      })
      .where(eq(aiUsageTable.id, existing[0].id));
  } else {
    await db.insert(aiUsageTable).values({
      workspaceId: params.workspaceId,
      date: today,
      model: params.model,
      provider: params.provider,
      taskType: params.taskType,
      totalRuns: 1,
      totalTokens,
      estimatedCost: String(params.estimatedCost),
    });
  }
}

type KnowledgeAiSource = {
  type: "faq" | "document" | "chunk";
  id: string;
  title: string;
  content: string;
  score?: number;
};

function knowledgeSearchWords(query: string): string[] {
  return query
    .split(/\s+/)
    .map((w) => w.trim().replace(/[؟?،,.;:!]/g, ""))
    .filter((w) => w.length > 2)
    .slice(0, 5);
}

function normalizeKnowledgeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[؟?،,.;:!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreKnowledgeSource(source: KnowledgeAiSource, query: string, words: string[]): number {
  const title = normalizeKnowledgeText(source.title);
  const content = normalizeKnowledgeText(source.content);
  const normalizedQuery = normalizeKnowledgeText(query);
  let score = source.type === "faq" ? 3 : source.type === "document" ? 1 : 0;

  if (title.includes(normalizedQuery)) score += 30;
  if (content.includes(normalizedQuery)) score += 20;

  for (const word of words) {
    const normalizedWord = normalizeKnowledgeText(word);
    if (!normalizedWord) continue;
    if (title.includes(normalizedWord)) score += 6;
    if (content.includes(normalizedWord)) score += 2;
  }

  return score;
}

async function searchKnowledgeDetailed(workspaceId: string, query: string, baseId?: string): Promise<KnowledgeAiSource[]> {
  if (!query || query.length < 3) return [];
  const retrieved = await searchKnowledgeForAi({
    workspaceId,
    query,
    knowledgeBaseIds: baseId ? [baseId] : undefined,
    limit: 5,
  });
  return retrieved.map((source) => ({
    type: source.type,
    id: source.id,
    title: source.title,
    content: source.content,
    score: source.score,
  }));
  try {
    const words = knowledgeSearchWords(query);
    if (words.length === 0) return [];

    const faqConditions = [
      eq(faqEntriesTable.workspaceId, workspaceId),
      eq(faqEntriesTable.status, "active"),
      or(...words.flatMap((w) => [
        ilike(faqEntriesTable.question, `%${w}%`),
        ilike(faqEntriesTable.answer, `%${w}%`),
      ]))!,
    ];
    if (baseId) faqConditions.splice(1, 0, eq(faqEntriesTable.knowledgeBaseId, baseId as string));

    const docConditions = [
      eq(knowledgeDocumentsTable.workspaceId, workspaceId),
      or(...words.flatMap((w) => [
        ilike(knowledgeDocumentsTable.title, `%${w}%`),
        ilike(knowledgeDocumentsTable.contentText, `%${w}%`),
      ]))!,
    ];
    if (baseId) docConditions.splice(1, 0, eq(knowledgeDocumentsTable.knowledgeBaseId, baseId as string));

    const chunkConditions = [
      eq(knowledgeChunksTable.workspaceId, workspaceId),
      or(...words.map((w) => ilike(knowledgeChunksTable.chunkText, `%${w}%`)))!,
    ];
    if (baseId) chunkConditions.splice(1, 0, eq(knowledgeChunksTable.knowledgeBaseId, baseId as string));

    const faqs = await db
      .select({ id: faqEntriesTable.id, question: faqEntriesTable.question, answer: faqEntriesTable.answer })
      .from(faqEntriesTable)
      .where(and(...faqConditions))
      .limit(10);

    const docs = await db
      .select({ id: knowledgeDocumentsTable.id, title: knowledgeDocumentsTable.title, contentText: knowledgeDocumentsTable.contentText })
      .from(knowledgeDocumentsTable)
      .where(and(...docConditions))
      .limit(5);

    const chunks = await db
      .select({ id: knowledgeChunksTable.id, chunkText: knowledgeChunksTable.chunkText, chunkIndex: knowledgeChunksTable.chunkIndex })
      .from(knowledgeChunksTable)
      .where(and(...chunkConditions))
      .limit(5);

    const sources: KnowledgeAiSource[] = [
      ...faqs.map((faq) => ({
        type: "faq" as const,
        id: faq.id,
        title: faq.question,
        content: `سؤال: ${faq.question}\nإجابة: ${faq.answer}`,
      })),
      ...docs.map((doc) => ({
        type: "document" as const,
        id: doc.id,
        title: doc.title,
        content: doc.contentText.slice(0, 1200),
      })),
      ...chunks.map((chunk) => ({
        type: "chunk" as const,
        id: chunk.id,
        title: `مقطع معرفة ${chunk.chunkIndex + 1}`,
        content: chunk.chunkText,
      })),
    ];

    const seen = new Set<string>();
    return sources.filter((source) => {
      const key = `${source.type}:${source.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => scoreKnowledgeSource(b, query, words) - scoreKnowledgeSource(a, query, words)).slice(0, 5);
  } catch {
    return [];
  }
}

async function resolveAutoReplyDestination(
  workspaceId: string,
  conversation: typeof conversationsTable.$inferSelect
): Promise<{ channelAccountId: string | null; to: string | null; recipientIdentityType?: string }> {
  let channelAccountId = conversation.channelAccountId;
  if (!channelAccountId) {
    const [account] = await db
      .select({ id: channelAccountsTable.id })
      .from(channelAccountsTable)
      .where(and(eq(channelAccountsTable.workspaceId, workspaceId), eq(channelAccountsTable.channelType, "whatsapp")))
      .limit(1);
    channelAccountId = account?.id ?? null;
  }

  if (channelAccountId) {
    const recipient = await resolveWhatsAppConversationRecipient({
      workspaceId,
      channelAccountId,
      contactId: conversation.contactId,
      contactChannelId: conversation.contactChannelId,
      externalThreadId: conversation.externalThreadId,
    });
    if (recipient.ok) return { channelAccountId, to: recipient.to, recipientIdentityType: recipient.identityType };
    return { channelAccountId, to: null };
  }

  if (conversation.contactChannelId) {
    const [channel] = await db
      .select({ normalizedIdentifier: contactChannelsTable.normalizedIdentifier })
      .from(contactChannelsTable)
      .where(and(eq(contactChannelsTable.id, conversation.contactChannelId), eq(contactChannelsTable.workspaceId, workspaceId)))
      .limit(1);
    if (channel?.normalizedIdentifier) return { channelAccountId, to: channel.normalizedIdentifier };
  }

  if (conversation.contactId) {
    const [channel] = await db
      .select({ normalizedIdentifier: contactChannelsTable.normalizedIdentifier })
      .from(contactChannelsTable)
      .where(and(eq(contactChannelsTable.contactId, conversation.contactId), eq(contactChannelsTable.workspaceId, workspaceId)))
      .limit(1);
    if (channel?.normalizedIdentifier) return { channelAccountId, to: channel.normalizedIdentifier };

    const [contact] = await db
      .select({ phone: contactsTable.phone })
      .from(contactsTable)
      .where(and(eq(contactsTable.id, conversation.contactId), eq(contactsTable.workspaceId, workspaceId)))
      .limit(1);
    if (contact?.phone) return { channelAccountId, to: contact.phone };
  }

  return { channelAccountId, to: null };
}

async function searchKnowledge(workspaceId: string, query: string): Promise<string[]> {
  const sources = await searchKnowledgeDetailed(workspaceId, query);
  return sources.map((source) => source.content);
}

const DEFAULT_CHANNEL_GUIDANCE: Record<string, string> = {
  whatsapp: "اجعل الرد ودودًا ومباشرًا، ويمكن أن يكون أطول قليلًا إذا احتاج العميل إلى شرح.",
  whatsapp_api: "اجعل الرد ودودًا ومباشرًا، ويمكن أن يكون أطول قليلًا إذا احتاج العميل إلى شرح.",
  whatsapp_manual: "اجعل الرد ودودًا ومباشرًا، ويمكن أن يكون أطول قليلًا إذا احتاج العميل إلى شرح.",
  instagram: "اجعل الرد قصيرًا ولطيفًا وسهل القراءة. يمكن استخدام تعبير خفيف عند الحاجة دون مبالغة.",
  messenger: "اجعل الرد مختصرًا ومفيدًا، وركّز على الخطوة التالية بوضوح.",
};

function channelGuidance(channel?: string | null, channelTone?: unknown): string {
  const normalized = (channel || "manual").toLowerCase();
  const overrides = channelTone && typeof channelTone === "object" && !Array.isArray(channelTone)
    ? channelTone as Record<string, unknown>
    : {};
  const override = typeof overrides[normalized] === "string" ? String(overrides[normalized]).trim() : "";
  const guidance = override || DEFAULT_CHANNEL_GUIDANCE[normalized] || "اجعل الرد مهنيًا وواضحًا ومناسبًا لطبيعة القناة.";
  return `أنت ترد عبر قناة ${normalized}. ${guidance}`;
}

// loadSectorAgentContext انتقلت إلى ../../lib/agent-sector ليستهلكها المسار الحي أيضاً.

function hasStrongKnowledgeHit(sources: KnowledgeAiSource[]): boolean {
  if (sources.length === 0) return false;
  return sources.some((source) => typeof source.score !== "number" || source.score >= 0.2);
}

const YEMENI_GOVERNORATES = [
  "صنعاء", "عدن", "تعز", "الحديدة", "إب", "ذمار", "حضرموت", "المهرة", "حجة", "صعدة",
  "عمران", "البيضاء", "أبين", "لحج", "الضالع", "مأرب", "الجوف", "شبوة", "ريمة", "المحويت",
];

async function loadLocationContext(workspaceId: string, conversation: (typeof conversationsTable.$inferSelect) | null): Promise<string> {
  const [workspace] = await db.select({ settings: workspacesTable.settings }).from(workspacesTable).where(eq(workspacesTable.id, workspaceId)).limit(1);
  const settings = workspace?.settings && typeof workspace.settings === "object" && !Array.isArray(workspace.settings)
    ? workspace.settings as Record<string, unknown>
    : {};
  const governorate = typeof settings.governorate === "string" && YEMENI_GOVERNORATES.includes(settings.governorate) ? settings.governorate : "";
  const district = typeof settings.district === "string" ? settings.district : "";
  let customerCity = "";
  let customerLocationNote = "";
  if (conversation?.contactId) {
    const [contact] = await db.select({ city: contactsTable.city, locationNote: contactsTable.locationNote }).from(contactsTable)
      .where(and(eq(contactsTable.id, conversation.contactId), eq(contactsTable.workspaceId, workspaceId)))
      .limit(1);
    customerCity = contact?.city ?? "";
    customerLocationNote = contact?.locationNote ?? "";
  }
  const lines = [
    "سياق الموقع:",
    governorate ? `موقع التاجر: ${governorate}${district ? ` - ${district}` : ""}` : "موقع التاجر غير محدد.",
    customerCity || customerLocationNote ? `موقع العميل المعروف: ${[customerCity, customerLocationNote].filter(Boolean).join(" - ")}` : "موقع العميل غير معروف.",
    "إذا سأل العميل عن التوصيل وموقعه غير معروف، اسأله: من أي منطقة تطلب؟ قبل ذكر التوصيل أو التكلفة.",
  ];
  return lines.join("\n");
}

// ─── AI Agents ───────────────────────────────────────────────────────────────

const agentCreateSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب").max(200),
  type: z.enum(["support", "sales", "followup", "summarizer", "classifier", "reports", "collections"]).default("support"),
  defaultModel: z.enum(["gemini_flash", "gemini_flash_lite", "gemini_pro", "mock"]).default("gemini_flash"),
  temperature: z.coerce.number().min(0).max(2).default(0.3),
  maxOutputTokens: z.coerce.number().int().min(128).max(8192).default(1024),
  knowledgeBaseIds: z.array(z.string().uuid()).default([]),
  dialect: z.enum(["standard_arabic", "yemeni_light", "yemeni_business"]).default("standard_arabic"),
  tone: z.string().trim().max(200).optional().nullable(),
  channelTone: z.record(z.string().trim().max(600)).optional().default({}),
  sectorKey: z.string().trim().min(2).max(80).default("services_general"),
  sectorBehaviorOverrides: z.record(z.unknown()).optional().default({}),
});

const agentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  type: z.enum(["support", "sales", "followup", "summarizer", "classifier", "reports", "collections"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  defaultModel: z.enum(["gemini_flash", "gemini_flash_lite", "gemini_pro", "mock"]).optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  maxOutputTokens: z.coerce.number().int().min(128).max(8192).optional(),
  knowledgeBaseIds: z.array(z.string().uuid()).optional(),
  dialect: z.enum(["standard_arabic", "yemeni_light", "yemeni_business"]).optional(),
  tone: z.string().trim().max(200).optional().nullable(),
  channelTone: z.record(z.string().trim().max(600)).optional(),
  sectorKey: z.string().trim().min(2).max(80).optional(),
  sectorBehaviorOverrides: z.record(z.unknown()).optional(),
  trustMode: z.enum(["suggest", "auto", "auto_after_hours"]).optional(),
  trustConfidenceThreshold: z.coerce.number().min(0.5).max(0.95).optional(),
  trustTopics: z.array(z.string().trim().min(1).max(100)).optional(),
  trustBlocklist: z.array(z.string().trim().min(1).max(100)).optional(),
  maxAutoRepliesPerConversation: z.coerce.number().int().min(0).max(50).optional(),
  escalateAfterFailedAuto: z.coerce.number().int().min(0).max(20).optional(),
  dailyAutoSendQuota: z.coerce.number().int().min(0).max(10000).optional(),
});

router.get("/agents", requirePermission("ai:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const agents = await db
    .select()
    .from(aiAgentsTable)
    .where(eq(aiAgentsTable.workspaceId, activeWorkspaceId))
    .orderBy(desc(aiAgentsTable.createdAt));
  res.json({ agents });
});

router.post("/agents", requirePermission("ai:configure"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const parse = agentCreateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() });
    return;
  }
  const data = parse.data;
  const agentLimit = await checkLimit(activeWorkspaceId, "agents");
  if (!agentLimit.allowed) {
    res.status(402).json({
      error: "وصلت حد باقتك لعدد الوكلاء. يمكنك ترقية الباقة لإضافة وكلاء جدد.",
      code: "plan_limit_reached",
      limit: agentLimit,
    });
    return;
  }
  const [agent] = await db.insert(aiAgentsTable).values({
    workspaceId: activeWorkspaceId,
    name: data.name,
    type: data.type,
    defaultModel: data.defaultModel,
    temperature: String(data.temperature),
    maxOutputTokens: data.maxOutputTokens,
    knowledgeBaseIds: data.knowledgeBaseIds,
    dialect: data.dialect,
    tone: data.tone ?? null,
    channelTone: data.channelTone,
    sectorKey: data.sectorKey,
    sectorBehaviorOverrides: data.sectorBehaviorOverrides,
    status: "active",
    createdBy: userId,
  }).returning();

  // الافتراضي المزروع يطابق افتراضي وقت التشغيل في agent-reply — الصيغة القديمة («وكيل ذكاء
  // اصطناعي لنظام CRM») كانت تتغلّب على الافتراضي القوي لمجرّد وجود الصف، وتكسر محمية إخفاء
  // التقنية وتثبّت هوية غير بشرية لكل وكيل جديد لم يكتب التاجر له دوراً مخصّصاً.
  await db.insert(aiAgentInstructionsTable).values({
    workspaceId: activeWorkspaceId,
    agentId: agent.id,
    rolePrompt: "أنت موظف مبيعات وخدمة عملاء حقيقي، ودود ومحترف، تردّ على عملاء النشاط التجاري بأسلوب إنساني طبيعي. تفاعل مع آخر رسالة من العميل مباشرةً.",
  });

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "ai_agent_create",
    entityType: "ai_agent",
    entityId: agent.id,
    entityLabel: agent.name,
    newData: data,
  });

  res.status(201).json({ agent });
});

router.get("/agents/:id", requirePermission("ai:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const agentId = String(req.params.id);
  const [agent] = await db.select().from(aiAgentsTable).where(
    and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.workspaceId, activeWorkspaceId))
  );
  if (!agent) { res.status(404).json({ error: "الوكيل غير موجود" }); return; }

  const [instructions] = await db.select().from(aiAgentInstructionsTable).where(
    and(eq(aiAgentInstructionsTable.agentId, agentId), eq(aiAgentInstructionsTable.workspaceId, activeWorkspaceId))
  );
  const tools = await db.select().from(aiAgentToolsTable).where(
    and(eq(aiAgentToolsTable.agentId, agentId), eq(aiAgentToolsTable.workspaceId, activeWorkspaceId))
  );
  const versions = await db.select().from(aiAgentVersionsTable).where(
    and(eq(aiAgentVersionsTable.agentId, agentId), eq(aiAgentVersionsTable.workspaceId, activeWorkspaceId))
  ).orderBy(desc(aiAgentVersionsTable.versionNumber)).limit(5);
  const channels = await db
    .select({
      id: aiAgentChannelsTable.id,
      mode: aiAgentChannelsTable.mode,
      channelAccountId: aiAgentChannelsTable.channelAccountId,
      channelType: channelAccountsTable.channelType,
      displayName: channelAccountsTable.displayName,
    })
    .from(aiAgentChannelsTable)
    .leftJoin(channelAccountsTable, eq(aiAgentChannelsTable.channelAccountId, channelAccountsTable.id))
    .where(and(eq(aiAgentChannelsTable.agentId, agentId), eq(aiAgentChannelsTable.workspaceId, activeWorkspaceId)));
  const runs = await db
    .select()
    .from(aiRunsTable)
    .where(and(eq(aiRunsTable.agentId, agentId), eq(aiRunsTable.workspaceId, activeWorkspaceId)))
    .orderBy(desc(aiRunsTable.createdAt))
    .limit(20);

  res.json({ agent, instructions: instructions ?? null, tools, versions, channels, runs });
});

router.get("/agents/:id/auto-decisions", requirePermission("ai:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const agentId = String(req.params.id);
  const [agent] = await db.select({ id: aiAgentsTable.id }).from(aiAgentsTable).where(
    and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.workspaceId, activeWorkspaceId))
  ).limit(1);
  if (!agent) { res.status(404).json({ error: "الوكيل غير موجود" }); return; }

  const filters = [
    eq(autoReplyDecisionsTable.workspaceId, activeWorkspaceId),
    eq(autoReplyDecisionsTable.agentId, agentId),
  ];
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
  if (from && Number.isFinite(from.getTime())) filters.push(gte(autoReplyDecisionsTable.createdAt, from));
  if (to && Number.isFinite(to.getTime())) filters.push(lte(autoReplyDecisionsTable.createdAt, to));

  const decisions = await db
    .select()
    .from(autoReplyDecisionsTable)
    .where(and(...filters))
    .orderBy(desc(autoReplyDecisionsTable.createdAt))
    .limit(100);

  res.json({ decisions });
});

router.get("/agents/:id/learned-answers", requirePermission("ai:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const agentId = String(req.params.id);
  const [agent] = await db.select({ id: aiAgentsTable.id }).from(aiAgentsTable).where(
    and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.workspaceId, activeWorkspaceId))
  ).limit(1);
  if (!agent) { res.status(404).json({ error: "الوكيل غير موجود" }); return; }
  const answers = await db.select().from(learnedAnswersTable)
    .where(eq(learnedAnswersTable.workspaceId, activeWorkspaceId))
    .orderBy(desc(learnedAnswersTable.createdAt))
    .limit(100);
  res.json({ answers });
});

const learnedAnswerUpdateSchema = z.object({
  questionPattern: z.string().trim().min(2).max(500).optional(),
  bestAnswer: z.string().trim().min(2).max(4000).optional(),
  status: z.enum(["active", "pending_review"]).optional(),
  topicSensitivity: z.enum(["simple", "sensitive"]).optional(),
});

router.patch("/learned-answers/:id", requirePermission("ai:configure"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const parse = learnedAnswerUpdateSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() }); return; }
  const updates: Record<string, unknown> = {};
  if (parse.data.questionPattern !== undefined) updates.questionPattern = parse.data.questionPattern;
  if (parse.data.bestAnswer !== undefined) updates.bestAnswer = parse.data.bestAnswer;
  if (parse.data.status !== undefined) updates.status = parse.data.status;
  if (parse.data.topicSensitivity !== undefined) updates.topicSensitivity = parse.data.topicSensitivity;
  const [answer] = await db.update(learnedAnswersTable).set(updates)
    .where(and(eq(learnedAnswersTable.id, String(req.params.id)), eq(learnedAnswersTable.workspaceId, activeWorkspaceId)))
    .returning();
  if (!answer) { res.status(404).json({ error: "الإجابة المتعلمة غير موجودة" }); return; }
  res.json({ answer });
});

router.delete("/learned-answers/:id", requirePermission("ai:configure"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const [answer] = await db.update(learnedAnswersTable).set({ status: "pending_review" })
    .where(and(eq(learnedAnswersTable.id, String(req.params.id)), eq(learnedAnswersTable.workspaceId, activeWorkspaceId)))
    .returning();
  if (!answer) { res.status(404).json({ error: "الإجابة المتعلمة غير موجودة" }); return; }
  res.json({ ok: true });
});

router.patch("/agents/:id", requirePermission("ai:configure"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const agentId = String(req.params.id);
  const [existing] = await db.select().from(aiAgentsTable).where(
    and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.workspaceId, activeWorkspaceId))
  );
  if (!existing) { res.status(404).json({ error: "الوكيل غير موجود" }); return; }

  const parse = agentUpdateSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() }); return; }

  const data = parse.data;
  const updates = {
    ...(data.name !== undefined && { name: data.name }),
    ...(data.type !== undefined && { type: data.type }),
    ...(data.status !== undefined && { status: data.status }),
    ...(data.defaultModel !== undefined && { defaultModel: data.defaultModel }),
    ...(data.temperature !== undefined && { temperature: String(data.temperature) }),
    ...(data.maxOutputTokens !== undefined && { maxOutputTokens: data.maxOutputTokens }),
    ...(data.knowledgeBaseIds !== undefined && { knowledgeBaseIds: data.knowledgeBaseIds }),
    ...(data.dialect !== undefined && { dialect: data.dialect }),
    ...(data.tone !== undefined && { tone: data.tone ?? null }),
    ...(data.channelTone !== undefined && { channelTone: data.channelTone }),
    ...(data.sectorKey !== undefined && { sectorKey: data.sectorKey }),
    ...(data.sectorBehaviorOverrides !== undefined && { sectorBehaviorOverrides: data.sectorBehaviorOverrides }),
    ...(data.trustMode !== undefined && { trustMode: data.trustMode }),
    ...(data.trustConfidenceThreshold !== undefined && { trustConfidenceThreshold: String(data.trustConfidenceThreshold) }),
    ...(data.trustTopics !== undefined && { trustTopics: data.trustTopics }),
    ...(data.trustBlocklist !== undefined && { trustBlocklist: data.trustBlocklist }),
    ...(data.maxAutoRepliesPerConversation !== undefined && { maxAutoRepliesPerConversation: data.maxAutoRepliesPerConversation }),
    ...(data.escalateAfterFailedAuto !== undefined && { escalateAfterFailedAuto: data.escalateAfterFailedAuto }),
    ...(data.dailyAutoSendQuota !== undefined && { dailyAutoSendQuota: data.dailyAutoSendQuota }),
  };
  const [agent] = await db.update(aiAgentsTable).set({
    ...updates,
    updatedAt: new Date(),
  }).where(and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.workspaceId, activeWorkspaceId))).returning();

  const action = data.status === "disabled" ? "ai_agent_disable" : "ai_agent_update";
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action,
    entityType: "ai_agent",
    entityId: agentId,
    entityLabel: existing.name,
    oldData: existing as unknown as Record<string, unknown>,
    newData: data,
  });

  res.json({ agent });
});

router.post("/agents/:id/duplicate", requirePermission("ai:configure"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const agentId = String(req.params.id);
  const [existing] = await db.select().from(aiAgentsTable).where(
    and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.workspaceId, activeWorkspaceId))
  );
  if (!existing) { res.status(404).json({ error: "الوكيل غير موجود" }); return; }

  const [instructions] = await db.select().from(aiAgentInstructionsTable).where(
    and(eq(aiAgentInstructionsTable.agentId, agentId), eq(aiAgentInstructionsTable.workspaceId, activeWorkspaceId))
  );

  const [agent] = await db.insert(aiAgentsTable).values({
    workspaceId: activeWorkspaceId,
    name: `${existing.name} copy`,
    type: existing.type,
    status: "active",
    defaultModel: existing.defaultModel,
    temperature: existing.temperature,
    maxOutputTokens: existing.maxOutputTokens,
    knowledgeBaseIds: existing.knowledgeBaseIds,
    dialect: existing.dialect,
    tone: existing.tone,
    channelTone: existing.channelTone,
    sectorKey: existing.sectorKey,
    sectorBehaviorOverrides: existing.sectorBehaviorOverrides,
    trustMode: existing.trustMode,
    trustConfidenceThreshold: existing.trustConfidenceThreshold,
    trustTopics: existing.trustTopics,
    trustBlocklist: existing.trustBlocklist,
    maxAutoRepliesPerConversation: existing.maxAutoRepliesPerConversation,
    escalateAfterFailedAuto: existing.escalateAfterFailedAuto,
    dailyAutoSendQuota: existing.dailyAutoSendQuota,
    createdBy: userId,
  }).returning();

  if (instructions) {
    await db.insert(aiAgentInstructionsTable).values({
      workspaceId: activeWorkspaceId,
      agentId: agent.id,
      rolePrompt: instructions.rolePrompt,
      businessRules: instructions.businessRules,
      forbiddenActions: instructions.forbiddenActions,
      escalationRules: instructions.escalationRules,
    });
  }

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "ai_agent_duplicate",
    entityType: "ai_agent",
    entityId: agent.id,
    entityLabel: agent.name,
    newData: { sourceAgentId: agentId },
  });

  res.status(201).json({ agent });
});

router.delete("/agents/:id", requirePermission("ai:configure"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const agentId = String(req.params.id);
  const [existing] = await db.select().from(aiAgentsTable).where(
    and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.workspaceId, activeWorkspaceId))
  );
  if (!existing) { res.status(404).json({ error: "الوكيل غير موجود" }); return; }

  await db.delete(aiAgentsTable).where(and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.workspaceId, activeWorkspaceId)));
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "ai_agent_delete",
    severity: "warning",
    entityType: "ai_agent",
    entityId: agentId,
    entityLabel: existing.name,
    oldData: { status: existing.status },
  });

  res.json({ message: "تم حذف الوكيل" });
});

router.post("/agents/:id/versions", requirePermission("ai:configure"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const agentId = String(req.params.id);
  const [agent] = await db.select().from(aiAgentsTable).where(
    and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.workspaceId, activeWorkspaceId))
  );
  if (!agent) { res.status(404).json({ error: "الوكيل غير موجود" }); return; }

  const [instructions] = await db.select().from(aiAgentInstructionsTable).where(
    and(eq(aiAgentInstructionsTable.agentId, agentId), eq(aiAgentInstructionsTable.workspaceId, activeWorkspaceId))
  );
  const tools = await db.select().from(aiAgentToolsTable).where(
    and(eq(aiAgentToolsTable.agentId, agentId), eq(aiAgentToolsTable.workspaceId, activeWorkspaceId))
  );

  const latestVersions = await db.select({ vn: aiAgentVersionsTable.versionNumber }).from(aiAgentVersionsTable).where(
    and(eq(aiAgentVersionsTable.agentId, agentId), eq(aiAgentVersionsTable.workspaceId, activeWorkspaceId))
  ).orderBy(desc(aiAgentVersionsTable.versionNumber)).limit(1);

  const nextVersion = (latestVersions[0]?.vn ?? 0) + 1;

  const [version] = await db.insert(aiAgentVersionsTable).values({
    workspaceId: activeWorkspaceId,
    agentId,
    versionNumber: nextVersion,
    status: "active",
    instructionsSnapshot: instructions ? { rolePrompt: instructions.rolePrompt, businessRules: instructions.businessRules, forbiddenActions: instructions.forbiddenActions, escalationRules: instructions.escalationRules } : {},
    toolsSnapshot: { tools: tools.map((t) => ({ toolKey: t.toolKey, isEnabled: t.isEnabled, requiresApproval: t.requiresApproval })) },
    modelConfig: { defaultModel: agent.defaultModel, temperature: agent.temperature, maxOutputTokens: agent.maxOutputTokens, dialect: agent.dialect, tone: agent.tone },
    createdBy: userId,
  }).returning();

  res.status(201).json({ version });
});

const instructionsSchema = z.object({
  rolePrompt: z.string().trim().min(1, "التعليمات الأساسية مطلوبة").max(10000),
  businessRules: z.string().trim().max(5000).optional().nullable(),
  forbiddenActions: z.string().trim().max(5000).optional().nullable(),
  escalationRules: z.string().trim().max(5000).optional().nullable(),
});

router.patch("/agents/:id/instructions", requirePermission("ai:configure"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const agentId = String(req.params.id);
  const [agent] = await db.select().from(aiAgentsTable).where(
    and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.workspaceId, activeWorkspaceId))
  );
  if (!agent) { res.status(404).json({ error: "الوكيل غير موجود" }); return; }

  const parse = instructionsSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() }); return; }
  const data = parse.data;

  const existing = await db.select().from(aiAgentInstructionsTable).where(
    and(eq(aiAgentInstructionsTable.agentId, agentId), eq(aiAgentInstructionsTable.workspaceId, activeWorkspaceId))
  );

  let instructions;
  if (existing.length > 0) {
    [instructions] = await db.update(aiAgentInstructionsTable).set({
      ...data,
      updatedAt: new Date(),
    }).where(and(
      eq(aiAgentInstructionsTable.id, existing[0].id),
      eq(aiAgentInstructionsTable.workspaceId, activeWorkspaceId)
    )).returning();
  } else {
    [instructions] = await db.insert(aiAgentInstructionsTable).values({
      workspaceId: activeWorkspaceId,
      agentId,
      ...data,
    }).returning();
  }

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "ai_agent_update",
    entityType: "ai_agent_instructions",
    entityId: agentId,
    entityLabel: agent.name,
    newData: data,
  });

  res.json({ instructions });
});

router.get("/agents/:id/tools", requirePermission("ai:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const agentId = String(req.params.id);
  const [agent] = await db.select().from(aiAgentsTable).where(
    and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.workspaceId, activeWorkspaceId))
  );
  if (!agent) { res.status(404).json({ error: "الوكيل غير موجود" }); return; }
  const tools = await db.select().from(aiAgentToolsTable).where(
    and(eq(aiAgentToolsTable.agentId, agentId), eq(aiAgentToolsTable.workspaceId, activeWorkspaceId))
  );
  // 9 يوليو 2026: صفر صفوف يعني أدوات افتراضية فعّالة فعلياً في مسار الرد الحيّ
  // (loadExecutableAgentTools) — يجب أن تعرض الواجهة نفس الواقع بدل قائمة فارغة توحي بأن
  // الوكيل عاجز. لا يوجد استهلاك حالي لهذا المسار في الواجهة (web) — isDefault إضافة آمنة
  // لا تكسر أي عميل موجود، وتُميّز هذه الصفوف الافتراضية (غير محفوظة فعلياً في الجدول) عمّا
  // خصّصه التاجر صراحةً.
  if (tools.length === 0) {
    const now = new Date();
    const defaultTools = defaultAgentToolPolicies().map((policy) => ({
      id: `default:${policy.key}`,
      workspaceId: activeWorkspaceId,
      agentId,
      toolKey: policy.key,
      isEnabled: true,
      requiresApproval: policy.requiresApproval,
      config: policy.config,
      createdAt: now,
      updatedAt: now,
      isDefault: true,
    }));
    res.json({ tools: defaultTools });
    return;
  }
  res.json({ tools });
});

const toolUpsertSchema = z.object({
  toolKey: z.string().trim().min(1).max(100),
  isEnabled: z.boolean(),
  requiresApproval: z.boolean().default(true),
  config: z.record(z.unknown()).optional(),
});

router.patch("/agents/:id/tools", requirePermission("ai:configure"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const agentId = String(req.params.id);
  const [agent] = await db.select().from(aiAgentsTable).where(
    and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.workspaceId, activeWorkspaceId))
  );
  if (!agent) { res.status(404).json({ error: "الوكيل غير موجود" }); return; }

  const parse = toolUpsertSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() }); return; }
  const data = parse.data;

  const safety = checkActionSafety(data.toolKey);
  if (safety.blocked) {
    const isFinancialOrPrivileged = [
      "payment.confirm", "payment.reject", "payment.update_status", "payment.refund",
      "debt.write_off", "debt.cancel", "role.change", "role.assign", "role.remove",
      "user.delete", "data.delete", "data.bulk_delete",
    ].some((a) => data.toolKey.toLowerCase().includes(a.toLowerCase()));
    const severity = isFinancialOrPrivileged ? "critical" : "high";

    await recordSafetyBlock({
      workspaceId: activeWorkspaceId,
      aiRunId: null,
      blockedAction: data.toolKey,
      reason: safety.reason ?? `تم منع تفعيل الأداة: ${data.toolKey}`,
      severity: severity as "high" | "critical",
      payload: { agentId, toolKey: data.toolKey, actorId: userId, isEnabled: data.isEnabled },
      createdBy: userId,
    });

    res.status(400).json({ error: `لا يمكن تفعيل أداة محظورة: ${data.toolKey}`, reason: safety.reason });
    return;
  }

  const existing = await db.select().from(aiAgentToolsTable).where(
    and(
      eq(aiAgentToolsTable.agentId, agentId),
      eq(aiAgentToolsTable.workspaceId, activeWorkspaceId),
      eq(aiAgentToolsTable.toolKey, data.toolKey)
    )
  );

  let tool;
  if (existing.length > 0) {
    [tool] = await db.update(aiAgentToolsTable).set({
      isEnabled: data.isEnabled,
      requiresApproval: data.requiresApproval,
      config: data.config ?? {},
      updatedAt: new Date(),
    }).where(and(
      eq(aiAgentToolsTable.id, existing[0].id),
      eq(aiAgentToolsTable.workspaceId, activeWorkspaceId)
    )).returning();
  } else {
    [tool] = await db.insert(aiAgentToolsTable).values({
      workspaceId: activeWorkspaceId,
      agentId,
      toolKey: data.toolKey,
      isEnabled: data.isEnabled,
      requiresApproval: data.requiresApproval,
      config: data.config ?? {},
    }).returning();
  }

  res.json({ tool });
});

// ─── Agent Simulation (Playground) ────────────────────────────────────────────
// محاكاة آمنة وأمينة لردّ الوكيل الحيّ: نفس القواعد والأدوات والتوجيه، بلا أي أثر جانبي.
// "اختبر قبل التفعيل" — بوابة Fin-style قبل تفعيل الوكيل على محادثات حقيقية.

const agentSimulateSchema = z.object({
  message: z.string().trim().min(1).max(5000),
});

router.post("/agents/:id/simulate", aiRunLimiter, requirePermission("ai:use"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const agentId = String(req.params.id);
  if (!z.string().uuid().safeParse(agentId).success) {
    res.status(400).json({ error: "معرف وكيل غير صالح" });
    return;
  }

  const parse = agentSimulateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() });
    return;
  }

  try {
    const result = await simulateAgentReply({
      workspaceId: activeWorkspaceId,
      agentId,
      message: parse.data.message,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "AI_AGENT_NOT_FOUND") {
      res.status(404).json({ error: "الوكيل غير موجود" });
      return;
    }
    if ((err as { code?: string }).code === "ai_points_exhausted") {
      res.status(402).json({ error: "نفدت نقاط الذكاء — اشحن رصيدك لتجربة الوكيل" });
      return;
    }
    logger.error({ err, agentId, workspaceId: activeWorkspaceId }, "simulateAgentReply failed");
    res.status(500).json({ error: "تعذّر تشغيل المحاكاة" });
  }
});

// ─── AI Runs — List & Get ─────────────────────────────────────────────────────

router.get("/runs", requirePermission("ai:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
  const limit = Math.min(50, parseInt(String(req.query.limit ?? "20")));
  const offset = (page - 1) * limit;

  const runs = await db
    .select()
    .from(aiRunsTable)
    .where(eq(aiRunsTable.workspaceId, activeWorkspaceId))
    .orderBy(desc(aiRunsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({ runs });
});

router.get("/runs/:id", requirePermission("ai:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const runId = String(req.params.id);
  const [run] = await db.select().from(aiRunsTable).where(
    and(eq(aiRunsTable.id, runId), eq(aiRunsTable.workspaceId, activeWorkspaceId))
  );
  if (!run) { res.status(404).json({ error: "التشغيل غير موجود" }); return; }

  const messages = await db.select().from(aiMessagesTable).where(
    and(eq(aiMessagesTable.aiRunId, runId), eq(aiMessagesTable.workspaceId, activeWorkspaceId))
  ).orderBy(aiMessagesTable.createdAt);

  const extractions = await db.select().from(aiExtractionsTable).where(
    and(eq(aiExtractionsTable.aiRunId, runId), eq(aiExtractionsTable.workspaceId, activeWorkspaceId))
  );

  res.json({ run, messages, extractions });
});

// ─── AI Runs — Feedback ───────────────────────────────────────────────────────

router.post("/runs/:id/feedback", requirePermission("ai:use"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const runId = String(req.params.id);
  const parse = z.object({
    rating: z.enum(["positive", "negative", "neutral"]),
    comment: z.string().trim().max(2000).optional().nullable(),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "بيانات غير صالحة" }); return; }

  const [run] = await db.select().from(aiRunsTable).where(
    and(eq(aiRunsTable.id, runId), eq(aiRunsTable.workspaceId, activeWorkspaceId))
  );
  if (!run) { res.status(404).json({ error: "التشغيل غير موجود" }); return; }

  const [fb] = await db.insert(aiFeedbackTable).values({
    workspaceId: activeWorkspaceId,
    aiRunId: runId,
    rating: parse.data.rating,
    comment: parse.data.comment ?? null,
    createdBy: userId,
  }).returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "ai_feedback_create",
    entityType: "ai_feedback",
    entityId: fb.id,
    newData: { runId, rating: parse.data.rating },
  });

  res.status(201).json({ feedback: fb });
});

// ─── AI Usage ─────────────────────────────────────────────────────────────────

router.get("/usage", requirePermission("ai:view_usage"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const today = new Date().toISOString().split("T")[0];
  const usageRows = await db.select().from(aiUsageTable).where(
    and(eq(aiUsageTable.workspaceId, activeWorkspaceId), eq(aiUsageTable.date, today))
  );
  const totalRuns = usageRows.reduce((s, r) => s + r.totalRuns, 0);
  const totalTokens = usageRows.reduce((s, r) => s + r.totalTokens, 0);
  const provider = getProviderStatus();
  res.json({ today, usageRows, totalRuns, totalTokens, provider });
});

// ─── Safety Events ────────────────────────────────────────────────────────────

router.get("/safety-events", requirePermission("ai:view_safety"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const events = await db
    .select()
    .from(aiSafetyEventsTable)
    .where(eq(aiSafetyEventsTable.workspaceId, activeWorkspaceId))
    .orderBy(desc(aiSafetyEventsTable.createdAt))
    .limit(50);
  res.json({ events });
});

// ─── Shared run executor ──────────────────────────────────────────────────────

async function createAndRunAI(params: {
  workspaceId: string;
  userId: string;
  agentId?: string;
  taskType: string;
  inputType: string;
  inputRefId?: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  messages?: AiMessage[];
  knowledgeSources?: string[];
  extractionType?: string;
}): Promise<{
  run: typeof aiRunsTable.$inferSelect;
  output: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
}> {
  const { workspaceId, userId, agentId, taskType, inputType, inputRefId, model, systemPrompt, userPrompt } = params;

  const [run] = await db.insert(aiRunsTable).values({
    workspaceId,
    agentId: agentId ?? null,
    taskType,
    inputType,
    inputRefId: inputRefId ?? null,
    status: "running",
    model,
    provider: ACTIVE_PROVIDER,
    safetyStatus: "ok",
    createdBy: userId,
  }).returning();

  const messages = params.messages ?? [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  // فوترة النقاط: كل ميزات الذكاء (تلخيص/تصنيف/اقتراح/مسودة) تمرّ هنا — يُحتسب استهلاكها نقاطاً مركزياً في runAI.
  const aiOutput = await runAI({ messages, model, taskType, workspaceId });

  await db.insert(aiMessagesTable).values([
    ...messages.map((message) => ({ workspaceId, aiRunId: run.id, role: message.role, content: message.content, metadata: {} })),
    { workspaceId, aiRunId: run.id, role: "assistant", content: aiOutput.content, metadata: { knowledgeSources: params.knowledgeSources ?? [] } },
  ]);

  await db.update(aiRunsTable).set({
    status: "succeeded",
    model: aiOutput.model,
    provider: aiOutput.provider,
    promptTokens: aiOutput.promptTokens,
    completionTokens: aiOutput.completionTokens,
    totalTokens: aiOutput.totalTokens,
    estimatedCost: String(aiOutput.estimatedCost),
    safetyStatus: "ok",
    completedAt: new Date(),
  }).where(and(eq(aiRunsTable.id, run.id), eq(aiRunsTable.workspaceId, workspaceId)));

  await upsertUsage({
    workspaceId,
    model: aiOutput.model,
    provider: aiOutput.provider,
    taskType,
    promptTokens: aiOutput.promptTokens,
    completionTokens: aiOutput.completionTokens,
    estimatedCost: aiOutput.estimatedCost,
  });

  const [updatedRun] = await db.select().from(aiRunsTable).where(eq(aiRunsTable.id, run.id));

  return {
    run: updatedRun,
    output: aiOutput.content,
    model: aiOutput.model,
    provider: aiOutput.provider,
    promptTokens: aiOutput.promptTokens,
    completionTokens: aiOutput.completionTokens,
  };
}

// ─── Summarize Conversation ───────────────────────────────────────────────────

router.post("/runs/summarize-conversation", aiRunLimiter, requirePermission("ai:use"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const parse = z.object({
    conversationId: z.string().uuid("معرف محادثة غير صالح"),
    model: z.enum(["gemini_flash", "gemini_flash_lite", "gemini_pro", "mock"]).optional(),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() }); return; }

  const { conversationId, model = getDefaultModel() } = parse.data;

  const { conversationsTable: ct, messagesTable: mt } = await import("@workspace/db").then((m) => ({
    conversationsTable: m.conversationsTable,
    messagesTable: m.messagesTable,
  }));

  const [conv] = await db.select().from(ct).where(
    and(eq(ct.id, conversationId), eq(ct.workspaceId, activeWorkspaceId))
  );
  if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة أو لا تنتمي لهذا النظام" }); return; }

  const messages = await db.select().from(mt).where(
    and(eq(mt.conversationId, conversationId), eq(mt.workspaceId, activeWorkspaceId))
  ).orderBy(mt.createdAt).limit(50);

  const transcript = messages.map((m) => `[${m.isPrivateNote ? "ملاحظة" : m.direction === "inbound" ? "العميل" : "الموظف"}]: ${m.content}`).join("\n");

  const result = await createAndRunAI({
    workspaceId: activeWorkspaceId,
    userId,
    taskType: "summarize",
    inputType: "conversation",
    inputRefId: conversationId,
    model,
    systemPrompt: "أنت مساعد ذكاء اصطناعي متخصص في تلخيص محادثات خدمة العملاء باللغة العربية. قدم ملخصاً واضحاً ومنظماً.",
    userPrompt: `لخص المحادثة التالية:\n\n${transcript || "لا توجد رسائل في هذه المحادثة"}`,
  });

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "ai_run_create",
    entityType: "ai_run",
    entityId: result.run.id,
    newData: { taskType: "summarize", conversationId },
  });

  res.status(201).json({ run: result.run, summary: result.output, provider: result.provider });
});

// ─── Knowledge Answer Playground ─────────────────────────────────────────────

router.post("/runs/knowledge-answer", aiRunLimiter, requirePermission("ai:use"), requirePermission("knowledge:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const parse = z.object({
    question: z.string().trim().min(1, "السؤال مطلوب").max(1000),
    baseId: z.string().uuid().optional().nullable(),
    model: z.enum(["gemini_flash", "gemini_flash_lite", "gemini_pro", "mock"]).optional(),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() }); return; }

  const { question, baseId, model = getDefaultModel() } = parse.data;
  const sources = await searchKnowledgeDetailed(activeWorkspaceId, question, baseId ?? undefined);
  const knowledgeSources = sources.map((source) => `${source.title}\n${source.content}`);
  const knowledgeContext = sources.length > 0
    ? sources.map((source, i) => `[${i + 1}] ${source.title}\n${source.content}`).join("\n\n")
    : "لا توجد مصادر معرفة مطابقة.";

  const userPrompt = `أجب على سؤال صاحب النشاط أو الموظف اعتماداً على مراجع المعرفة فقط قدر الإمكان.

مراجع المعرفة:
${knowledgeContext}

السؤال:
${question}

المطلوب:
- اكتب رداً عربياً واضحاً ومفيداً لصاحب نشاط يمني.
- إذا كانت المعرفة غير كافية، قل ذلك واقترح سؤالاً للموظف.
- لا ترسل أي رسالة للعميل، هذا اختبار داخلي فقط.
- لا تؤكد دفعاً ولا تنشئ طلباً ولا تنفذ أي إجراء.`;

  const result = await createAndRunAI({
    workspaceId: activeWorkspaceId,
    userId,
    taskType: "knowledge_answer",
    inputType: "manual",
    model,
    systemPrompt: "أنت مساعد معرفة داخلي لمنصة خدماتك. تجيب من معرفة النشاط فقط، وتذكر عند نقص المعلومة. كل الردود مسودات للاختبار ولا تُرسل تلقائياً.",
    userPrompt,
    knowledgeSources,
  });

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "ai_run_create",
    entityType: "ai_run",
    entityId: result.run.id,
    newData: { taskType: "knowledge_answer", sourceCount: sources.length },
  });

  res.status(201).json({
    run: result.run,
    answer: result.output,
    sources: sources.length > 0 ? sources : null,
    knowledgeSources: knowledgeSources.length > 0 ? knowledgeSources : null,
    knowledgeSourcesSummary: sources.length > 0 ? `تم استخدام ${sources.length} مصدر من قاعدة المعرفة` : "لم يتم العثور على مصدر مطابق",
    provider: result.provider,
    warning: "هذا اختبار فقط — لن يتم إرسال أي رسالة تلقائياً",
  });
});

// ─── Classify Conversation ────────────────────────────────────────────────────

router.post("/runs/classify-conversation", aiRunLimiter, requirePermission("ai:use"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const parse = z.object({
    conversationId: z.string().uuid("معرف محادثة غير صالح"),
    model: z.enum(["gemini_flash", "gemini_flash_lite", "gemini_pro", "mock"]).optional(),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() }); return; }

  const { conversationId, model = getDefaultModel() } = parse.data;

  const { conversationsTable: ct, messagesTable: mt } = await import("@workspace/db").then((m) => ({
    conversationsTable: m.conversationsTable,
    messagesTable: m.messagesTable,
  }));

  const [conv] = await db.select().from(ct).where(
    and(eq(ct.id, conversationId), eq(ct.workspaceId, activeWorkspaceId))
  );
  if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة أو لا تنتمي لهذا النظام" }); return; }

  const messages = await db.select().from(mt).where(
    and(eq(mt.conversationId, conversationId), eq(mt.workspaceId, activeWorkspaceId))
  ).orderBy(mt.createdAt).limit(30);

  const transcript = messages.map((m) => `[${m.direction === "inbound" ? "العميل" : "الموظف"}]: ${m.content}`).join("\n");

  const result = await createAndRunAI({
    workspaceId: activeWorkspaceId,
    userId,
    taskType: "classify",
    inputType: "conversation",
    inputRefId: conversationId,
    model,
    systemPrompt: `أنت مصنف ذكي للمحادثات. رد بـ JSON فقط بهذا الشكل: {"category": "...", "priority": "urgent|high|normal|low", "sentiment": "positive|neutral|negative", "tags": [], "urgency": false}`,
    userPrompt: `صنّف هذه المحادثة:\n\n${transcript || "لا رسائل"}`,
  });

  let classification: Record<string, unknown> = {};
  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (jsonMatch) classification = JSON.parse(jsonMatch[0]);
  } catch { classification = { category: "غير محدد", priority: "normal", sentiment: "neutral", tags: [] }; }

  await db.insert(aiExtractionsTable).values({
    workspaceId: activeWorkspaceId,
    aiRunId: result.run.id,
    extractionType: "classification",
    resultJson: classification,
  });

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "ai_run_create",
    entityType: "ai_run",
    entityId: result.run.id,
    newData: { taskType: "classify", conversationId },
  });

  res.status(201).json({ run: result.run, classification, provider: result.provider });
});

// ─── Draft Reply ──────────────────────────────────────────────────────────────

router.post("/runs/draft-reply", aiRunLimiter, requirePermission("ai:use"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const parse = z.object({
    conversationId: z.string().uuid("معرف محادثة غير صالح").optional(),
    message: z.string().trim().min(1).max(5000).optional(),
    agentId: z.string().uuid().optional(),
    instructions: z.string().trim().max(1000).optional().nullable(),
    model: z.enum(["gemini_flash", "gemini_flash_lite", "gemini_pro", "mock"]).optional(),
  }).refine((data) => data.conversationId || data.message, { message: "يجب تقديم محادثة أو رسالة اختبار" }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() }); return; }

  const { conversationId, message, agentId, instructions } = parse.data;

  // Phase 1: if channel has a defaultAgentId and no explicit agentId was passed, use the autonomous agent reply
  if (conversationId && !agentId) {
    const [convForAgent] = await db.select().from(conversationsTable).where(
      and(eq(conversationsTable.id, conversationId), eq(conversationsTable.workspaceId, activeWorkspaceId))
    );
    if (convForAgent?.channelAccountId) {
      const [channelForAgent] = await db.select({ defaultAgentId: channelAccountsTable.defaultAgentId })
        .from(channelAccountsTable)
        .where(and(eq(channelAccountsTable.id, convForAgent.channelAccountId), eq(channelAccountsTable.workspaceId, activeWorkspaceId)))
        .limit(1);
      if (channelForAgent?.defaultAgentId) {
        const agentReply = await runAgentReply({
          workspaceId: activeWorkspaceId,
          conversationId,
          agentId: channelForAgent.defaultAgentId,
          systemUserId: userId,
        });
        const [run] = await db.select().from(aiRunsTable).where(
          and(eq(aiRunsTable.id, agentReply.runId), eq(aiRunsTable.workspaceId, activeWorkspaceId))
        ).limit(1);
        const [assistantMsg] = await db.select({ metadata: aiMessagesTable.metadata }).from(aiMessagesTable).where(
          and(eq(aiMessagesTable.aiRunId, agentReply.runId), eq(aiMessagesTable.workspaceId, activeWorkspaceId), eq(aiMessagesTable.role, "assistant"))
        ).limit(1);
        const meta = (assistantMsg?.metadata ?? {}) as Record<string, unknown>;
        const ks = Array.isArray(meta.knowledgeSources) ? meta.knowledgeSources.filter((s): s is string => typeof s === "string") : [];
        await createAuditLog({
          ...auditFromRequest(req, req.sessionUser),
          action: "ai_run_create",
          entityType: "ai_run",
          entityId: agentReply.runId,
          newData: { taskType: "draft_reply", conversationId, agentId: channelForAgent.defaultAgentId },
        });
        res.status(201).json({
          run,
          draft: agentReply.reply,
          knowledgeSources: ks.length > 0 ? ks : null,
          knowledgeSourcesSummary: ks.length > 0 ? `تم استخدام ${ks.length} مصدر من قاعدة المعرفة` : null,
          provider: run?.provider,
        });
        return;
      }
    }
  }

  let model = parse.data.model ?? getDefaultModel();
  let inputRefId: string | undefined = conversationId;
  let transcript = message ? `[العميل]: ${message}` : "";
  let searchQuery = message ?? "";
  let systemPrompt = "أنت مساعد خدمة عملاء محترف. اكتب ردوداً باللغة العربية تكون ودية ومهنية. هذه مسودات فقط ولا تُرسل تلقائياً.";
  let agentKnowledgeBaseIds: string[] = [];
  let memoryContext: Awaited<ReturnType<typeof loadContext>> | null = null;
  let selectedAgent: (typeof aiAgentsTable.$inferSelect) | null = null;
  let conversationForDraft: (typeof conversationsTable.$inferSelect) | null = null;
  let latestMessageForDecision: (typeof messagesTable.$inferSelect) | null = null;
  let conversationMessagesForDraft: (typeof messagesTable.$inferSelect)[] = [];

  if (agentId) {
    const [agent] = await db.select().from(aiAgentsTable).where(
      and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.workspaceId, activeWorkspaceId))
    );
    if (!agent) { res.status(404).json({ error: "الوكيل غير موجود" }); return; }
    selectedAgent = agent;
    model = parse.data.model ?? agent.defaultModel;
    agentKnowledgeBaseIds = Array.isArray(agent.knowledgeBaseIds) ? agent.knowledgeBaseIds : [];
    const [agentInstructions] = await db.select().from(aiAgentInstructionsTable).where(
      and(eq(aiAgentInstructionsTable.agentId, agentId), eq(aiAgentInstructionsTable.workspaceId, activeWorkspaceId))
    );
    if (agentInstructions?.rolePrompt) systemPrompt = agentInstructions.rolePrompt;
    const extraRules = [
      agentInstructions?.businessRules && `قواعد النشاط: ${agentInstructions.businessRules}`,
      agentInstructions?.forbiddenActions && `ممنوعات: ${agentInstructions.forbiddenActions}`,
      agentInstructions?.escalationRules && `قواعد التصعيد: ${agentInstructions.escalationRules}`,
    ].filter(Boolean).join("\n");
    if (extraRules) systemPrompt = `${systemPrompt}\n${extraRules}`;
  }

  if (conversationId) {
    const [conv] = await db.select().from(conversationsTable).where(
      and(eq(conversationsTable.id, conversationId), eq(conversationsTable.workspaceId, activeWorkspaceId))
    );
    if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة أو لا تنتمي لهذا النظام" }); return; }

    const messages = await db.select().from(messagesTable).where(
      and(eq(messagesTable.conversationId, conversationId), eq(messagesTable.workspaceId, activeWorkspaceId))
    ).orderBy(messagesTable.createdAt).limit(20);
    conversationMessagesForDraft = messages;

    const lastMsg = messages[messages.length - 1];
    conversationForDraft = conv;
    latestMessageForDecision = [...messages].reverse().find((item) => item.direction === "inbound") ?? lastMsg ?? null;
    searchQuery = lastMsg?.content ?? "";
    memoryContext = await loadContext(activeWorkspaceId, conversationId, agentId ?? null);
    transcript = messages.slice(-10).map((m) => `[${m.direction === "inbound" ? "العميل" : "الموظف"}]: ${m.content}`).join("\n");
  }

  const sourceGroups = agentKnowledgeBaseIds.length > 0
    ? await Promise.all(agentKnowledgeBaseIds.map((baseId) => searchKnowledgeDetailed(activeWorkspaceId, searchQuery, baseId)))
    : [await searchKnowledgeDetailed(activeWorkspaceId, searchQuery)];
  const sources = sourceGroups.flat();
  const seen = new Set<string>();
  const uniqueSources = sources.filter((source) => {
    const key = `${source.type}:${source.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
  const knowledgeSources = uniqueSources.map((source) => `${source.title}\n${source.content}`);
  const sectorContext = await loadSectorAgentContext(activeWorkspaceId, selectedAgent);
  const learnedContext = await loadLearnedContext(activeWorkspaceId, searchQuery);
  const catalogContext = await loadMetaStoreContext(activeWorkspaceId);
  const mediaContext = await loadMediaContext(conversationMessagesForDraft);
  const allKnowledgeContextSources = [...knowledgeSources, ...catalogContext.sources, ...learnedContext.sources, ...mediaContext.sources];
  const channelContext = channelGuidance(conversationForDraft?.channel ?? "manual", selectedAgent?.channelTone);
  const locationContext = await loadLocationContext(activeWorkspaceId, conversationForDraft);
  const knowledgeGap = conversationId ? !hasStrongKnowledgeHit(uniqueSources) : false;
  let previousKnowledgeGaps = 0;
  if (knowledgeGap && conversationId && agentId) {
    const rows = await db.select({ id: autoReplyDecisionsTable.id }).from(autoReplyDecisionsTable).where(and(
      eq(autoReplyDecisionsTable.workspaceId, activeWorkspaceId),
      eq(autoReplyDecisionsTable.conversationId, conversationId),
      eq(autoReplyDecisionsTable.agentId, agentId),
      eq(autoReplyDecisionsTable.reason, "knowledge_gap"),
    )).limit(2);
    previousKnowledgeGaps = rows.length;
  }
  const shouldEscalateKnowledgeGap = knowledgeGap && previousKnowledgeGaps > 0;
  const escalationGuidance = knowledgeGap
    ? shouldEscalateKnowledgeGap
      ? "لا توجد إجابة واضحة في المعرفة المتاحة بعد محاولة توضيح سابقة. لا تخمّن. اكتب ردًا قصيرًا يقول: أحتاج أتأكد من هذه المعلومة وأرجع لك، وسيتم تحويل المحادثة للفريق."
      : "إذا لم تجد إجابة واضحة في المعرفة المتاحة، لا تخمّن. اسأل سؤالًا توضيحيًا واحدًا يساعد الموظف أو العميل على تحديد المطلوب."
    : "لا تخترع أي سعر أو خصم أو ضمان أو سياسة. استخدم المعرفة المتاحة فقط.";
  systemPrompt = `${systemPrompt}\n\n${sectorContext}\n\n${channelContext}\n\n${locationContext}${mediaContext.context}\n\n${escalationGuidance}`;

  const knowledgeContext = knowledgeSources.length > 0
    ? `\n\nمعرفة ذات صلة من قاعدة البيانات:\n${knowledgeSources.map((item, index) => `[${index + 1}] ${item}`).join("\n")}`
    : "";

  const userPrompt = `اكتب رداً مناسباً على آخر رسالة في هذه المحادثة أو التجربة.${instructions ? `\nتعليمات إضافية: ${instructions}` : ""}

المحادثة:
${transcript}${knowledgeContext}${learnedContext.context}${mediaContext.context}

${sectorContext}${catalogContext.context}

${locationContext}

المطلوب: مسودة رد احترافي ومناسب باللغة العربية. لا ترسل تلقائياً — هذه مسودة فقط للمراجعة.`;

  const result = await createAndRunAI({
    workspaceId: activeWorkspaceId,
    userId,
    agentId,
    taskType: "draft_reply",
    inputType: conversationId ? "conversation" : "manual",
    inputRefId,
    model,
    systemPrompt,
    userPrompt,
    messages: memoryContext ? [
      { role: "system", content: systemPrompt },
      ...(memoryContext.summary ? [{ role: "system" as const, content: `ذاكرة مختصرة للمحادثة السابقة:\n${memoryContext.summary}` }] : []),
      ...memoryContext.recentTurns.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user", content: userPrompt },
    ] : undefined,
    knowledgeSources: allKnowledgeContextSources,
  });
  let finalDraft = result.output;
  if (shouldEscalateKnowledgeGap) {
    finalDraft = "أحتاج أتأكد من هذه المعلومة وأرجع لك. سأحوّل المحادثة لأحد أعضاء الفريق حتى يراجع التفاصيل بدقة.";
    await db.update(aiMessagesTable)
      .set({ content: finalDraft, metadata: { knowledgeSources: allKnowledgeContextSources, escalation: "knowledge_gap" } })
      .where(and(
        eq(aiMessagesTable.aiRunId, result.run.id),
        eq(aiMessagesTable.role, "assistant"),
        eq(aiMessagesTable.workspaceId, activeWorkspaceId)
      ));
  }

  if (conversationId) {
    if (message) {
      await appendTurn(activeWorkspaceId, conversationId, agentId ?? null, {
        role: "user",
        content: message,
        ts: new Date().toISOString(),
        message_id: null,
      });
    }
    const updatedMemory = await appendTurn(activeWorkspaceId, conversationId, agentId ?? null, {
      role: "assistant",
      content: finalDraft,
      ts: new Date().toISOString(),
      message_id: null,
    });
    if (shouldRotate(updatedMemory.tokenEstimate)) {
      void rotate(activeWorkspaceId, conversationId, agentId ?? null).then(async (rotation) => {
        if (!rotation.rotated) return;
        await createAuditLog({
          ...auditFromRequest(req, req.sessionUser),
          action: "agent_memory_rotate",
          severity: "info",
          entityType: "conversation",
          entityId: conversationId,
          newData: { agentId: agentId ?? null },
        });
      });
    }
  }

  let trustDecision: TrustDecision | null = null;
  let autoReplyOutboxEventId: string | null = null;
  if (shouldEscalateKnowledgeGap && conversationId && agentId && conversationForDraft && latestMessageForDecision) {
    await db.update(conversationsTable)
      .set({ needsHuman: true, escalationReason: "knowledge_gap", updatedAt: new Date() })
      .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.workspaceId, activeWorkspaceId)));
    await db.insert(tasksTable).values({
      workspaceId: activeWorkspaceId,
      title: "مراجعة محادثة تحتاج تدخل",
      description: "الوكيل لم يجد إجابة واضحة في المعرفة المتاحة بعد سؤال توضيحي، ويحتاج الموظف لمراجعة المحادثة.",
      status: "pending",
      priority: "high",
      contactId: conversationForDraft.contactId ?? null,
      conversationId,
      relatedType: "conversation",
      relatedId: conversationId,
      createdBy: userId,
    });
    trustDecision = { decision: "suggest_only", reason: "knowledge_gap" };
    await db.insert(autoReplyDecisionsTable).values({
      workspaceId: activeWorkspaceId,
      conversationId,
      agentId,
      messageId: latestMessageForDecision.id,
      decision: "suggest_only",
      reason: "knowledge_gap",
      confidence: null,
      topicDetected: null,
      sentMessageId: null,
    });
    await notifyWorkspace({
      workspaceId: activeWorkspaceId,
      type: "conversation.needs_human",
      titleAr: "محادثة تحتاج تدخل",
      bodyAr: "لم يجد الوكيل إجابة مؤكدة، وتم تحويل المحادثة لمراجعة الفريق.",
      link: `/inbox?conversation=${conversationId}`,
    });
  } else if (conversationId && agentId && selectedAgent && conversationForDraft && latestMessageForDecision) {
    trustDecision = await shouldAutoSend({
      workspaceId: activeWorkspaceId,
      agent: selectedAgent,
      conversationId,
      userMessage: latestMessageForDecision.content || searchQuery,
      draftReply: finalDraft,
      kbHits: uniqueSources,
    });

    if (trustDecision.decision === "auto_sent") {
      const destination = await resolveAutoReplyDestination(activeWorkspaceId, conversationForDraft);
      if (!destination.channelAccountId || !destination.to) {
        trustDecision = {
          ...trustDecision,
          decision: "suggest_only",
          reason: "missing_destination",
        };
      } else {
        const [event] = await db.insert(outboxEventsTable).values({
          workspaceId: activeWorkspaceId,
          eventType: "message.send.whatsapp.text",
          entityType: "conversation",
          entityId: conversationId,
          idempotencyKey: `auto:${agentId}:${latestMessageForDecision.id}`,
          payload: {
            channelAccountId: destination.channelAccountId,
            conversationId,
            to: destination.to,
            ...(destination.recipientIdentityType ? { recipientIdentityType: destination.recipientIdentityType } : {}),
            body: finalDraft,
            aiRunId: result.run.id,
            autoReply: true,
          },
          status: "pending",
          nextAttemptAt: new Date(),
        }).onConflictDoNothing().returning({ id: outboxEventsTable.id });
        autoReplyOutboxEventId = event?.id ?? null;
      }
    }

    await db.insert(autoReplyDecisionsTable).values({
      workspaceId: activeWorkspaceId,
      conversationId,
      agentId,
      messageId: latestMessageForDecision.id,
      decision: trustDecision.decision,
      reason: trustDecision.reason,
      confidence: trustDecision.confidence !== undefined ? String(trustDecision.confidence) : null,
      topicDetected: trustDecision.topic ?? null,
      sentMessageId: null,
    });
  }

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "ai_run_create",
    entityType: "ai_run",
    entityId: result.run.id,
    newData: { taskType: "draft_reply", conversationId: conversationId ?? null, agentId: agentId ?? null },
  });

  res.status(201).json({
    run: result.run,
    draft: finalDraft,
    trustDecision,
    autoReplyOutboxEventId,
    sources: uniqueSources.length > 0 ? uniqueSources : null,
    knowledgeSources: allKnowledgeContextSources.length > 0 ? allKnowledgeContextSources : null,
    knowledgeSourcesSummary: allKnowledgeContextSources.length > 0 ? `تم استخدام ${allKnowledgeContextSources.length} مصدر من قاعدة المعرفة والسياق التجاري والوسائط` : null,
    provider: result.provider,
    warning: "هذه مسودة فقط — لن يتم إرسالها تلقائياً",
  });
});

// ─── Extract Entities ─────────────────────────────────────────────────────────

router.post("/runs/extract", aiRunLimiter, requirePermission("ai:use"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const parse = z.object({
    text: z.string().trim().min(1, "النص مطلوب").max(10000).optional(),
    conversationId: z.string().uuid().optional(),
    model: z.enum(["gemini_flash", "gemini_flash_lite", "gemini_pro", "mock"]).optional(),
  }).refine((d) => d.text || d.conversationId, { message: "يجب تقديم نص أو معرف محادثة" }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() }); return; }

  const { text, conversationId, model = getDefaultModel() } = parse.data;

  let inputText = text ?? "";
  let inputRefId: string | undefined;

  if (conversationId) {
    const { messagesTable: mt } = await import("@workspace/db").then((m) => ({ messagesTable: m.messagesTable }));
    const [conv] = await db.select({ id: conversationsTable.id }).from(conversationsTable).where(
      and(eq(conversationsTable.id, conversationId), eq(conversationsTable.workspaceId, activeWorkspaceId))
    );
    if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة" }); return; }
    const msgs = await db.select({ content: mt.content }).from(mt).where(
      and(eq(mt.conversationId, conversationId), eq(mt.workspaceId, activeWorkspaceId))
    ).orderBy(mt.createdAt).limit(20);
    inputText = msgs.map((m) => m.content).join("\n");
    inputRefId = conversationId;
  }

  const result = await createAndRunAI({
    workspaceId: activeWorkspaceId,
    userId,
    taskType: "extract",
    inputType: conversationId ? "conversation" : "manual",
    inputRefId,
    model,
    systemPrompt: `استخرج الكيانات من النص. رد بـ JSON فقط: {"entities": [{"type": "...", "value": "...", "confidence": 0.9}], "keywords": [], "intent": "..."}`,
    userPrompt: `استخرج الكيانات من هذا النص:\n\n${inputText}`,
  });

  let extracted: Record<string, unknown> = {};
  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
  } catch { extracted = { entities: [], keywords: [], intent: "غير محدد" }; }

  await db.insert(aiExtractionsTable).values({
    workspaceId: activeWorkspaceId,
    aiRunId: result.run.id,
    extractionType: "entities",
    resultJson: extracted,
  });

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "ai_run_create",
    entityType: "ai_run",
    entityId: result.run.id,
    newData: { taskType: "extract" },
  });

  res.status(201).json({ run: result.run, extracted, provider: result.provider });
});

// ─── Suggest Actions ──────────────────────────────────────────────────────────

router.post("/runs/suggest-actions", aiRunLimiter, requirePermission("ai:use"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const parse = z.object({
    conversationId: z.string().uuid("معرف محادثة غير صالح"),
    model: z.enum(["gemini_flash", "gemini_flash_lite", "gemini_pro", "mock"]).optional(),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() }); return; }

  const { conversationId, model = getDefaultModel() } = parse.data;

  const { conversationsTable: ct, messagesTable: mt } = await import("@workspace/db").then((m) => ({
    conversationsTable: m.conversationsTable,
    messagesTable: m.messagesTable,
  }));

  const [conv] = await db.select().from(ct).where(
    and(eq(ct.id, conversationId), eq(ct.workspaceId, activeWorkspaceId))
  );
  if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة أو لا تنتمي لهذا النظام" }); return; }

  const messages = await db.select().from(mt).where(
    and(eq(mt.conversationId, conversationId), eq(mt.workspaceId, activeWorkspaceId))
  ).orderBy(mt.createdAt).limit(20);

  const transcript = messages.map((m) => `[${m.direction === "inbound" ? "العميل" : "الموظف"}]: ${m.content}`).join("\n");

  const result = await createAndRunAI({
    workspaceId: activeWorkspaceId,
    userId,
    taskType: "suggest_action",
    inputType: "conversation",
    inputRefId: conversationId,
    model,
    systemPrompt: `اقترح إجراءات مناسبة. رد بـ JSON فقط: [{"action_type": "create_ticket|create_task|create_followup|create_opportunity|create_order_draft|draft_reply", "label": "...", "payload": {}, "confidence": 0.8, "reason": "..."}]`,
    userPrompt: `بناءً على هذه المحادثة، اقترح إجراءات:\n\n${transcript}`,
  });

  let rawSuggestions: Array<{ action_type: string; label?: string; payload?: Record<string, unknown>; confidence?: number; reason?: string }> = [];
  try {
    const jsonMatch = result.output.match(/\[[\s\S]*\]/);
    if (jsonMatch) rawSuggestions = JSON.parse(jsonMatch[0]);
  } catch { rawSuggestions = []; }

  const safeSuggestions: typeof rawSuggestions = [];
  const blockedSuggestions: typeof rawSuggestions = [];
  const approvalIds: string[] = [];

  for (const suggestion of rawSuggestions) {
    const safetyCheck = checkActionSafety(suggestion.action_type);
    if (safetyCheck.blocked) {
      blockedSuggestions.push(suggestion);
      await recordSafetyBlock({
        workspaceId: activeWorkspaceId,
        aiRunId: result.run.id,
        blockedAction: suggestion.action_type,
        reason: safetyCheck.reason!,
        severity: safetyCheck.severity!,
        payload: { suggestion },
        createdBy: userId,
      });
      await createAuditLog({
        ...auditFromRequest(req, req.sessionUser),
        action: "ai_run_blocked",
        severity: "warning",
        entityType: "ai_run",
        entityId: result.run.id,
        newData: { blockedAction: suggestion.action_type },
      });
    } else if (isSuggestionSafe(suggestion.action_type)) {
      safeSuggestions.push(suggestion);
      const [approval] = await db.insert(approvalRequestsTable).values({
        workspaceId: activeWorkspaceId,
        sourceType: "ai_run",
        sourceId: result.run.id,
        actionType: suggestion.action_type,
        payload: { suggestion, conversationId },
        status: "pending",
        requestedBy: userId,
      }).returning();
      approvalIds.push(approval.id);

      await createAuditLog({
        ...auditFromRequest(req, req.sessionUser),
        action: "ai_approval_requested",
        entityType: "approval_request",
        entityId: approval.id,
        newData: { actionType: suggestion.action_type, runId: result.run.id },
      });
    }
  }

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "ai_run_create",
    entityType: "ai_run",
    entityId: result.run.id,
    newData: { taskType: "suggest_action", conversationId, safeSuggestions: safeSuggestions.length },
  });

  res.status(201).json({
    run: result.run,
    suggestions: safeSuggestions,
    approvalIds,
    blockedCount: blockedSuggestions.length,
    provider: result.provider,
    note: "الاقتراحات تحتاج اعتمادًا بشريًا قبل التنفيذ",
  });
});

export default router;
