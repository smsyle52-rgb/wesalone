import { db } from "@workspace/db";
import {
  aiAgentToolsTable,
  channelAccountsTable,
  conversationsTable,
  contactsTable,
  domainEventsTable,
  exchangeRatesTable,
  followupsTable,
  messagesTable,
  orderItemsTable,
  ordersTable,
  outboxEventsTable,
  paymentMethodsTable,
  paymentsTable,
  inventoryProductsTable,
} from "@workspace/db";
import { and, count, desc, eq, ilike, sum } from "drizzle-orm";
import { z } from "zod";
import type { AiFunctionDeclaration } from "./ai-provider";
import { createAuditLog } from "./audit";
import { addContactTimeline } from "./contactTimeline";
import { emitWorkspaceEvent } from "./events";

export const AGENT_TOOL_KEYS = [
  "create_order",
  "log_payment_claim",
  "schedule_followup",
  "send_product_media",
  "handoff_to_human",
] as const;

export type AgentToolKey = (typeof AGENT_TOOL_KEYS)[number];

export type AgentToolCall = {
  name: string;
  arguments?: unknown;
};

export type AgentToolResult = {
  tool: AgentToolKey;
  status: "success" | "failed" | "skipped";
  summary: string;
  entityType?: string;
  entityId?: string;
  customerVisible?: boolean;
};

type ToolPolicy = {
  key: AgentToolKey;
  requiresApproval: boolean;
  config: Record<string, unknown>;
};

type ConversationContext = {
  id: string;
  workspaceId: string;
  contactId: string | null;
  channel: string;
  channelAccountId: string | null;
  externalThreadId: string | null;
};

type ExecuteParams = {
  workspaceId: string;
  conversationId: string;
  agentId: string;
  aiRunId: string;
  systemUserId: string;
  calls: AgentToolCall[];
};

const CURRENCY_VALUES = ["YER", "SAR", "USD"] as const;
const ORDER_CHANNEL_VALUES = ["manual", "whatsapp", "phone", "website", "walk_in"] as const;

// PD-9: النموذج يمرّر العملة بالعربية ("ريال يمني") — طبّعها لرمز ISO قبل التحقّق.
function coerceCurrency(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const s = raw.trim().toLowerCase();
  if (s === "yer" || s.includes("يمن") || s.includes("rial") || s.includes("ريال يمن")) return "YER";
  if (s === "sar" || s.includes("سعود") || s.includes("riyal")) return "SAR";
  if (s === "usd" || s.includes("دولار") || s.includes("dollar") || s === "$") return "USD";
  return raw; // ابقَ كما هو — Zod يرفضه ويُطبَّق الافتراضي YER
}
const PAYMENT_METHOD_VALUES = ["cash", "transfer", "kuraimi", "jawali", "bank", "other"] as const;
const FOLLOWUP_TYPE_VALUES = ["manual", "sales", "support", "collection", "reminder"] as const;

// get_order_status (الدفعة 3): خرائط عربية لحالات الطلب/التوصيل/الدفع — مع سقوط آمن للقيمة الخام.
const ORDER_STATUS_LABELS: Record<string, string> = {
  new: "جديد",
  confirmed: "مؤكّد",
  processing: "قيد المعالجة",
  completed: "مكتمل",
  delivered: "تم التسليم",
  cancelled: "ملغى",
  returned: "مُرتجع",
};
const DELIVERY_TYPE_LABELS: Record<string, string> = {
  pickup: "استلام من المتجر",
  local: "توصيل محلي (مندوب)",
  shipping: "شحن عبر مكتب نقل",
};
const DELIVERY_STATUS_LABELS: Record<string, string> = {
  preparing: "قيد التجهيز",
  ready: "جاهز للتسليم",
  out_for_delivery: "في الطريق إليك",
  handed_to_carrier: "سُلّم لمكتب النقل",
  delivered: "تم التسليم",
};
const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "غير مدفوع",
  partial: "مدفوع جزئياً",
  paid: "مدفوع بالكامل",
};

function arLabel(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "";
  return map[value] ?? value;
}

const createOrderSchema = z.object({
  currency: z.preprocess(coerceCurrency, z.enum(CURRENCY_VALUES).default("YER")),
  channel: z.enum(ORDER_CHANNEL_VALUES).default("whatsapp"),
  discount: z.preprocess((v) => (v === undefined || v === null ? 0 : Number(v)), z.number().min(0).default(0)),
  notes: z.string().max(1000).optional(),
  items: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(500).optional(),
    quantity: z.preprocess((v) => (v === undefined || v === null ? 1 : Number(v)), z.number().int().min(1).max(999).default(1)),
    unitPrice: z.preprocess((v) => (v === undefined || v === null ? 0 : Number(v)), z.number().min(0).max(999999999).default(0)),
    currency: z.preprocess(coerceCurrency, z.enum(CURRENCY_VALUES)).optional(),
  })).max(20).optional(),
});

