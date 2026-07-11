// meta-history-ingest.ts — تعايش واتساب (Coexistence): استخراج نقيّ (بلا قاعدة بيانات)
// لرسائل سجل الدردشة القديم من حمولة webhook بحقل change.field === "history".
// معزول في ملفه الخاص عمداً ليكون قابلاً للاختبار مباشرة بلا محاكاة DB/Express —
// نفس دافع فصل meta-commerce-message.ts عن meta.routes.ts.
//
// شكل الحمولة (موثّق من ميتا لوضع التعايش): value.history[] كل عنصر منها "chunk"
// يحوي threads[]، كل thread له id (= wa_id العميل نفسه) و messages[] بنفس شكل رسائل
// واتساب العادية (id/from/timestamp/type/text.body...). قد يرافقها "contacts" — لا
// نحتاجه (لا عمود لاسم العميل في wa_history_messages)، فقط لا يجب أن يُسبِّب انهياراً.

export type HistoryDirection = "inbound" | "outbound";

export type ExtractedHistoryMessage = {
  customerWaId: string;
  externalMessageId: string;
  direction: HistoryDirection;
  messageType: string | undefined;
  content: string | null;
  messageTimestamp: Date | null;
  raw: unknown;
};

type HistoryMessage = {
  id?: string;
  from?: string;
  to?: string;
  timestamp?: string | number;
  type?: string;
  text?: { body?: string };
  [key: string]: unknown;
};

type HistoryThread = {
  id?: string;
  messages?: HistoryMessage[];
  [key: string]: unknown;
};

type HistoryChunk = {
  metadata?: { phase?: number; chunk_order?: number; progress?: number; [key: string]: unknown };
  threads?: HistoryThread[];
  contacts?: unknown[];
  [key: string]: unknown;
};

// ميتا ترسل الثواني كنص (unix seconds string) كما في رسائل webhook العادية؛ حمولات history
// شوهدت أحياناً بصيغة رقم أيضاً — نتعامل مع الاثنين دفاعياً بدل افتراض شكل واحد. لا نخترع
// "الآن" عند فشل التحويل — تاريخ غير مؤكد (NULL) أفضل من تاريخ خاطئ لرسالة تاريخية.
function parseHistoryTimestamp(timestamp: unknown): Date | null {
  if (typeof timestamp === "string" && /^\d+$/.test(timestamp)) {
    return new Date(Number(timestamp) * 1000);
  }
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return new Date(timestamp * 1000);
  }
  return null;
}

/**
 * يحوّل حمولة change.value (بحقل field === "history") إلى صفوف مسطّحة جاهزة للإدراج في
 * wa_history_messages. pure بالكامل — بلا أي لمس لقاعدة البيانات. كل قيمة مفقودة أو
 * غريبة الشكل تُتجاوز بصمت على مستوى الرسالة/الـthread وحدها (رسالة تالفة واحدة لا يجب
 * أن تُسقط بقية الدفعة) — الحمولات الفعلية شوهدت متفاوتة الشكل عبر مراحل طرح ميتا التدريجي.
 */
// Record<string, unknown> (لا نوع بخصائص اختيارية فقط) عمداً — نوع كـ`{ history?: unknown }`
// يصطدم بفحص TS2559 "weak type" عند تمرير MetaChangeValue (خصائصها الصريحة مختلفة، توقيعها
// الفهرسي فقط هو المشترك)، رغم أن الوصول الفعلي لـ.history آمن تماماً في الحالتين.
export function extractHistoryMessages(value: Record<string, unknown>): ExtractedHistoryMessage[] {
  const rows: ExtractedHistoryMessage[] = [];
  const chunks = Array.isArray(value?.history) ? (value.history as HistoryChunk[]) : [];

  for (const chunk of chunks) {
    const threads = Array.isArray(chunk?.threads) ? chunk.threads : [];

    for (const thread of threads) {
      const customerWaId = typeof thread?.id === "string" && thread.id ? thread.id : undefined;
      // بلا هوية عميل موثوقة لا يمكن حساب الاتجاه ولا ربط الرسالة بمحادثة لاحقاً — تُهمل
      // رسائل هذا الـthread وحده، لا الدفعة كلها.
      if (!customerWaId) continue;

      const messages = Array.isArray(thread?.messages) ? thread.messages : [];

      for (const message of messages) {
        const externalMessageId = typeof message?.id === "string" && message.id ? message.id : undefined;
        if (!externalMessageId) continue; // بلا id لا يوجد مفتاح إزالة تكرار (workspace_id, external_message_id)

        const from = typeof message?.from === "string" ? message.from : undefined;
        // اتجاه الرسالة: مقارنة from بمعرّف الـthread (= wa_id العميل نفسه) أوثق من أي
        // مقارنة برقم العمل — phone_number_id معرّف داخلي عند ميتا وليس بصيغة wa_id
        // قابلة للمقارنة المباشرة مع from/to.
        const direction: HistoryDirection = from === customerWaId ? "inbound" : "outbound";
        const messageType = typeof message?.type === "string" && message.type ? message.type : undefined;
        const content = messageType === "text" ? (message?.text?.body?.trim() || null) : null;

        rows.push({
          customerWaId,
          externalMessageId,
          direction,
          messageType,
          content,
          messageTimestamp: parseHistoryTimestamp(message?.timestamp),
          raw: message,
        });
      }
    }
  }

  return rows;
}
