import { logger } from "./logger";

// ─── Model Mapping (single source of truth) ───────────────────────────────────

const MODEL_MAP: Record<string, string> = {
  gemini_flash: "gemini-1.5-flash",
  gemini_flash_lite: "gemini-1.5-flash-8b",
  gemini_pro: "gemini-1.5-pro",
  mock: "mock",
};

const JSON_TASK_TYPES = new Set(["classify", "extract", "suggest_action"]);
const AI_PROVIDER = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
const VERTEX_PROJECT_ID =
  process.env.VERTEX_PROJECT_ID ??
  process.env.GCP_PROJECT_ID ??
  process.env.GOOGLE_CLOUD_PROJECT ??
  process.env.GCLOUD_PROJECT;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION ?? process.env.GCP_LOCATION ?? process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
const VERTEX_MODEL = process.env.VERTEX_MODEL ?? "gemini-2.5-flash";
const VERTEX_EMBEDDING_MODEL = process.env.VERTEX_EMBEDDING_MODEL ?? "text-embedding-005";
const DEFAULT_TEMPERATURE = Number(process.env.AI_TEMPERATURE ?? "0.3");
const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.AI_MAX_OUTPUT_TOKENS ?? "2048");
const VERTEX_CONFIGURED = AI_PROVIDER === "vertex" && !!VERTEX_PROJECT_ID && !!VERTEX_LOCATION;

logger.info(
  {
    model: VERTEX_MODEL,
    embedding: VERTEX_EMBEDDING_MODEL,
    location: VERTEX_LOCATION,
    dry_run: !VERTEX_CONFIGURED,
  },
  `AI provider initialized: model=${VERTEX_MODEL}, embedding=${VERTEX_EMBEDDING_MODEL}, location=${VERTEX_LOCATION}, dry_run=${!VERTEX_CONFIGURED}`,
);

// ─── Safety system prompt ─────────────────────────────────────────────────────

const SAFETY_SYSTEM_PROMPT = `
قواعد صارمة لا يمكن تجاوزها:
- لا تؤكد أي دفعة مالية ولا ترفضها — سجّل الادعاء فقط وانتظر موافقة بشرية.
- لا تغيّر أي دين أو رصيد مالي مباشرةً.
- لا تغيّر صلاحيات أي مستخدم.
- لا تحذف أي بيانات.
- إن لم تعرف الإجابة، صعّد الأمر لموظف بشري بدلاً من التخمين.
- اللهجة حسب تعليمات الوكيل المحدد.
`.trim();

// ─── Provider detection ───────────────────────────────────────────────────────

export type AiProviderName = "vertex" | "gemini" | "mock";

export const GEMINI_AVAILABLE = !!process.env.GEMINI_API_KEY;
export const ACTIVE_PROVIDER: AiProviderName = VERTEX_CONFIGURED ? "vertex" : GEMINI_AVAILABLE ? "gemini" : "mock";

let _fallbackMode = false;

export function getDefaultModel(): string {
  return ACTIVE_PROVIDER === "vertex" || GEMINI_AVAILABLE ? "gemini_flash" : "mock";
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// vision: صورة inline تُمرَّر للنموذج متعدد الوسائط (Gemini/Vertex). data = base64.
export interface AiImage {
  mimeType: string;
  data: string;
}

export interface AiRunInput {
  messages: AiMessage[];
  model: string;
  taskType: string;
  maxTokens?: number;
  // PD-10: عند تفعيل الأدوات يجب أن يلتزم النموذج بـJSON صارم؛ "json" يفرض responseMimeType ويخفض الحرارة.
  responseFormat?: "json" | "text";
  // vision: صور واردة تُمرَّر للنموذج ليحلّل محتواها (اختياري؛ تُتجاهَل في mock).
  images?: AiImage[];
}

export interface AiRunOutput {
  provider: AiProviderName;
  model: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  fallbackUsed?: boolean;
}

function getMaxOutputTokens(input: AiRunInput): number {
  const requested = input.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  if (!Number.isFinite(requested) || requested <= 0) return 2048;
  return Math.min(Math.floor(requested), 2048);
}

// PD-10: المهمة تتطلّب JSON إمّا بنوعها (classify/extract/…) أو بعلَم صريح (ردود الوكيل عند تفعيل الأدوات).
function wantsJson(input: AiRunInput): boolean {
  return input.responseFormat === "json" || JSON_TASK_TYPES.has(input.taskType);
}

function getTemperature(input?: AiRunInput): number {
  const base = Number.isFinite(DEFAULT_TEMPERATURE) ? Math.min(Math.max(DEFAULT_TEMPERATURE, 0), 1) : 0.3;
  // مخرجات JSON المنظّمة تحتاج حرارة منخفضة لالتزام أعلى بالبنية.
  if (input && wantsJson(input)) return Math.min(base, 0.1);
  return base;
}

function summarizeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message.slice(0, 300),
    };
  }
  return { message: String(err).slice(0, 300) };
}