const paymentClaimSchema = z.object({
  amount: z.number().positive(),
  currency: z.enum(CURRENCY_VALUES).default("YER"),
  method: z.enum(PAYMENT_METHOD_VALUES).default("other"),
  paymentMethodId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  reference: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
  paidAt: z.string().datetime().optional(),
});

const followupSchema = z.object({
  dueAt: z.string().datetime(),
  type: z.enum(FOLLOWUP_TYPE_VALUES).default("manual"),
  notes: z.string().max(1000).optional(),
  assignedMembershipId: z.string().uuid().optional(),
});

const productMediaSchema = z.object({
  productId: z.string().uuid().optional(),
  externalProductId: z.string().trim().min(1).max(255).optional(),
  productName: z.string().trim().min(1).max(255).optional(),
  caption: z.string().trim().max(900).optional(),
}).refine((value) => value.productId || value.externalProductId || value.productName, {
  message: "productId, externalProductId, or productName is required",
});

const handoffSchema = z.object({
  reason: z.string().trim().min(1).max(500).default("Agent requested human handoff"),
});

const TOOL_LABELS: Record<AgentToolKey, string> = {
  create_order: "Create a new order linked to the current conversation/contact.",
  log_payment_claim: "Log a pending payment claim for human review. Never confirms money.",
  schedule_followup: "Schedule a future follow-up for the current contact.",
  send_product_media: "Send one product image from the merchant's inventory to the customer on the current channel (WhatsApp, Instagram, or Messenger).",
  handoff_to_human: "Move the conversation to human handling immediately.",
};

function isAgentToolKey(value: string): value is AgentToolKey {
  return (AGENT_TOOL_KEYS as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function publicToolSpec(tool: ToolPolicy): string {
  const base = `${tool.key}: ${TOOL_LABELS[tool.key]}`;
  if (tool.key === "create_order") {
    return `${base} Arguments: currency (use ISO code: YER for ريال يمني, SAR for ريال سعودي, USD for دولار), channel, discount, notes, items[{name, quantity, unitPrice, currency, description}].`;
  }
  if (tool.key === "log_payment_claim") {
    return `${base} Arguments: amount, currency, method, paymentMethodId, orderId, reference, notes, paidAt.`;
  }
  if (tool.key === "schedule_followup") {
    return `${base} Arguments: dueAt as ISO datetime, type, notes, assignedMembershipId.`;
  }
  if (tool.key === "send_product_media") {
    return `${base} Arguments: productId or externalProductId or productName, caption.`;
  }
  return `${base} Arguments: reason.`;
}

export async function loadExecutableAgentTools(workspaceId: string, agentId: string): Promise<ToolPolicy[]> {
  const rows = await db
    .select()
    .from(aiAgentToolsTable)
    .where(and(eq(aiAgentToolsTable.workspaceId, workspaceId), eq(aiAgentToolsTable.agentId, agentId)));

  return rows
    .filter((row) => row.isEnabled && !row.requiresApproval && isAgentToolKey(row.toolKey))
    .map((row) => ({
      key: row.toolKey as AgentToolKey,
      requiresApproval: row.requiresApproval,
      config: asRecord(row.config),
    }));
}

export function buildAgentToolPrompt(tools: ToolPolicy[]): string {
  if (tools.length === 0) return "";
  return [
    "Available server-side tools:",
    ...tools.map((tool) => `- ${publicToolSpec(tool)}`),
    "",
    "Return strict JSON only in this shape:",
    "{\"reply\":\"customer-facing Arabic reply\",\"tool_calls\":[{\"name\":\"create_order\",\"arguments\":{}}]}",
    "Use tool_calls only when the customer clearly asked for that action and required facts are present.",
    "Never claim a tool action was completed unless you requested the matching tool call.",
    "For payments, only log a pending claim. Never confirm or reject payments.",
    "If no tool is needed, return tool_calls as an empty array.",
  ].join("\n");
}

// استدعاء الأدوات الأصلي (native function calling): يحوّل كل ToolPolicy مفعّلة إلى AiFunctionDeclaration
// (اسم + وصف + JSON Schema) يفهمه Gemini/Vertex مباشرة — يُغني تدريجياً عن buildAgentToolPrompt النصّي الهشّ.
// هذه الدالة بناء فقط (لا تُستدعى بعد من أي مسار تنفيذي) — الأساس لتبديل مسار الوكيل لاحقاً.
function buildOrderItemParametersSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      name: { type: "string", description: "Item name." },
      description: { type: "string", description: "Optional item description." },
      quantity: { type: "integer", description: "Quantity ordered (whole number)." },
      unitPrice: { type: "number", description: "Price per unit." },
      currency: {
        type: "string",
        description: "ISO code: YER for ريال يمني, SAR for ريال سعودي, USD for دولار.",
        enum: [...CURRENCY_VALUES],
      },
    },
    required: ["name", "quantity", "unitPrice"],
  };
}

