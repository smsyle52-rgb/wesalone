import { Router, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  aiAgentsTable, aiAgentVersionsTable, aiAgentInstructionsTable,
  aiAgentToolsTable, aiRunsTable, aiMessagesTable, aiExtractionsTable,
  aiUsageTable, aiFeedbackTable, aiSafetyEventsTable, approvalRequestsTable,
  conversationsTable, knowledgeChunksTable,
} from "@workspace/db";
import { eq, and, desc, ilike, or, sql } from "drizzle-orm";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import type { AuthenticatedRequest } from "../../lib/types";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { runAI, getProviderStatus, ACTIVE_PROVIDER, getDefaultModel } from "../../lib/ai-provider";
import { checkActionSafety, recordSafetyBlock, isSuggestionSafe } from "../../lib/ai-safety";
import { aiRunLimiter } from "../../lib/rateLimiter";

const router = Router();
router.use(requireSession);

// ─── Provider Status ─────────────────────────────────────────────────────────

router.get("/provider-status", requirePermission("ai:read"), (req: AuthenticatedRequest, res: Response): void => {
  res.json(getProviderStatus());
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

async function searchKnowledge(workspaceId: string, query: string): Promise<string[]> {
  if (!query || query.length < 3) return [];
  try {
    const words = query.split(/\s+/).filter((w) => w.length > 2).slice(0, 3);
    if (words.length === 0) return [];
    const chunks = await db
      .select({ chunkText: knowledgeChunksTable.chunkText })
      .from(knowledgeChunksTable)
      .where(
        and(
          eq(knowledgeChunksTable.workspaceId, workspaceId),
          or(...words.map((w) => ilike(knowledgeChunksTable.chunkText, `%${w}%`)))
        )
      )
      .limit(3);
    return chunks.map((c) => c.chunkText);
  } catch {
    return [];
  }
}

// ─── AI Agents ───────────────────────────────────────────────────────────────

const agentCreateSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب").max(200),
  type: z.enum(["support", "sales", "followup", "summarizer", "classifier", "reports", "collections"]).default("support"),
  defaultModel: z.enum(["gemini_flash", "gemini_flash_lite", "gemini_pro", "mock"]).default("mock"),
  dialect: z.enum(["standard_arabic", "yemeni_light", "yemeni_business"]).default("standard_arabic"),
  tone: z.string().trim().max(200).optional().nullable(),
});

const agentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  type: z.enum(["support", "sales", "followup", "summarizer", "classifier", "reports", "collections"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  defaultModel: z.enum(["gemini_flash", "gemini_flash_lite", "gemini_pro", "mock"]).optional(),
  dialect: z.enum(["standard_arabic", "yemeni_light", "yemeni_business"]).optional(),
  tone: z.string().trim().max(200).optional().nullable(),
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
  const [agent] = await db.insert(aiAgentsTable).values({
    workspaceId: activeWorkspaceId,
    name: data.name,
    type: data.type,
    defaultModel: data.defaultModel,
    dialect: data.dialect,
    tone: data.tone ?? null,
    status: "active",
    createdBy: userId,
  }).returning();

  await db.insert(aiAgentInstructionsTable).values({
    workspaceId: activeWorkspaceId,
    agentId: agent.id,
    rolePrompt: `أنت وكيل ذكاء اصطناعي مساعد لنظام إدارة علاقات العملاء. نوعك: ${data.type}. لهجتك: ${data.dialect}.`,
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

  res.json({ agent, instructions: instructions ?? null, tools, versions });
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
  const [agent] = await db.update(aiAgentsTable).set({
    ...data,
    updatedAt: new Date(),
  }).where(eq(aiAgentsTable.id, agentId)).returning();

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
    modelConfig: { defaultModel: agent.defaultModel, dialect: agent.dialect, tone: agent.tone },
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
    }).where(eq(aiAgentInstructionsTable.id, existing[0].id)).returning();
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
    }).where(eq(aiAgentToolsTable.id, existing[0].id)).returning();
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
  taskType: string;
  inputType: string;
  inputRefId?: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
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
  const { workspaceId, userId, taskType, inputType, inputRefId, model, systemPrompt, userPrompt } = params;

  const [run] = await db.insert(aiRunsTable).values({
    workspaceId,
    taskType,
    inputType,
    inputRefId: inputRefId ?? null,
    status: "running",
    model,
    provider: ACTIVE_PROVIDER,
    safetyStatus: "ok",
    createdBy: userId,
  }).returning();

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  const aiOutput = await runAI({ messages, model, taskType });

  await db.insert(aiMessagesTable).values([
    { workspaceId, aiRunId: run.id, role: "system", content: systemPrompt, metadata: {} },
    { workspaceId, aiRunId: run.id, role: "user", content: userPrompt, metadata: {} },
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
  }).where(eq(aiRunsTable.id, run.id));

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
    conversationId: z.string().uuid("معرف محادثة غير صالح"),
    instructions: z.string().trim().max(1000).optional().nullable(),
    model: z.enum(["gemini_flash", "gemini_flash_lite", "gemini_pro", "mock"]).optional(),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() }); return; }

  const { conversationId, instructions, model = getDefaultModel() } = parse.data;

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

  const lastMsg = messages[messages.length - 1];
  const searchQuery = lastMsg?.content ?? "";
  const knowledgeSources = await searchKnowledge(activeWorkspaceId, searchQuery);

  const transcript = messages.slice(-10).map((m) => `[${m.direction === "inbound" ? "العميل" : "الموظف"}]: ${m.content}`).join("\n");

  let knowledgeContext = "";
  if (knowledgeSources.length > 0) {
    knowledgeContext = `\n\nمعرفة ذات صلة من قاعدة البيانات:\n${knowledgeSources.map((k, i) => `[${i + 1}] ${k}`).join("\n")}`;
  }

  const userPrompt = `اكتب رداً مناسباً على آخر رسالة في هذه المحادثة.${instructions ? `\nتعليمات إضافية: ${instructions}` : ""}

المحادثة:
${transcript}${knowledgeContext}

المطلوب: مسودة رد احترافي ومناسب باللغة العربية. لا ترسل تلقائياً — هذه مسودة فقط للمراجعة.`;

  const result = await createAndRunAI({
    workspaceId: activeWorkspaceId,
    userId,
    taskType: "draft_reply",
    inputType: "conversation",
    inputRefId: conversationId,
    model,
    systemPrompt: "أنت مساعد خدمة عملاء محترف. اكتب ردوداً باللغة العربية تكون ودية ومهنية. هذه مسودات فقط ولا تُرسل تلقائياً.",
    userPrompt,
    knowledgeSources,
  });

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "ai_run_create",
    entityType: "ai_run",
    entityId: result.run.id,
    newData: { taskType: "draft_reply", conversationId },
  });

  res.status(201).json({
    run: result.run,
    draft: result.output,
    knowledgeSources: knowledgeSources.length > 0 ? knowledgeSources : null,
    knowledgeSourcesSummary: knowledgeSources.length > 0 ? `تم استخدام ${knowledgeSources.length} مصدر من قاعدة المعرفة` : null,
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