// ─── Mock provider ────────────────────────────────────────────────────────────

const MOCK_RESPONSES: Record<string, (userContent: string) => string> = {
  summarize: (content) => {
    const len = content.length;
    return `ملخص المحادثة:\n\nتحتوي هذه المحادثة على ${Math.ceil(len / 100)} نقطة رئيسية. العميل تواصل بشأن استفسار أو مشكلة تتعلق بالخدمة. تمت مناقشة التفاصيل وتبادل المعلومات اللازمة. يُنصح بالمتابعة مع العميل للتأكد من رضاه عن الحل المقترح.\n\n[وضع تجريبي — لم يتم ربط Gemini بعد]`;
  },
  classify: () => {
    return JSON.stringify({
      category: "استفسار عام",
      priority: "normal",
      sentiment: "neutral",
      tags: ["استفسار", "دعم"],
      language: "arabic",
      urgency: false,
    });
  },
  draft_reply: (content) => {
    const hasGreeting = content.includes("مرحب") || content.includes("السلام");
    const greeting = hasGreeting ? "وعليكم السلام ورحمة الله وبركاته،" : "مرحباً بك،";
    return `${greeting}\n\nشكراً لتواصلك معنا. لقد استلمنا رسالتك وسنعمل على مساعدتك في أقرب وقت ممكن.\n\nهل يمكنك تزويدنا بمزيد من التفاصيل حتى نتمكن من خدمتك بشكل أفضل؟\n\nمع تحياتنا،\nفريق الدعم\n\n[مسودة — يرجى المراجعة قبل الإرسال]\n[وضع تجريبي — لم يتم ربط Gemini بعد]`;
  },
  knowledge_answer: (content) => {
    const sourceMatch = content.match(/مراجع المعرفة:\s*([\s\S]*?)\n\nالسؤال:/);
    const questionMatch = content.match(/السؤال:\s*([\s\S]*?)\n\nالمطلوب:/);
    const sourceText = sourceMatch?.[1]?.replace(/\[[0-9]+\]/g, "").trim();
    const question = questionMatch?.[1]?.trim() ?? "السؤال";

    if (!sourceText || sourceText.includes("لا توجد مصادر معرفة")) {
      return `لا توجد معلومة كافية في قاعدة المعرفة للإجابة على: ${question}\n\nيفضل إضافة إجابة واضحة في الأسئلة الشائعة قبل استخدام الرد مع العميل.\n\n[اختبار داخلي — لا يتم إرسال أي رسالة]\n[وضع تجريبي — لم يتم ربط Gemini بعد]`;
    }

    const compactSource = sourceText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6)
      .join("\n");

    return `حسب معرفة النشاط المتوفرة:\n${compactSource}\n\nيمكن للموظف مراجعة هذه المسودة وتعديلها قبل الرد على العميل.\n\n[اختبار داخلي — لا يتم إرسال أي رسالة]\n[وضع تجريبي — لم يتم ربط Gemini بعد]`;
  },
  extract: (content) => {
    return JSON.stringify({
      entities: [
        { type: "طلب", value: "استفسار عام", confidence: 0.85 },
      ],
      keywords: content.split(" ").slice(0, 5),
      intent: "استفسار",
      language: "arabic",
    });
  },
  suggest_action: () => {
    return JSON.stringify([
      {
        action_type: "create_ticket",
        label: "إنشاء تذكرة دعم",
        payload: { priority: "normal", category: "general" },
        confidence: 0.8,
        reason: "المحادثة تتضمن طلب دعم يحتاج متابعة",
      },
      {
        action_type: "create_followup",
        label: "إضافة متابعة",
        payload: { type: "call", daysFromNow: 2 },
        confidence: 0.7,
        reason: "ينصح بمتابعة العميل بعد يومين",
      },
    ]);
  },
  report: () => {
    return `تقرير تجريبي:\n\nلا توجد بيانات كافية لإنشاء تقرير مفصل في الوضع التجريبي.\n\n[وضع تجريبي — لم يتم ربط Gemini بعد]`;
  },
};

async function runMock(input: AiRunInput): Promise<AiRunOutput> {
  const userMsg = input.messages.find((m) => m.role === "user")?.content ?? "";
  const respFn = MOCK_RESPONSES[input.taskType] ?? (() => "[وضع تجريبي — استجابة افتراضية]");
  const content = respFn(userMsg);

  const promptTokens = Math.ceil(input.messages.reduce((s, m) => s + m.content.length, 0) / 4);
  const completionTokens = Math.ceil(content.length / 4);

  return {
    provider: "mock",
    model: "mock",
    content,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimatedCost: 0,
  };
}

