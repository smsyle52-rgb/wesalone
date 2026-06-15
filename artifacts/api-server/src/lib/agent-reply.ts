import { db } from "@workspace/db";
import {
  aiAgentInstructionsTable,
  aiAgentsTable,
  aiMessagesTable,
  aiRunsTable,
  aiUsageTable,
  messagesTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { searchKnowledgeForAi } from "../services/knowledge-retrieval";
import { ACTIVE_PROVIDER, getDefaultModel, runAI } from "./ai-provider";
import {
  buildAgentToolPrompt,
  executeAgentToolCalls,
  loadExecutableAgentTools,
  parseAgentToolResponse,
  type AgentToolResult,
} from "./agent-tools";

const ESCALATION_KEYWORDS = ["أكلم إنسان", "مدير", "شكوى", "إلغاء"];

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


async function runAIWithTimeout(input: Parameters<typeof runAI>[0], timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortPromise = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => reject(new Error("AI reply generation timed out after 30 seconds")),
      { once: true }
    );
  });

  try {
    return await Promise.race([runAI(input), abortPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

function includesEscalationKeyword(value: string): boolean {
  return ESCALATION_KEYWORDS.some((keyword) => value.includes(keyword));
}

export async function runAgentReply(params: {
  workspaceId: string;
  conversationId: string;
  agentId: string;
  systemUserId: string;
}): Promise<{ reply: string; shouldEscalate: boolean; runId: string; toolResults: AgentToolResult[] }> {
  const [agent] = await db
    .select()
    .from(aiAgentsTable)
    .where(and(eq(aiAgentsTable.id, params.agentId), eq(aiAgentsTable.workspaceId, params.workspaceId)))
    .limit(1);
  if (!agent) throw new Error("AI_AGENT_NOT_FOUND");

  const [instructions] = await db
    .select()
    .from(aiAgentInstructionsTable)
    .where(and(eq(aiAgentInstructionsTable.agentId, params.agentId), eq(aiAgentInstructionsTable.workspaceId, params.workspaceId)))
    .limit(1);

  const recentMessages = await db
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.conversationId, params.conversationId), eq(messagesTable.workspaceId, params.workspaceId)))
    .orderBy(desc(messagesTable.createdAt))
    .limit(15);
  const messages = recentMessages.reverse();
  const lastInbound = [...messages].reverse().find((message) => message.direction === "inbound");
  const searchQuery = lastInbound?.content ?? messages[messages.length - 1]?.content ?? "";
  const knowledgeSources = await searchKnowledgeForAi({ workspaceId: params.workspaceId, query: searchQuery });
  const executableTools = await loadExecutableAgentTools(params.workspaceId, params.agentId);
  const toolPrompt = buildAgentToolPrompt(executableTools);

  const transcript = messages
    .map((message) => `[${message.direction === "inbound" ? "العميل" : "الموظف"}]: ${message.content}`)
    .join("\n");
  const knowledgeContext = knowledgeSources.length > 0
    ? `\n\nمعرفة ذات صلة من قاعدة البيانات:\n${knowledgeSources.map((item, index) => `[${index + 1}] ${item.title}: ${item.content.slice(0, 800)}`).join("\n")}`
    : "";
  const systemPrompt = [
    toolPrompt,
    `Current date/time: ${new Date().toISOString()}.`,
    instructions?.rolePrompt ?? "أنت وكيل خدمة عملاء عربي لمنصة وصال ون.",
    instructions?.businessRules ? `قواعد النشاط: ${instructions.businessRules}` : "",
    `اللهجة: ${agent.dialect}.`,
    agent.tone ? `النبرة: ${agent.tone}.` : "",
  ].filter(Boolean).join("\n");
  const userPrompt = `اكتب رداً مناسباً على آخر رسالة في هذه المحادثة.

المحادثة:
${transcript || "لا توجد رسائل في هذه المحادثة"}${knowledgeContext}

المطلوب: رد احترافي مناسب باللغة العربية.`;
  const model = agent.defaultModel || getDefaultModel();

  const [run] = await db.insert(aiRunsTable).values({
    workspaceId: params.workspaceId,
    agentId: params.agentId,
    taskType: "draft_reply",
    inputType: "conversation",
    inputRefId: params.conversationId,
    status: "running",
    model,
    provider: ACTIVE_PROVIDER,
    safetyStatus: "ok",
    createdBy: params.systemUserId,
  }).returning();

  const runMessages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  try {
    const aiOutput = await runAIWithTimeout({ messages: runMessages, model, taskType: "draft_reply", maxTokens: agent.maxOutputTokens });

    // H5-1 fix: لو AI غير متوفّر → صعّد للبشر بصمت، لا تُرسل نص تجريبي للعميل (محمية #10)
    if (aiOutput.fallbackUsed) {
      await db.update(aiRunsTable).set({
        status: "failed",
        errorMessage: "AI provider unavailable — escalating silently",
        completedAt: new Date(),
      }).where(and(eq(aiRunsTable.id, run.id), eq(aiRunsTable.workspaceId, params.workspaceId)));
      return { reply: "", shouldEscalate: true, runId: run.id, toolResults: [] };
    }

    const parsedOutput = executableTools.length > 0
      ? parseAgentToolResponse(aiOutput.content)
      : { reply: aiOutput.content, toolCalls: [] };
    const toolResults = await executeAgentToolCalls({
      workspaceId: params.workspaceId,
      conversationId: params.conversationId,
      agentId: params.agentId,
      aiRunId: run.id,
      systemUserId: params.systemUserId,
      calls: parsedOutput.toolCalls,
    });
    const hasToolProblem = toolResults.some((result) => result.status !== "success");
    const hasHandoff = toolResults.some((result) => result.tool === "handoff_to_human" && result.status === "success");
    const finalReply = hasToolProblem
      ? "أحتاج أن أحوّل طلبك للفريق لمراجعته والتأكد من تنفيذه بشكل صحيح."
      : parsedOutput.reply;

    await db.insert(aiMessagesTable).values([
      { workspaceId: params.workspaceId, aiRunId: run.id, role: "system", content: systemPrompt, metadata: {} },
      { workspaceId: params.workspaceId, aiRunId: run.id, role: "user", content: userPrompt, metadata: {} },
      {
        workspaceId: params.workspaceId,
        aiRunId: run.id,
        role: "assistant",
        content: finalReply,
        metadata: {
          knowledgeSources,
          toolResults,
          rawOutput: parsedOutput.reply !== aiOutput.content ? aiOutput.content : undefined,
        },
      },
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
    }).where(and(eq(aiRunsTable.id, run.id), eq(aiRunsTable.workspaceId, params.workspaceId)));

    await upsertUsage({
      workspaceId: params.workspaceId,
      model: aiOutput.model,
      provider: aiOutput.provider,
      taskType: "draft_reply",
      promptTokens: aiOutput.promptTokens,
      completionTokens: aiOutput.completionTokens,
      estimatedCost: aiOutput.estimatedCost,
    });

    const shouldEscalate =
      hasToolProblem ||
      hasHandoff ||
      includesEscalationKeyword(finalReply) ||
      includesEscalationKeyword(lastInbound?.content ?? "");
    return { reply: finalReply, shouldEscalate, runId: run.id, toolResults };
  } catch (err) {
    await db.update(aiRunsTable).set({
      status: "failed",
      errorMessage: err instanceof Error ? err.message : "Unknown AI error",
      completedAt: new Date(),
    }).where(and(eq(aiRunsTable.id, run.id), eq(aiRunsTable.workspaceId, params.workspaceId)));
    throw err;
  }
}