function buildToolParametersSchema(key: AgentToolKey): Record<string, unknown> {
  if (key === "create_order") {
    return {
      type: "object",
      properties: {
        currency: {
          type: "string",
          description: "ISO code: YER for ريال يمني, SAR for ريال سعودي, USD for دولار.",
          enum: [...CURRENCY_VALUES],
        },
        channel: {
          type: "string",
          description: "Order origin channel.",
          enum: [...ORDER_CHANNEL_VALUES],
        },
        discount: { type: "number", description: "Flat discount amount to subtract from the order total." },
        notes: { type: "string", description: "Free-text notes about the order." },
        items: {
          type: "array",
          description: "Order line items.",
          items: buildOrderItemParametersSchema(),
        },
      },
      required: ["items"],
    };
  }

  if (key === "log_payment_claim") {
    return {
      type: "object",
      properties: {
        amount: { type: "number", description: "Claimed payment amount." },
        currency: {
          type: "string",
          description: "ISO code: YER for ريال يمني, SAR for ريال سعودي, USD for دولار.",
          enum: [...CURRENCY_VALUES],
        },
        method: {
          type: "string",
          description: "Payment method used by the customer.",
          enum: [...PAYMENT_METHOD_VALUES],
        },
        paymentMethodId: { type: "string", description: "UUID of a configured payment method, if known." },
        orderId: { type: "string", description: "UUID of the related order, if known." },
        reference: { type: "string", description: "Payment reference/transaction number, if provided." },
        notes: { type: "string", description: "Free-text notes about the claim." },
        paidAt: { type: "string", description: "ISO datetime the payment was made, if known." },
      },
      required: ["amount"],
    };
  }

  if (key === "schedule_followup") {
    return {
      type: "object",
      properties: {
        dueAt: { type: "string", description: "dueAt as ISO datetime." },
        type: {
          type: "string",
          description: "Follow-up category.",
          enum: [...FOLLOWUP_TYPE_VALUES],
        },
        notes: { type: "string", description: "Free-text notes about the follow-up." },
        assignedMembershipId: { type: "string", description: "UUID of the team member to assign, if known." },
      },
      required: ["dueAt"],
    };
  }

  if (key === "send_product_media") {
    return {
      type: "object",
      properties: {
        productId: { type: "string", description: "Inventory product UUID. Provide one of productId, externalProductId, or productName." },
        externalProductId: { type: "string", description: "Inventory product SKU. Provide one of productId, externalProductId, or productName." },
        productName: { type: "string", description: "Inventory product name to fuzzy-match. Provide one of productId, externalProductId, or productName." },
        caption: { type: "string", description: "Optional caption to send with the product image." },
      },
      required: [],
    };
  }

  return {
    type: "object",
    properties: {
      reason: { type: "string", description: "Reason the conversation is being handed off to a human." },
    },
    required: [],
  };
}

export function buildAgentToolDeclarations(tools: ToolPolicy[]): AiFunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.key,
    description: publicToolSpec(tool),
    parameters: buildToolParametersSchema(tool.key),
  }));
}

// النماذج كثيراً ما تُخرج JSON بأسطر/أحرف تحكّم حقيقية داخل قيمة النص، فيكسر JSON.parse.
// نهرّب أحرف التحكّم داخل السلاسل فقط (لا نلمس بنية الكائن) لإنقاذ التحليل.
function escapeControlCharsInJsonStrings(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === "\\") { out += ch; escaped = true; continue; }
    if (ch === "\"") { inString = !inString; out += ch; continue; }
    if (inString) {
      const code = raw.charCodeAt(i);
      if (code < 0x20) {
        if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else out += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function decodeJsonStringBody(body: string): string {
  try {
    // أزِل أي backslash معلّق من escape مقطوع قبل المحاولة.
    return (JSON.parse(`"${body.replace(/\\+$/, "")}"`) as string).trim();
  } catch {
    return body
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\")
      .replace(/\\+$/, "")
      .trim();
  }
}

function extractReplyHeuristic(content: string): string | null {
  // 1) قيمة reply مكتملة (باقتباس ختامي).
  const full = content.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (full) return decodeJsonStringBody(full[1]);
  // 2) JSON مقطوع: لا اقتباس ختامي — خذ كل ما بعد "reply":" حتى نهاية النص (فئة PD-8).
  const truncated = content.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)$/);
  if (truncated) {
    const decoded = decodeJsonStringBody(truncated[1]);
    return decoded || null;
  }
  return null;
}

export function parseAgentToolResponse(content: string): { reply: string; toolCalls: AgentToolCall[] } {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) {
    // JSON مقطوع بلا قوس إغلاق (PD-8): لا تُرجع الخام للعميل — حاول استخراج نصّ reply.
    const heuristic = extractReplyHeuristic(content);
    return { reply: heuristic ?? content.trim(), toolCalls: [] };
  }

  const candidate = content.slice(start, end + 1);
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    try {
      parsed = JSON.parse(escapeControlCharsInJsonStrings(candidate)) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    // آخر خط دفاع: لا تُرسل JSON خاماً للعميل أبداً — استخرج النص يدوياً.
    const heuristic = extractReplyHeuristic(candidate);
    return { reply: heuristic ?? content.trim(), toolCalls: [] };
  }

  const reply = typeof parsed.reply === "string" && parsed.reply.trim()
    ? parsed.reply.trim()
    : "تم استلام طلبك، وسنراجع التفاصيل ونؤكدها لك.";
  const toolCalls = Array.isArray(parsed.tool_calls)
    ? parsed.tool_calls
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({ name: String(item.name ?? ""), arguments: item.arguments }))
      .filter((item) => item.name)
      .slice(0, 3)
    : [];
  return { reply, toolCalls };
}

