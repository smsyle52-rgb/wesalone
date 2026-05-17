import { db } from "@workspace/db";
import { autoReplyDecisionsTable, businessHoursTable, type AiAgent } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";

export type TrustDecision = {
  decision: "auto_sent" | "suggest_only" | "blocked";
  reason: string;
  confidence?: number;
  topic?: string;
};

type TrustHit = {
  score?: number;
  title?: string;
  content?: string;
};

type TrustInput = {
  workspaceId: string;
  agent: AiAgent;
  conversationId: string;
  userMessage: string;
  draftReply: string;
  kbHits: TrustHit[];
  currentHourLocal?: number;
};

const TOPIC_KEYWORDS: Record<string, string[]> = {
  pricing: ["price", "pricing", "سعر", "كم", "تكلفة", "الأسعار", "السعر"],
  hours: ["hours", "وقت", "دوام", "متى", "ساعات العمل", "يفتح", "يغلق"],
  location: ["location", "address", "عنوان", "مكان", "أين", "الموقع"],
  payment: ["payment", "pay", "دفع", "كريمي", "جوالي", "تحويل", "الدفع"],
};

const TOPIC_ALIASES: Record<string, string> = {
  "الأسعار": "pricing",
  "ساعات العمل": "hours",
  "الموقع": "location",
  "طرق الدفع": "payment",
};

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function canonicalTopic(value: string): string {
  return TOPIC_ALIASES[value] ?? value;
}

function detectTopic(message: string): string | null {
  const normalized = normalize(message);
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((keyword) => normalized.includes(normalize(keyword)))) return topic;
  }
  return null;
}

function localNow(): { dayOfWeek: number; minutes: number; hour: number } {
  const local = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Aden" }));
  return {
    dayOfWeek: local.getDay(),
    minutes: local.getHours() * 60 + local.getMinutes(),
    hour: local.getHours(),
  };
}

function timeToMinutes(value: string | null): number | null {
  if (!value) return null;
  const [hour, minute] = value.split(":").map((part) => Number(part));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

async function isBusinessOpen(workspaceId: string, currentHourLocal?: number): Promise<boolean> {
  const now = localNow();
  const [row] = await db
    .select()
    .from(businessHoursTable)
    .where(and(eq(businessHoursTable.workspaceId, workspaceId), eq(businessHoursTable.dayOfWeek, now.dayOfWeek)))
    .limit(1);

  if (!row) return false;
  if (row.isClosed) return false;

  const open = timeToMinutes(row.openTime);
  const close = timeToMinutes(row.closeTime);
  const current = currentHourLocal !== undefined ? currentHourLocal * 60 : now.minutes;
  if (open === null || close === null) return false;
  return current >= open && current <= close;
}

async function countDecisions(params: {
  workspaceId: string;
  conversationId?: string;
  agentId: string;
  from?: Date;
  decision?: "auto_sent" | "suggest_only" | "blocked";
}): Promise<number> {
  const filters = [
    eq(autoReplyDecisionsTable.workspaceId, params.workspaceId),
    eq(autoReplyDecisionsTable.agentId, params.agentId),
  ];
  if (params.conversationId) filters.push(eq(autoReplyDecisionsTable.conversationId, params.conversationId));
  if (params.from) filters.push(gte(autoReplyDecisionsTable.createdAt, params.from));
  if (params.decision) filters.push(eq(autoReplyDecisionsTable.decision, params.decision));

  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(autoReplyDecisionsTable)
    .where(and(...filters));
  return Number(row?.value ?? 0);
}

export async function shouldAutoSend(input: TrustInput): Promise<TrustDecision> {
  const trustMode = input.agent.trustMode ?? "suggest";
  if (trustMode === "suggest") return { decision: "suggest_only", reason: "trust_mode_off" };

  const normalizedMessage = normalize(input.userMessage);
  const blocklist = asArray(input.agent.trustBlocklist);
  if (blocklist.some((keyword) => normalizedMessage.includes(normalize(keyword)))) {
    return { decision: "blocked", reason: "blocklist_match" };
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const dailyCount = await countDecisions({
    workspaceId: input.workspaceId,
    agentId: input.agent.id,
    from: startOfDay,
    decision: "auto_sent",
  });
  if (dailyCount >= input.agent.dailyAutoSendQuota) return { decision: "suggest_only", reason: "quota_exceeded" };

  if (trustMode === "auto_after_hours" && await isBusinessOpen(input.workspaceId, input.currentHourLocal)) {
    return { decision: "suggest_only", reason: "business_hours_open" };
  }

  const conversationCount = await countDecisions({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    agentId: input.agent.id,
    decision: "auto_sent",
  });
  if (conversationCount >= input.agent.maxAutoRepliesPerConversation) {
    return { decision: "suggest_only", reason: "per_conversation_cap" };
  }

  const topic = detectTopic(input.userMessage);
  const allowedTopics = asArray(input.agent.trustTopics).map(canonicalTopic);
  if (!topic || !allowedTopics.includes(topic)) {
    return { decision: "suggest_only", reason: "topic_not_whitelisted", topic: topic ?? undefined };
  }

  const confidence = Math.max(0, ...input.kbHits.map((hit) => asNumber(hit.score, 0)));
  const threshold = asNumber(input.agent.trustConfidenceThreshold, 0.8);
  if (confidence >= threshold) return { decision: "auto_sent", reason: "ok", confidence, topic };
  return { decision: "suggest_only", reason: "confidence_low", confidence, topic };
}
