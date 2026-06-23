// ─── Model Router (مصدر الحقيقة الوحيد لتوجيه الموديلات) ───────────────────────
// قرار المالك (20 يونيو 2026): لكل مهمة موديل ومستوى. هذا الملف يحدّد الموديل المناسب
// لكل (مهمة × مستوى). الأسماء قابلة للتبديل عبر env دون لمس الكود.
// المرحلة 1 تغطّي النص والرؤية؛ فهم الصوت الوارد أُضيف (voice). الـOCR/المكالمات لاحقاً.

export type ModelTask = "text.reply" | "vision" | "voice";
export type ModelTier = "normal" | "hard";

// البديل الآمن: الموديل العامل حالياً على Vertex. لو تعذّر الموديل المطلوب (مثلاً preview
// غير متاح بعد على المشروع)، يسقط مزوّد Vertex إلى هذا تلقائياً بدل كسر الإنتاج.
const SAFE_FALLBACK_MODEL = process.env.VERTEX_MODEL ?? "gemini-2.5-flash";

// الخريطة: (مهمة.مستوى) → معرّف الموديل. الافتراضات = قرار المالك، وكلٌّ قابل للتجاوز بـenv.
const ROUTES: Record<string, string> = {
  "text.reply.normal": process.env.MODEL_TEXT_NORMAL ?? "gemini-3-flash-preview",
  "text.reply.hard": process.env.MODEL_TEXT_HARD ?? "gemini-3.1-pro-preview",
  "vision.normal": process.env.MODEL_VISION_NORMAL ?? "gemini-3-flash-preview",
  "vision.hard": process.env.MODEL_VISION_HARD ?? "gemini-3.1-pro-preview",
  // فهم الملاحظات الصوتية الواردة سمعياً (قرار المالك: flash للعادي، pro للصعب).
  "voice.normal": process.env.MODEL_VOICE_NORMAL ?? "gemini-3-flash-preview",
  "voice.hard": process.env.MODEL_VOICE_HARD ?? "gemini-3.1-pro-preview",
};

export interface ModelRoute {
  /** الموديل المطلوب لهذه المهمة/المستوى. */
  modelId: string;
  /** البديل الآمن لو تعذّر الموديل المطلوب. */
  fallbackId: string;
  tier: ModelTier;
  task: ModelTask;
}

export function resolveModel(task: ModelTask, tier: ModelTier): ModelRoute {
  const modelId = ROUTES[`${task}.${tier}`] ?? SAFE_FALLBACK_MODEL;
  return { modelId, fallbackId: SAFE_FALLBACK_MODEL, tier, task };
}

// ─── وزن النقاط (فوترة الاستهلاك) ──────────────────────────────────────────────
// قرار المالك: ردّ نصّي عادي (flash) = نقطة واحدة؛ صعب (pro) أو رؤية أو صوت = 3 نقاط.
// مصدر الحقيقة الوحيد للوزن — يُستهلك في حلقة الوكيل عبر recordPoints.
export const POINTS_PER_NORMAL = 1;
export const POINTS_PER_HARD = 3;

export function pointsForRoute(route: Pick<ModelRoute, "task" | "tier">): number {
  if (route.task === "vision" || route.task === "voice") return POINTS_PER_HARD;
  return route.tier === "hard" ? POINTS_PER_HARD : POINTS_PER_NORMAL;
}

// ─── مصنّف الصعوبة (heuristic شفّاف، بلا استدعاء AI إضافي) ──────────────────────
// "صعب" → يُرقّى إلى موديل pro: حالات التصعيد والتعارض والقرارات الدقيقة.

const HARD_SIGNALS = [
  "شكوى", "مشكلة", "خطأ", "غلط", "تعارض", "اعتراض", "مدير", "مسؤول",
  "إلغاء", "الغاء", "استرجاع", "إرجاع", "ارجاع", "خصم", "تعويض",
  "محامي", "قانون", "مرفوض", "متضرر", "متأخر", "وعدتوني", "وعدتني",
  "كذب", "نصب", "احتيال", "أبلغ", "شكوه",
];

export function classifyComplexity(input: {
  inboundText: string;
  knowledgeMatchCount: number;
  turnCount: number;
  imageCount?: number;
}): ModelTier {
  const text = (input.inboundText ?? "").trim();

  // إشارة تصعيد/تعارض صريحة → صعب
  if (HARD_SIGNALS.some((kw) => text.includes(kw))) return "hard";

  // أكثر من صورة في الرد الواحد → تحليل بصري أعقد → صعب
  if ((input.imageCount ?? 0) >= 2) return "hard";

  // تعدّد نوايا/أسئلة كثيرة في رسالة واحدة → صعب
  const questionMarks = (text.match(/[؟?]/g) ?? []).length;
  if (questionMarks >= 3) return "hard";

  // رسالة طويلة جداً تحتاج استدلالاً أعمق → صعب
  if (text.length > 600) return "hard";

  // محادثة طويلة متشعّبة → صعب
  if (input.turnCount >= 10) return "hard";

  // سؤال حقيقي بلا أي تطابق في المعرفة → احذر وارفعه إلى pro
  if (input.knowledgeMatchCount === 0 && questionMarks >= 1 && text.length > 40) return "hard";

  return "normal";
}