async function loadConversation(workspaceId: string, conversationId: string): Promise<ConversationContext> {
  const [conversation] = await db
    .select({
      id: conversationsTable.id,
      workspaceId: conversationsTable.workspaceId,
      contactId: conversationsTable.contactId,
      channel: conversationsTable.channel,
      channelAccountId: conversationsTable.channelAccountId,
      externalThreadId: conversationsTable.externalThreadId,
    })
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.workspaceId, workspaceId)))
    .limit(1);

  if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
  return conversation;
}

/**
 * get_order_status (الدفعة 3 — نطاق 11): سياق حالة طلبات العميل الحالي للوكيل.
 * بنية الردّ أحادية التمرير (لا function calling بعد) → نحقن الحالة في السياق بدل tool_call،
 * فيردّ الوكيل بمعلومة دقيقة في رسالة واحدة بلا هلوسة. عزل صارم: workspaceId + contactId.
 * يُرجع نصّاً عربياً مختصراً (أو "" إن لا عميل/طلبات). حقول مرئية للعميل فقط — لا ملاحظات داخلية.
 */
export async function loadOrderStatusContext(
  workspaceId: string,
  conversationId: string,
  limit = 3,
): Promise<string> {
  const [conversation] = await db
    .select({ contactId: conversationsTable.contactId })
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.workspaceId, workspaceId)))
    .limit(1);
  if (!conversation?.contactId) return "";

  const rows = await db
    .select({
      orderNumber: ordersTable.orderNumber,
      status: ordersTable.status,
      totalAmount: ordersTable.totalAmount,
      currency: ordersTable.currency,
      paymentStatus: ordersTable.paymentStatus,
      deliveryType: ordersTable.deliveryType,
      deliveryStatus: ordersTable.deliveryStatus,
      deliveryAgentPhone: ordersTable.deliveryAgentPhone,
      carrierName: ordersTable.carrierName,
      carrierPhone: ordersTable.carrierPhone,
      deliveredAt: ordersTable.deliveredAt,
      codEnabled: ordersTable.codEnabled,
    })
    .from(ordersTable)
    .where(and(eq(ordersTable.workspaceId, workspaceId), eq(ordersTable.contactId, conversation.contactId)))
    .orderBy(desc(ordersTable.createdAt))
    .limit(limit * 3);
  if (rows.length === 0) return "";

  // منع التكرار: قد توجد صفوف بنفس رقم الطلب (سباق توليد الرقم) — اعرض كل رقم مرّة واحدة فقط.
  const seen = new Set<string>();
  const orders: typeof rows = [];
  for (const row of rows) {
    if (seen.has(row.orderNumber)) continue;
    seen.add(row.orderNumber);
    orders.push(row);
    if (orders.length >= limit) break;
  }

  const lines = orders.map((order) => {
    const parts: string[] = [`طلب ${order.orderNumber}`, `الحالة: ${arLabel(ORDER_STATUS_LABELS, order.status)}`];
    if (order.deliveryType) parts.push(`التسليم: ${arLabel(DELIVERY_TYPE_LABELS, order.deliveryType)}`);
    if (order.deliveryStatus) parts.push(`حالة التوصيل: ${arLabel(DELIVERY_STATUS_LABELS, order.deliveryStatus)}`);
    if (order.deliveryAgentPhone) parts.push(`رقم المندوب: ${order.deliveryAgentPhone}`);
    if (order.carrierName) {
      parts.push(`مكتب النقل: ${order.carrierName}${order.carrierPhone ? ` (${order.carrierPhone})` : ""}`);
    }
    parts.push(`الإجمالي: ${order.totalAmount} ${order.currency}`);
    parts.push(`الدفع: ${arLabel(PAYMENT_STATUS_LABELS, order.paymentStatus)}${order.codEnabled ? " — عند الاستلام" : ""}`);
    if (order.deliveredAt) parts.push(`تاريخ التسليم: ${order.deliveredAt.toISOString().slice(0, 10)}`);
    return `- ${parts.join(" | ")}`;
  });

  return [
    "حالة طلبات هذا العميل (للرجوع فقط إن سأل عن حالة طلبه أو توصيله — لا تذكرها تلقائياً، ولا تخمّن ما هو غير مذكور هنا):",
    ...lines,
  ].join("\n");
}