// ─── Gemini provider ──────────────────────────────────────────────────────────

async function runGemini(input: AiRunInput): Promise<AiRunOutput> {
  if (!process.env.GEMINI_API_KEY) {
    logger.warn("GEMINI_API_KEY not set, falling back to mock");
    _fallbackMode = true;
    return { ...(await runMock(input)), fallbackUsed: true };
  }

  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    const internalModel = input.model in MODEL_MAP ? input.model : "gemini_flash";
    const geminiModelName = MODEL_MAP[internalModel] ?? MODEL_MAP["gemini_flash"];

    const model = genAI.getGenerativeModel({ model: geminiModelName });

    const originalSystem = input.messages.find((m) => m.role === "system")?.content ?? "";
    const systemInstruction = [SAFETY_SYSTEM_PROMPT, originalSystem].filter(Boolean).join("\n\n");
    const userMsgs = input.messages.filter((m) => m.role !== "system");
    const combined = userMsgs.map((m) => m.content).join("\n\n");
    // vision: ألحِق الصور الواردة كأجزاء inline ليحلّلها النموذج بصرياً.
    const imageParts = (input.images ?? []).map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.data },
    }));

    const result = await model.generateContent({
      systemInstruction,
      contents: [{ role: "user", parts: [{ text: combined }, ...imageParts] }],
      generationConfig: {
        maxOutputTokens: getMaxOutputTokens(input),
        temperature: getTemperature(input),
        ...(wantsJson(input) ? { responseMimeType: "application/json" } : {}),
      },
    });

    const content = result.response.text();
    const usage = result.response.usageMetadata;
    const promptTokens = usage?.promptTokenCount ?? Math.ceil(combined.length / 4);
    const completionTokens = usage?.candidatesTokenCount ?? Math.ceil(content.length / 4);

    if (wantsJson(input)) {
      const hasJson = /[\[{]/.test(content);
      if (!hasJson) {
        logger.warn({ taskType: input.taskType }, "Gemini returned non-JSON for structured task, falling back to mock");
        _fallbackMode = true;
        return { ...(await runMock(input)), fallbackUsed: true };
      }
    }

    _fallbackMode = false;

    return {
      provider: "gemini",
      model: geminiModelName,
      content,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCost: (promptTokens * 0.000001 + completionTokens * 0.000003),
      fallbackUsed: false,
    };
  } catch (err) {
    logger.error({ err: summarizeError(err) }, "Gemini API error — تعذر الاتصال بـ Gemini، تم استخدام الوضع التجريبي");
    _fallbackMode = true;
    return { ...(await runMock(input)), fallbackUsed: true };
  }
}

// ─── Vertex AI provider ──────────────────────────────────────────────────────

type VertexGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

async function getMetadataAccessToken(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
      headers: { "Metadata-Flavor": "Google" },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`metadata server token request failed with status ${res.status}`);
    }

    const data = await res.json() as { access_token?: string };
    if (!data.access_token) {
      throw new Error("metadata server did not return access_token");
    }
    return data.access_token;
  } finally {
    clearTimeout(timeout);
  }
}

