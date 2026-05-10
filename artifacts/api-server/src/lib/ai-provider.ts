import { logger } from "./logger";

// ─── Model Mapping (single source of truth) ───────────────────────────────────

const MODEL_MAP: Record<string, string> = {
  gemini_flash: "gemini-1.5-flash",
  gemini_flash_lite: "gemini-1.5-flash-8b",
  gemini_pro: "gemini-1.5-pro",
  mock: "mock",
};

const JSON_TASK_TYPES = new Set(["classify", "extract", "suggest_action"]);

// ─── Safety system prompt ─────────────────────────────────────────────────────

const SAFETY_SYSTEM_PROMPT = `
قواعد صارمة لا يمكن تجاوزها:
- لا ترسل أي رسالة تلقائياً بأي حال من الأحوال.
- لا تؤكد أي دفعة مالية ولا ترفضها.
- لا تغيّر أي دين أو رصيد مالي.
- لا تغيّر صلاحيات أي مستخدم.
- لا تحذف أي بيانات.
- لا تدّعي تنفيذ إجراء — أنت تقترح فقط.
- إن لم تعرف الإجابة، اقترح تصعيد الأمر لموظف بشري.
- اللهجة حسب تعليمات الوكيل المحدد.
`.trim();

// ─── Provider detection ───────────────────────────────────────────────────────

export const GEMINI_AVAILABLE = !!process.env.GEMINI_API_KEY;
export const ACTIVE_PROVIDER: "gemini" | "mock" = GEMINI_AVAILABLE ? "gemini" : "mock";

let _fallbackMode = false;

export function getDefaultModel(): string {
  return GEMINI_AVAILABLE ? "gemini_flash" : "mock";
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiRunInput {
  messages: AiMessage[];
  model: string;
  taskType: string;
  maxTokens?: number;
}

export interface AiRunOutput {
  provider: "gemini" | "mock";
  model: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  fallbackUsed?: boolean;
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

    const result = await model.generateContent({
      systemInstruction,
      contents: [{ role: "user", parts: [{ text: combined }] }],
    });

    const content = result.response.text();
    const usage = result.response.usageMetadata;
    const promptTokens = usage?.promptTokenCount ?? Math.ceil(combined.length / 4);
    const completionTokens = usage?.candidatesTokenCount ?? Math.ceil(content.length / 4);

    if (JSON_TASK_TYPES.has(input.taskType)) {
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
    logger.error({ err }, "Gemini API error — تعذر الاتصال بـ Gemini، تم استخدام الوضع التجريبي");
    _fallbackMode = true;
    return { ...(await runMock(input)), fallbackUsed: true };
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runAI(input: AiRunInput): Promise<AiRunOutput> {
  if (ACTIVE_PROVIDER === "gemini" || input.model.startsWith("gemini")) {
    return runGemini(input);
  }
  return runMock(input);
}

// ─── Provider status ──────────────────────────────────────────────────────────

export function getProviderStatus(): {
  provider: "gemini" | "mock";
  available: boolean;
  hasGeminiKey: boolean;
  fallbackMode: boolean;
  message: string;
} {
  const hasGeminiKey = GEMINI_AVAILABLE;

  if (hasGeminiKey && !_fallbackMode) {
    return {
      provider: "gemini",
      available: true,
      hasGeminiKey: true,
      fallbackMode: false,
      message: "Gemini مفعّل وجاهز",
    };
  }

  if (hasGeminiKey && _fallbackMode) {
    return {
      provider: "mock",
      available: true,
      hasGeminiKey: true,
      fallbackMode: true,
      message: "Gemini غير متاح — استخدام الوضع التجريبي",
    };
  }

  return {
    provider: "mock",
    available: true,
    hasGeminiKey: false,
    fallbackMode: false,
    message: "وضع تجريبي — لم يتم ربط Gemini بعد",
  };
}