// تأريض الأسعار (3 يوليو 2026): حادثة «299 ريال» أثبتت أن قاعدة «لا تخترع أسعاراً»
// النصية وحدها لا تكفي — النموذج اخترع سعراً رغمها. الحل الجذري: حقن كتالوج المخزون
// الحقيقي في السياق كقائمة حصرية، فيصير المنع قابلاً للتحقق بدل أن يكون وصية مجردة.
export async function loadProductCatalogContext(workspaceId: string, limit = 40): Promise<string> {
  const products = await db
    .select({
      name: inventoryProductsTable.name,
      price: inventoryProductsTable.price,
      currency: inventoryProductsTable.currency,
      unit: inventoryProductsTable.unit,
      quantityAvailable: inventoryProductsTable.quantityAvailable,
    })
    .from(inventoryProductsTable)
    .where(and(
      eq(inventoryProductsTable.workspaceId, workspaceId),
      eq(inventoryProductsTable.isArchived, false),
      eq(inventoryProductsTable.status, "active"),
    ))
    .orderBy(desc(inventoryProductsTable.updatedAt))
    .limit(limit);
  if (products.length === 0) return "";

  const lines = products.map((product) => {
    const availability = product.quantityAvailable == null
      ? ""
      : product.quantityAvailable > 0
        ? ` | المتوفر: ${product.quantityAvailable}${product.unit ? ` ${product.unit}` : ""}`
        : " | غير متوفر حالياً";
    return `- ${product.name}: ${product.price} ${product.currency}${availability}`;
  });

  return [
    "كتالوج المنتجات والأسعار (القائمة الحصرية للأسعار والتوفر — أي منتج أو سعر غير مذكور هنا وغير موجود في معرفة قاعدة البيانات يُعامل كغير متوفر لديك ولا يُذكر له رقم):",
    ...lines,
  ].join("\n");
}

async function appendToolNote(params: {
  workspaceId: string;
  conversationId: string;
  content: string;
  aiRunId: string;
  agentId: string;
}): Promise<void> {
  const [message] = await db.insert(messagesTable).values({
    workspaceId: params.workspaceId,
    conversationId: params.conversationId,
    direction: "internal",
    senderType: "agent",
    senderName: "AI Agent",
    source: "agent_tool",
    contentType: "note",
    content: params.content,
    isPrivateNote: true,
    deliveryStatus: "sent",
    providerPayload: { aiRunId: params.aiRunId, agentId: params.agentId },
    sentAt: new Date(),
  }).returning({ id: messagesTable.id });

  emitWorkspaceEvent({
    workspaceId: params.workspaceId,
    type: "message.created",
    entityType: "message",
    entityId: message.id,
    payload: { conversationId: params.conversationId, source: "agent_tool", internal: true },
  });
}

async function emitToolDomainEvent(params: {
  workspaceId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(domainEventsTable).values({
    workspaceId: params.workspaceId,
    eventType: params.eventType,
    entityType: params.entityType,
    entityId: params.entityId,
    payload: params.payload ?? {},
  });

  emitWorkspaceEvent({
    workspaceId: params.workspaceId,
    type: params.eventType,
    entityType: params.entityType,
    entityId: params.entityId,
    payload: params.payload ?? {},
  });
}

async function recalcOrderTotal(orderId: string, workspaceId: string): Promise<void> {
  const [{ itemsSum }] = await db.select({ itemsSum: sum(orderItemsTable.total) })
    .from(orderItemsTable)
    .where(and(eq(orderItemsTable.orderId, orderId), eq(orderItemsTable.workspaceId, workspaceId)));
  const [order] = await db.select({ discount: ordersTable.discount, paidAmount: ordersTable.paidAmount })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.workspaceId, workspaceId)))
    .limit(1);
  const total = Math.max(0, Number(itemsSum ?? 0) - Number(order?.discount ?? 0));
  const paid = Number(order?.paidAmount ?? 0);
  const paymentStatus = paid <= 0 ? "unpaid" : paid >= total ? "paid" : "partial";
  await db.update(ordersTable)
    .set({ totalAmount: String(total), paymentStatus, updatedAt: new Date() })
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.workspaceId, workspaceId)));
}