async function runVertex(input: AiRunInput): Promise<AiRunOutput> {
  if (!VERTEX_CONFIGURED || !VERTEX_PROJECT_ID) {
    logger.warn("Vertex AI is not configured, falling back to mock");
    _fallbackMode = true;
    return { ...(await runMock(input)), fallbackUsed: true };
  }

  try {
    const token = await getMetadataAccessToken();
    const originalSystem = input.messages.find((m) => m.role === "system")?.content ?? "";
    const systemInstruction = [SAFETY_SYSTEM_PROMPT, originalSystem].filter(Boolean).join("\n\n");
    const userMsgs = input.messages.filter((m) => m.role !== "system");
    const combined = userMsgs.map((m) => m.content).join("\n\n");
    // vision: ألحِق الصور الواردة كأجزاء inline ليحلّلها النموذج بصرياً.
    const imageParts = (input.images ?? []).map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.data },
    }));
    const host = VERTEX_LOCATION === "global" ? "aiplatform.googleapis.com" : `${VERTEX_LOCATION}-aiplatform.googleapis.com`;
    const modelPath = `projects/${VERTEX_PROJECT_ID}/locations/${VERTEX_LOCATION}/publishers/google/models/${VERTEX_MODEL}`;
    const endpoint = `https://${host}/v1/${modelPath}:generateContent`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: combined }, ...imageParts] }],
        generationConfig: {
          maxOutputTokens: getMaxOutputTokens(input),
          temperature: getTemperature(input),
          ...(wantsJson(input) ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Vertex AI generateContent failed with status ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json() as VertexGenerateContentResponse;
    const content = data.candidates
      ?.flatMap((candidate) => candidate.content?.parts?.map((part) => part.text ?? "") ?? [])
      .join("\n")
      .trim();

    if (!content) {
      throw new Error("Vertex AI returned an empty response");
    }

    const promptTokens = data.usageMetadata?.promptTokenCount ?? Math.ceil(combined.length / 4);
    const completionTokens = data.usageMetadata?.candidatesTokenCount ?? Math.ceil(content.length / 4);

    if (wantsJson(input)) {
      const hasJson = /[\[{]/.test(content);
      if (!hasJson) {
        logger.warn({ taskType: input.taskType }, "Vertex AI returned non-JSON for structured task, falling back to mock");
        _fallbackMode = true;
        return { ...(await runMock(input)), fallbackUsed: true };
      }
    }

    _fallbackMode = false;

    return {
      provider: "vertex",
      model: VERTEX_MODEL,
      content,
      promptTokens,
      completionTokens,
      totalTokens: data.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens,
      estimatedCost: 0,
      fallbackUsed: false,
    };
  } catch (err) {
    logger.error({ err: summarizeError(err) }, "Vertex AI error — تعذر الاتصال بـ Vertex AI، تم استخدام الوضع التجريبي");
    _fallbackMode = true;
    return { ...(await runMock(input)), fallbackUsed: true };
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runAI(input: AiRunInput): Promise<AiRunOutput> {
  if (ACTIVE_PROVIDER === "vertex") {
    return runVertex(input);
  }
  if (ACTIVE_PROVIDER === "gemini" || input.model.startsWith("gemini")) {
    return runGemini(input);
  }
  return { ...(await runMock(input)), fallbackUsed: true };
}

// ─── Provider status ──────────────────────────────────────────────────────────

export function getProviderStatus(): {
  provider: AiProviderName;
  available: boolean;
  hasGeminiKey: boolean;
  hasVertex: boolean;
  vertexProjectConfigured: boolean;
  vertexLocation: string | null;
  model: string;
  fallbackMode: boolean;
  message: string;
} {
  const hasGeminiKey = GEMINI_AVAILABLE;
  const hasVertex = VERTEX_CONFIGURED;

  if (ACTIVE_PROVIDER === "vertex" && hasVertex && !_fallbackMode) {
    return {
      provider: "vertex",
      available: true,
      hasGeminiKey,
      hasVertex: true,
      vertexProjectConfigured: true,
      vertexLocation: VERTEX_LOCATION,
      model: VERTEX_MODEL,
      fallbackMode: false,
      message: "Vertex AI مفعّل وجاهز",
    };
  }

  if (ACTIVE_PROVIDER === "vertex" && hasVertex && _fallbackMode) {
    return {
      provider: "mock",
      available: true,
      hasGeminiKey,
      hasVertex: true,
      vertexProjectConfigured: true,
      vertexLocation: VERTEX_LOCATION,
      model: VERTEX_MODEL,
      fallbackMode: true,
      message: "Vertex AI غير متاح — استخدام الوضع التجريبي",
    };
  }

  if (hasGeminiKey && !_fallbackMode) {
    return {
      provider: "gemini",
      available: true,
      hasGeminiKey: true,
      hasVertex,
      vertexProjectConfigured: !!VERTEX_PROJECT_ID,
      vertexLocation: VERTEX_LOCATION ?? null,
      model: MODEL_MAP["gemini_flash"],
      fallbackMode: false,
      message: "Gemini مفعّل وجاهز",
    };
  }

  if (hasGeminiKey && _fallbackMode) {
    return {
      provider: "mock",
      available: true,
      hasGeminiKey: true,
      hasVertex,
      vertexProjectConfigured: !!VERTEX_PROJECT_ID,
      vertexLocation: VERTEX_LOCATION ?? null,
      model: MODEL_MAP["gemini_flash"],
      fallbackMode: true,
      message: "Gemini غير متاح — استخدام الوضع التجريبي",
    };
  }

  return {
    provider: "mock",
    available: true,
    hasGeminiKey: false,
    hasVertex,
    vertexProjectConfigured: !!VERTEX_PROJECT_ID,
    vertexLocation: VERTEX_LOCATION ?? null,
    model: hasVertex ? VERTEX_MODEL : "mock",
    fallbackMode: false,
    message: "وضع تجريبي — لم يتم ربط Gemini بعد",
  };
}