async function executeCreateOrder(params: ExecuteParams, conversation: ConversationContext, args: unknown): Promise<AgentToolResult> {
  const data = createOrderSchema.parse(args);
  const [{ total: existingCount }] = await db.select({ total: count() })
    .from(ordersTable)
    .where(eq(ordersTable.workspaceId, params.workspaceId));
  const orderNumber = `ORD${String(Number(existingCount) + 1).padStart(5, "0")}`;

  const [order] = await db.insert(ordersTable).values({
    workspaceId: params.workspaceId,
    orderNumber,
    status: "new",
    channel: data.channel,
    contactId: conversation.contactId,
    conversationId: conversation.id,
    currency: data.currency,
    discount: String(data.discount),
    notes: data.notes ?? null,
    createdBy: params.systemUserId,
  }).returning();

  if (data.items?.length) {
    await db.insert(orderItemsTable).values(data.items.map((item) => ({
      workspaceId: params.workspaceId,
      orderId: order.id,
      name: item.name,
      description: item.description ?? null,
      quantity: item.quantity,
      unitPrice: String(item.unitPrice),
      currency: item.currency ?? data.currency,
      total: String(item.quantity * item.unitPrice),
    })));
    await recalcOrderTotal(order.id, params.workspaceId);
  }

  await createAuditLog({
    workspaceId: params.workspaceId,
    actorType: "ai",
    actorId: params.agentId,
    actorLabel: "AI Agent",
    action: "create",
    entityType: "order",
    entityId: order.id,
    entityLabel: `Order ${order.orderNumber}`,
    newData: { orderNumber: order.orderNumber, conversationId: conversation.id, aiRunId: params.aiRunId },
  });

  if (conversation.contactId) {
    await addContactTimeline({
      workspaceId: params.workspaceId,
      contactId: conversation.contactId,
      eventType: "order_created",
      title: `Created order ${order.orderNumber}`,
      entityType: "order",
      entityId: order.id,
      createdBy: params.systemUserId,
      metadata: { source: "agent_tool", aiRunId: params.aiRunId },
    });
  }

  await emitToolDomainEvent({
    workspaceId: params.workspaceId,
    eventType: "order.created",
    entityType: "order",
    entityId: order.id,
    payload: { orderNumber: order.orderNumber, conversationId: conversation.id, contactId: conversation.contactId, source: "agent_tool" },
  });

  return {
    tool: "create_order",
    status: "success",
    entityType: "order",
    entityId: order.id,
    summary: `Created order ${order.orderNumber}`,
    customerVisible: true,
  };
}

async function resolvePaymentMethod(workspaceId: string, data: z.infer<typeof paymentClaimSchema>) {
  if (!data.paymentMethodId) {
    return {
      method: data.method,
      paymentMethodId: null,
      methodSnapshot: null as Record<string, unknown> | null,
    };
  }

  const [method] = await db.select()
    .from(paymentMethodsTable)
    .where(and(eq(paymentMethodsTable.id, data.paymentMethodId), eq(paymentMethodsTable.workspaceId, workspaceId)))
    .limit(1);
  if (!method) throw new Error("PAYMENT_METHOD_NOT_FOUND");
  if (!method.isActive) throw new Error("PAYMENT_METHOD_INACTIVE");

  return {
    method: method.slug,
    paymentMethodId: method.id,
    methodSnapshot: {
      id: method.id,
      slug: method.slug,
      labelAr: method.labelAr,
      labelEn: method.labelEn,
      requiresReference: method.requiresReference,
      requiresReceipt: method.requiresReceipt,
    },
  };
}

async function resolvePaymentBaseAmount(workspaceId: string, currency: string, amount: number) {
  if (currency === "YER") {
    return {
      baseAmountYer: String(amount),
      exchangeRateId: null as string | null,
      exchangeRateSnapshot: { rate: 1, fromCurrency: "YER", toCurrency: "YER" } as Record<string, unknown>,
    };
  }

  const [rate] = await db.select().from(exchangeRatesTable)
    .where(and(
      eq(exchangeRatesTable.workspaceId, workspaceId),
      eq(exchangeRatesTable.fromCurrency, currency),
      eq(exchangeRatesTable.toCurrency, "YER"),
    ))
    .orderBy(desc(exchangeRatesTable.effectiveAt))
    .limit(1);
  if (!rate || Number(rate.rate) <= 0) throw new Error("NO_EXCHANGE_RATE");

  return {
    baseAmountYer: String(amount * Number(rate.rate)),
    exchangeRateId: rate.id,
    exchangeRateSnapshot: {
      id: rate.id,
      fromCurrency: rate.fromCurrency,
      toCurrency: rate.toCurrency,
      rate: rate.rate,
      effectiveAt: rate.effectiveAt,
    },
  };
}

async function executePaymentClaim(params: ExecuteParams, conversation: ConversationContext, args: unknown): Promise<AgentToolResult> {
  const data = paymentClaimSchema.parse(args);
  const method = await resolvePaymentMethod(params.workspaceId, data);
  const exchange = await resolvePaymentBaseAmount(params.workspaceId, data.currency, data.amount);

  let orderContactId: string | null = null;
  if (data.orderId) {
    const [order] = await db.select({ id: ordersTable.id, contactId: ordersTable.contactId, status: ordersTable.status })
      .from(ordersTable)
      .where(and(eq(ordersTable.id, data.orderId), eq(ordersTable.workspaceId, params.workspaceId)))
      .limit(1);
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (order.status === "cancelled" || order.status === "returned") throw new Error("ORDER_TERMINAL_STATE");
    orderContactId = order.contactId;
  }

  const effectiveContactId = conversation.contactId ?? orderContactId;
  const [payment] = await db.insert(paymentsTable).values({
    workspaceId: params.workspaceId,
    amount: String(data.amount),
    currency: data.currency,
    method: method.method,
    paymentMethodId: method.paymentMethodId,
    methodSnapshot: method.methodSnapshot,
    exchangeRateId: exchange.exchangeRateId,
    exchangeRateSnapshot: exchange.exchangeRateSnapshot,
    baseAmountYer: exchange.baseAmountYer,
    paidAt: data.paidAt ? new Date(data.paidAt) : null,
    status: "pending",
    contactId: effectiveContactId,
    orderId: data.orderId ?? null,
    reference: data.reference ?? null,
    notes: data.notes ?? null,
    createdBy: params.systemUserId,
  }).returning();

  await createAuditLog({
    workspaceId: params.workspaceId,
    actorType: "ai",
    actorId: params.agentId,
    actorLabel: "AI Agent",
    action: "create",
    entityType: "payment",
    entityId: payment.id,
    entityLabel: `${data.amount} ${data.currency} - ${method.method}`,
    newData: { status: "pending", conversationId: conversation.id, aiRunId: params.aiRunId },
  });

  if (effectiveContactId) {
    await addContactTimeline({
      workspaceId: params.workspaceId,
      contactId: effectiveContactId,
      eventType: "payment_created",
      title: `Logged pending payment claim ${data.amount} ${data.currency}`,
      entityType: "payment",
      entityId: payment.id,
      createdBy: params.systemUserId,
      metadata: { source: "agent_tool", aiRunId: params.aiRunId },
    });
  }

  emitWorkspaceEvent({
    workspaceId: params.workspaceId,
    type: "payment.created",
    entityType: "payment",
    entityId: payment.id,
    payload: { status: "pending", conversationId: conversation.id, source: "agent_tool" },
  });

  return {
    tool: "log_payment_claim",
    status: "success",
    entityType: "payment",
    entityId: payment.id,
    summary: `Logged pending payment claim ${data.amount} ${data.currency}`,
    customerVisible: true,
  };
}

async function executeFollowup(params: ExecuteParams, conversation: ConversationContext, args: unknown): Promise<AgentToolResult> {
  const data = followupSchema.parse(args);
  if (!conversation.contactId) throw new Error("CONVERSATION_HAS_NO_CONTACT");

  const [contact] = await db.select({ id: contactsTable.id, name: contactsTable.name })
    .from(contactsTable)
    .where(and(eq(contactsTable.id, conversation.contactId), eq(contactsTable.workspaceId, params.workspaceId)))
    .limit(1);
  if (!contact) throw new Error("CONTACT_NOT_FOUND");

  const [followup] = await db.insert(followupsTable).values({
    workspaceId: params.workspaceId,
    contactId: conversation.contactId,
    conversationId: conversation.id,
    assignedMembershipId: data.assignedMembershipId ?? null,
    type: data.type,
    dueAt: new Date(data.dueAt),
    notes: data.notes ?? null,
    createdBy: params.systemUserId,
    status: "pending",
  }).returning();

  await createAuditLog({
    workspaceId: params.workspaceId,
    actorType: "ai",
    actorId: params.agentId,
    actorLabel: "AI Agent",
    action: "create",
    entityType: "followup",
    entityId: followup.id,
    entityLabel: `Follow-up - ${contact.name}`,
    newData: { type: followup.type, dueAt: followup.dueAt, conversationId: conversation.id, aiRunId: params.aiRunId },
  });

  await addContactTimeline({
    workspaceId: params.workspaceId,
    contactId: conversation.contactId,
    eventType: "followup_created",
    title: `Created ${followup.type} follow-up`,
    entityType: "followup",
    entityId: followup.id,
    createdBy: params.systemUserId,
    metadata: { source: "agent_tool", aiRunId: params.aiRunId },
  });

  emitWorkspaceEvent({
    workspaceId: params.workspaceId,
    type: "followup.created",
    entityType: "followup",
    entityId: followup.id,
    payload: { conversationId: conversation.id, source: "agent_tool" },
  });

  return {
    tool: "schedule_followup",
    status: "success",
    entityType: "followup",
    entityId: followup.id,
    summary: `Scheduled follow-up for ${followup.dueAt.toISOString()}`,
  };
}

async function executeSendProductMedia(params: ExecuteParams, conversation: ConversationContext, args: unknown): Promise<AgentToolResult> {
  const data = productMediaSchema.parse(args);
  if (!conversation.channelAccountId || !conversation.externalThreadId) throw new Error("MISSING_WHATSAPP_DESTINATION");

  let product;
  if (data.productId) {
    [product] = await db.select().from(inventoryProductsTable)
      .where(and(eq(inventoryProductsTable.id, data.productId), eq(inventoryProductsTable.workspaceId, params.workspaceId)))
      .limit(1);
  } else if (data.externalProductId) {
    [product] = await db.select().from(inventoryProductsTable)
      .where(and(eq(inventoryProductsTable.sku, data.externalProductId), eq(inventoryProductsTable.workspaceId, params.workspaceId)))
      .limit(1);
  } else if (data.productName) {
    [product] = await db.select().from(inventoryProductsTable)
      .where(and(eq(inventoryProductsTable.workspaceId, params.workspaceId), eq(inventoryProductsTable.isArchived, false), ilike(inventoryProductsTable.name, `%${data.productName}%`)))
      .orderBy(desc(inventoryProductsTable.updatedAt))
      .limit(1);
  }

  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  if (!product.imageUrl) throw new Error("PRODUCT_HAS_NO_IMAGE");

  const captionParts = [
    data.caption ?? product.name,
    Number(product.price) > 0 ? `${product.price} ${product.currency ?? ""}`.trim() : "",
  ].filter(Boolean);
  const caption = captionParts.join("\n").slice(0, 1000);

  // PD-4: route product media by the conversation's channel (not hardcoded WhatsApp).
  // Worker sends the image via {channel}.media; for IG/Messenger we also pass `text` (caption)
  // because their media payload has no caption field, so the name/price arrive as a follow-up.
  const mediaEventType = conversation.channel === "instagram"
    ? "message.send.instagram.media"
    : conversation.channel === "messenger"
      ? "message.send.messenger.media"
      : "message.send.whatsapp.media";

  const [event] = await db.insert(outboxEventsTable).values({
    workspaceId: params.workspaceId,
    eventType: mediaEventType,
    entityType: "conversation",
    entityId: conversation.id,
    idempotencyKey: `tool:product-media:${params.aiRunId}:${product.id}`,
    payload: {
      channelAccountId: conversation.channelAccountId,
      conversationId: conversation.id,
      to: conversation.externalThreadId,
      mediaType: "image",
      mediaUrl: product.imageUrl,
      caption,
      text: conversation.channel === "instagram" || conversation.channel === "messenger" ? caption : undefined,
      productId: product.id,
      aiRunId: params.aiRunId,
      autoReply: true,
    },
    status: "pending",
    nextAttemptAt: new Date(),
  }).onConflictDoNothing().returning({ id: outboxEventsTable.id });

  return {
    tool: "send_product_media",
    status: "success",
    entityType: "outbox_event",
    entityId: event?.id ?? undefined,
    summary: `Queued product media for ${product.name}`,
    customerVisible: true,
  };
}

async function executeHandoff(params: ExecuteParams, conversation: ConversationContext, args: unknown): Promise<AgentToolResult> {
  const data = handoffSchema.parse(args);
  await db.update(conversationsTable)
    .set({
      agentStatus: "human",
      needsHuman: true,
      escalationReason: data.reason,
      updatedAt: new Date(),
    })
    .where(and(eq(conversationsTable.id, conversation.id), eq(conversationsTable.workspaceId, params.workspaceId)));

  await createAuditLog({
    workspaceId: params.workspaceId,
    actorType: "ai",
    actorId: params.agentId,
    actorLabel: "AI Agent",
    action: "agent_status_change",
    severity: "warning",
    entityType: "conversation",
    entityId: conversation.id,
    newData: { agentStatus: "human", reason: data.reason, aiRunId: params.aiRunId },
  });

  emitWorkspaceEvent({
    workspaceId: params.workspaceId,
    type: "conversation.needs_human",
    entityType: "conversation",
    entityId: conversation.id,
    payload: { reason: data.reason, source: "agent_tool" },
  });

  return {
    tool: "handoff_to_human",
    status: "success",
    entityType: "conversation",
    entityId: conversation.id,
    summary: `Handed off to human: ${data.reason}`,
  };
}

async function executeOne(params: ExecuteParams, conversation: ConversationContext, call: AgentToolCall): Promise<AgentToolResult> {
  if (!isAgentToolKey(call.name)) {
    return { tool: "handoff_to_human", status: "skipped", summary: `Unknown tool requested: ${call.name}` };
  }

  const enabledTools = await loadExecutableAgentTools(params.workspaceId, params.agentId);
  if (!enabledTools.some((tool) => tool.key === call.name)) {
    return { tool: call.name, status: "skipped", summary: `Tool is not enabled for automatic execution: ${call.name}` };
  }

  if (call.name === "create_order") return executeCreateOrder(params, conversation, call.arguments);
  if (call.name === "log_payment_claim") return executePaymentClaim(params, conversation, call.arguments);
  if (call.name === "schedule_followup") return executeFollowup(params, conversation, call.arguments);
  if (call.name === "send_product_media") return executeSendProductMedia(params, conversation, call.arguments);
  return executeHandoff(params, conversation, call.arguments);
}

export async function executeAgentToolCalls(params: ExecuteParams): Promise<AgentToolResult[]> {
  if (params.calls.length === 0) return [];

  const conversation = await loadConversation(params.workspaceId, params.conversationId);
  const results: AgentToolResult[] = [];
  for (const call of params.calls.slice(0, 3)) {
    try {
      const result = await executeOne(params, conversation, call);
      results.push(result);
      await appendToolNote({
        workspaceId: params.workspaceId,
        conversationId: params.conversationId,
        aiRunId: params.aiRunId,
        agentId: params.agentId,
        content: `Agent tool ${result.status}: ${result.summary}`,
      });
    } catch (err) {
      const summary = err instanceof Error ? err.message : String(err);
      const tool = isAgentToolKey(call.name) ? call.name : "handoff_to_human";
      results.push({ tool, status: "failed", summary });
      await appendToolNote({
        workspaceId: params.workspaceId,
        conversationId: params.conversationId,
        aiRunId: params.aiRunId,
        agentId: params.agentId,
        content: `Agent tool failed: ${call.name} - ${summary}`,
      });
    }
  }

  return results;
}
