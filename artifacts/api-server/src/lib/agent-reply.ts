import { db } from "@workspace/db";
import {
  aiAgentInstructionsTable,
  aiAgentsTable,
  workspacesTable,
  aiMessagesTable,
  aiRunsTable,
  aiUsageTable,
  messagesTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { searchKnowledgeForAi } from "../services/knowledge-retrieval";
import { loadMediaContext } from "../services/agent-media";
import { ACTIVE_PROVIDER, getDefaultModel, runAI } from "./ai-provider";
import { classifyComplexity, resolveModel } from "./model-router";
import { logger } from "./logger";
import {
  buildAgentToolDeclarations,
  executeAgentToolCalls,
  hasCriticalAgentToolFailure,
  loadExecutableAgentTools,
  loadMetaStoreContext,
  loadOrderStatusContext,
  loadProductCatalogContext,
  type AgentToolResult,
} from "./agent-tools";
import {
  findUnauthorizedLink,
  findUngroundedWorkHours,
  findUngroundedPrice,
  findUnbackedActionClaim,
  includesEscalationKeyword,
  replyConfirmsPayment,
  replyPromisesMoneyToCustomer,
  replyPromisesHandoff,
  replyPromisesVerification,
  replyPromisesTeamAction,
  replyPromisesEscalationReview,
  detectsRefundDemand,
  detectsSeriousDispute,
} from "./agent-escalation";
import { loadSectorAgentContext } from "./agent-sector";
import { loadLearnedContext } from "../services/agent-learning";

// تأريض صارم (3 يوليو 2026): حادثة «299 ريال» — النموذج اخترع سعراً رغم قاعدة المنع في
// SAFETY_SYSTEM_PROMPT، ثم ادّعى «قمت بتحويل طلبك» تهرّباً. هاتان القاعدتان تربطان
// السلوك بسياق قابل للتحقق (الكتالوج المحقون) وبعواقب حقيقية (الادّعاء = تنفيذ).
const GROUNDING_RULES = [
  "قاعدة التأريض الصارمة (الأهم فوق كل شيء): كل معلومة تذكرها للعميل — سعر، رقم، مواصفة، ميزة، توفّر، مدّة، مقاس، خامة، سياسة، خدمة، أو أي حقيقة عن النشاط أو منتجاته — يجب أن تكون موجودة حرفياً في «كتالوج المنتجات» أو «معرفة قاعدة البيانات» أو «حالة طلبات هذا العميل» المرفقة. ممنوع منعاً باتاً أن تخترع أو تخمّن أو «تقرّب» أو تفترض أي معلومة غير موجودة فيها. إن لم تجد الإجابة في المرفقات: قل بصدق وبأسلوب ودّي إنها غير متوفّرة لديك الآن وستتأكّد من الفريق — لا ترتجل رقماً ولا وصفاً ولا مثالاً.",
  "قاعدة منع الوعود الكاذبة: لا تَعِد العميل بأي شيء لا تضمنه — لا توصيل، ولا موعد، ولا خصم، ولا توفّر، ولا متابعة، ولا أن أحداً «سيتواصل معك» أو أن أمراً «سيتم» — إلا إذا كان مذكوراً صراحةً في المعرفة المرفقة، أو نفّذته فعلاً باستدعاء أداة. الوعد بما لا تملك تأكيده كذبٌ على العميل وخطأ جسيم يفقده الثقة تماماً.",
  "قاعدة التحويل الصادق: لا تكتب أنك حوّلت أو ستحوّل المحادثة لموظف إلا إذا استدعيت أداة handoff_to_human فعلاً — كتابة عبارة التحويل بلا استدعاء الأداة وعدٌ كاذب.",
  // أضيفت بعد جولة «المستخدم الحي» 11 يوليو: النموذج قلب ساعات الدوام (10ص-8م → 8ص-10م) واخترع
  // دواماً بعد حذف الوثيقة رغم قاعدة التأريض العامة — فئة «حقائق النشاط الثابتة» تحتاج تسمية صريحة.
  "قاعدة النقل الحرفي: الأرقام والأوقات والمدد تُنقل من المرفقات كما هي حرفياً وبترتيبها — ممنوع قلب البداية والنهاية (إن قالت المعرفة «من 10 صباحاً حتى 8 مساءً» فلا تقل أبداً «من 8 صباحاً حتى 10 مساءً»). وأوقات الدوام والعناوين وأرقام التواصل ومدد ورسوم التوصيل تحديداً: إن لم تكن مكتوبة في المرفقات فلا تذكر لها أي قيمة إطلاقاً مهما بدت بديهية — قل بصدق إنك ستتأكّد من الفريق.",
  // أضيفت مع حارس الأسعار البنيوي (13 يوليو): سدّ حلقة التسميم الذاتي عند مصدرها النصّي — الوكيل
  // كان يعامل سعراً اخترعه في ردّ سابق (يظهر في سجل المحادثة) كأنه حقيقة فيكرّره ويحوّره.
  "قاعدة عدم الاستناد لكلامك السابق: ردودك أنت السابقة في هذه المحادثة ليست مصدراً للحقائق — أي سعر أو رقم لا تجده الآن في «كتالوج المنتجات» أو «معرفة قاعدة البيانات» أو «حالة طلبات العميل» المرفقة لا تذكره ولا تكرّره حتى لو كنت قد قلته في ردّ سابق. سعر منتج غير موجود في الكتالوج = قل بصدق إنك ستتأكّد من الفريق، ولا تخترع له رقماً ولا تعيد رقماً سبق أن ذكرته بلا مصدر.",
].join("\n");

// قواعد استخدام الأدوات (استدعاء أصلي): تُحقن عند تفعيل أي أداة. البنية تأتي من function calling
// لا من نص JSON — فلا نطلب صيغة بل سلوكاً. الأهم: التحويل للبشر = استدعاء handoff_to_human فعلياً،
// لا مجرّد جملة نصّية (يقتل عطل «يعد بالتحويل ولا يحوّل» — جلسة 17).
const TOOL_USE_RULES = [
  "استخدم الأدوات فقط عندما يطلب العميل الإجراء بوضوح وتتوفّر الحقائق اللازمة.",
  "لا تدّعِ أبداً أنك نفّذت إجراءً (طلب، تحويل، متابعة، دفع) إلا إذا استدعيت الأداة المطابقة فعلاً.",
  "للمدفوعات: سجّل ادّعاء دفع معلّقاً فقط (log_payment_claim) — لا تؤكّد ولا ترفض أي دفعة.",
  "للتحويل لموظف بشري: استدعِ أداة handoff_to_human فعلياً — لا تكتفِ بقول إنك ستحوّل. إن لم تستدعِ الأداة فلن يحدث تحويل.",
  "عند التحويل لموظف بشري، لا تذكر أي رقم هاتف أو وسيلة تواصل بديلة من عندك أبداً — التحويل عبر الأداة وحده يكفي، والموظف يكمل المحادثة من هنا نفسها.",
  "إن عرضتَ التحويل على العميل كسؤال («تحب أحوّلك لموظف؟») فلا تستدعِ handoff_to_human في نفس الرسالة أبداً — انتظر موافقته الصريحة في رسالته التالية ثم استدعِ الأداة.",
  "صور المنتجات: عندما يسأل العميل عن منتج معيّن معلَّم في الكتالوج بـ«صورة متوفرة»، أرسل صورته عبر send_product_media مع ردّك (باسم المنتج الحرفي من الكتالوج). منتج بلا هذه العلامة لا صورة له — لا تستدعِ الأداة له ولا تَعِد بصورة، اكتفِ بالوصف النصي.",
  "الطلب أولاً، لا تهرّب: عندما يريد العميل الشراء أو الطلب، أمامك خياران فقط — إن عرفتَ المنتج والكمية فاستدعِ create_order فعلياً، وإن نقصك شيء فاسأل العميل عنه مباشرةً. ممنوع منعاً باتاً أن تقول «صعّدت طلبك» أو «سجّلت طلبك» أو ما يشبهها كبديل عن إنشاء الطلب — التصعيد ليس طريقةً لإنهاء عملية بيع، وهو آخر حل لا أوله.",
].join("\n");

// حرارة ردّ المحادثة: دافئة (0.6) لتكون بشرية ومرنة ومتنوّعة، لا 0.1 الباردة المتكرّرة. قابلة للضبط
// عبر env دون نشر. مع استدعاء الأدوات الأصلي البنية مضمونة من الـAPI، فالحرارة الدافئة لا تُضعف
// موثوقية الأدوات إطلاقاً. الأسلوب حسب القطاع يأتي من rolePrompt/tone/dialect التي يضبطها التاجر.
const AGENT_REPLY_TEMPERATURE = Number(process.env.AGENT_REPLY_TEMPERATURE ?? "0.6");

// أسلوب بشري (مضاد للبرود): كثرة القواعد الدفاعية (SAFETY + GROUNDING) تجعل النموذج يتقوقع في
// عبارات جاهزة جافة. هذه القاعدة توازنها بأسلوب إنساني طبيعي، تقوده نبرة/لهجة الوكيل التي يضبطها
// التاجر حسب قطاعه — فالشخصية تظهر بدل نبرة آلية موحّدة.
const HUMAN_STYLE = "أسلوبك إنساني ودافئ وطبيعي — تتكلّم كموظف حقيقي متفهّم لا كروبوت. تجنّب العبارات الجاهزة الجافة والمتكرّرة (مثل «كيف يمكنني مساعدتك اليوم؟»)، ونوّع صياغتك وتفاعل مع محتوى رسالة العميل تحديداً. اجعل طول الردّ مناسباً للسياق لا مقتضباً جافاً، والتزم نبرة الوكيل ولهجته المحدّدتين. لكن دفؤك في طريقة الكلام فقط لا في اختراع المحتوى: لا تُضِف حقيقةً أو تفصيلاً أو وعداً من عندك لتبدو أكثر فائدة — الدفء في النبرة، والصدق التام في المعلومة. أن تقول «سأتأكّد من الفريق» بلطف خيرٌ من أن تخترع إجابة.";

// حدّ حقن المعرفة في البرومبت. كان 800 حرفاً بينما المقطع 2000 — فكان يُقتطع جزء الإجابة الفعلي
// من مقطع مسترجَع صحيح («وجدها لكن ما قرأها»). رُفع ليرى النموذج المقطع كاملاً. قابل للضبط عبر env.
const KNOWLEDGE_INJECT_CHARS = Number(process.env.KNOWLEDGE_INJECT_CHARS ?? "2000");

// انضباط المحادثة (11 يوليو 2026) — مستخلص حرفياً من شهادات 5 عملاء رفضوا الاشتراك:
// «يكثر أسئلة» · «يطلب صوراً من كل العملاء» (حوّل تعليمة شرطية في المعرفة لسلوك افتراضي) ·
// «يكرر مواضيع قديمة» · «يرد على كل رسالة برد طويل موازٍ». كل بند هنا يقابل شكوى بعينها.
// الدور الافتراضي حين لا يكتب التاجر دوراً مخصصاً — يُثرى باسم المتجر تلقائياً (جذر شكوى «الوكيل
// عام لبعض المتاجر» 11 يوليو): المتاجر التي كتب أصحابها rolePrompt باسمها كانت مخصّصة، والبقية
// (الأغلبية) تحصل على موظف مجهول الهوية. الاسم يُعيد الانتماء بلا أي كتابة من التاجر.
function defaultRolePrompt(workspaceName: string): string {
  const at = workspaceName ? ` في «${workspaceName}»` : "";
  return `أنت موظف مبيعات وخدمة عملاء حقيقي${at}، ودود ومحترف، تردّ على عملاء النشاط التجاري بأسلوب إنساني طبيعي. تفاعل مع آخر رسالة من العميل مباشرةً.`;
}

const CONVERSATION_DISCIPLINE = [
  "سؤال واحد كحد أقصى في الردّ الواحد — ولا تسأل إلا إذا كان الجواب ضرورياً فعلاً للخطوة التالية. إن كان بوسعك التقدّم بلا سؤال فتقدّم.",
  "التعليمات الشرطية في معرفة التاجر («إذا احتاج…»، «في حال…»، «لو طلب…») تُطبَّق فقط عند تحقق شرطها في محادثتك الحالية فعلاً — لا تحوّلها أبداً لسلوك افتراضي مع كل عميل (مثال: «اطلب صورة إذا لزم» لا تعني أن تطلب صورة من كل عميل).",
  "أجب على آخر رسائل العميل فقط. موضوع أُجيب وانتهى لا يُعاد فتحه ولا يُلخَّص مجدداً — إلا إذا أعاد العميل نفسه فتحه.",
  "إن وصلت من العميل عدة رسائل متتابعة، فردّ برد واحد جامع يغطيها كلها بترتيبها — لا ردّ منفصل لكل رسالة.",
].join("\n");

// حدود الدور (11 يوليو — شكوى «الوكيل عام»): بلا هذه الكتلة كان وكيل المكتبة يجيب عن عواصم الدول
// ويكتب القصائد ويترجم وينصح دوائياً — يتحوّل لمساعد ذكاء عام ويفقد هوية المتجر. الحصر صريح:
// لا يجيب السؤالَ الخارجي نفسه ولو جزئياً، اعتذارٌ بجملة ثم إعادة توجيه لنشاط المتجر.
const SCOPE_DISCIPLINE = [
  "حدود دورك (التزام صارم): أنت موظف هذا النشاط التجاري حصراً — لست مساعداً عاماً ولا موسوعة ولا مترجماً.",
  "أي طلب خارج نشاط المتجر ومنتجاته وخدماته وطلبات عملائه — معلومات عامة (عواصم، تواريخ، حسابات)، قصائد وإنشاء، ترجمة، واجبات ودروس، برمجة، نصائح طبية أو دوائية أو قانونية، آراء في السياسة أو الدين أو الأخبار، مقارنات أو آراء في منافسين أو في منتجات لا يبيعها المتجر — اعتذر عنه بجملة واحدة لطيفة دون أن تجيب عن السؤال نفسه ولو جزئياً، ثم وجّه الحديث فوراً لما تقدر تخدم العميل فيه من نشاط المتجر.",
  "إن سألك العميل عن هويتك أو طبيعتك: قدّم نفسك بدورك فقط — موظف خدمة عملاء هذا النشاط — بلا خوض في أي تفاصيل تقنية عن طبيعتك، وبلا نقاش حولها؛ ثم انتقل لخدمته.",
].join("\n");

// طول الردود كخيار منتج لا كتابة برومبت (11 يوليو): تاجر وصال ون لا يُتقن كتابة التعليمات —
// «النبرة» في إعداد الوكيل تقبل قيماً حرة، وهذه القوالب الثلاثة تحوّل اختياراً بسيطاً (من قائمة
// في الواجهة) إلى تعليمات دقيقة. قيمة نبرة خارج القوالب تمرّ كما هي (المرونة محفوظة للمتقدمين).
const REPLY_LENGTH_PRESETS: Record<string, string> = {
  "مختصر": "طول الردود: قصير جداً — سطر إلى ثلاثة أسطر كحد أقصى، جملة مفيدة واحدة لكل فكرة، بلا مقدمات ولا خواتيم مطوّلة.",
  "متوازن": "طول الردود: متوسط — من سطرين إلى خمسة أسطر، مباشرة للمطلوب مع لمسة ودّية موجزة.",
  "مفصل": "طول الردود: تفصيلي عند الحاجة — اشرح بوضوح مع تقسيم النقاط، لكن بلا حشو ولا تكرار.",
};

// الردّ الآمن الموحّد عند فشل أداة أو ادّعاء تنفيذ غير مسنود — يَعِد بالمراجعة فقط (وعدٌ يصدُق
// لأن المحادثة تُصعَّد فعلاً معه دائماً)، ولا يكشف أي تفصيل تقني (محمية #10).
const SAFE_REVIEW_REPLY = "أحتاج أن أحوّل طلبك للفريق لمراجعته والتأكد من تنفيذه بشكل صحيح.";

// التأكيد الحتمي عند نجاح أداة handoff_to_human بلا نصّ مصاحب (مُستخرَج ثابتاً ليُقارَن به في
// ensureHandoffCommunicated — صياغته «بحوّلك» لا تطابق أنماط وعد التحويل فتحتاج مقارنة صريحة).
const HANDOFF_TOOL_CONFIRMATION = "لحظة من فضلك، بحوّلك لأحد أعضاء الفريق ليكمل معك.";

// إشعار التحويل الصريح للعميل — يُرسَل أو يُلحَق عند كل تصعيد (قرار مالك 9 يوليو 2026).
export const HANDOFF_NOTICE = "لحظة من فضلك، حوّلت المحادثة لأحد أعضاء الفريق ليكمل معك من هنا.";

// شكوى إنتاج (9 يوليو 2026): «الوكيل عند التحويل البشري لا يخبر العميل — ينقطع فجأة».
// السبب: أغلب التصعيدات تأتي من الشبكات الخادمية (طلب العميل بكلمة مفتاحية، وعد التأكد من
// الفريق، بوابة الادّعاء) حيث نصّ النموذج لا يذكر التحويل إطلاقاً — فيتبدّل agent_status بصمت
// ويظنّ العميل أن المتجر تجاهله. القاعدة: أي ردّ يخرج مع تصعيدٍ يجب أن يُعلم العميل بالتحويل؛
// إن لم يذكره النص نُلحق إشعاراً حتمياً صادقاً (التحويل حدث فعلاً: agent_status=human + إشعار
// التاجر) — ولا نُلحقه إن كان النص يعد به أصلاً (لا تكرار). دالة نقية قابلة للاختبار المباشر.
export function ensureHandoffCommunicated(reply: string, escalated: boolean): { reply: string; noticeAppended: boolean } {
  const trimmed = reply.trim();
  if (!escalated || !trimmed) return { reply: trimmed, noticeAppended: false };
  const alreadyCommunicated =
    replyPromisesHandoff(trimmed) ||
    trimmed === HANDOFF_TOOL_CONFIRMATION ||
    trimmed.includes(HANDOFF_NOTICE);
  if (alreadyCommunicated) return { reply: trimmed, noticeAppended: false };
  return { reply: `${trimmed}\n\n${HANDOFF_NOTICE}`, noticeAppended: true };
}

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

// محمية #10: آخر دفاع — لو تسرّب JSON خام {"reply":...} (فشل تحليل ردّ النموذج، فئة PD-8)،
// استخرج النص فقط فلا يصل ردّ خام للعميل أو التاجر أبداً. النص العادي يمرّ كما هو.
// يتعامل مع JSON المقطوع (بلا اقتباس/قوس ختامي): لو تعذّر استخراج أي نص يُرجِع "" ليُصعَّد بدل التسريب.
function sanitizeReply(text: string): string {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") && /"reply"\s*:/.test(trimmed))) return trimmed;

  // 1) قيمة reply مكتملة باقتباس ختامي. 2) مقطوعة حتى نهاية النص.
  const body = (trimmed.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    ?? trimmed.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)$/))?.[1];
  if (body !== undefined) {
    let decoded: string;
    try {
      decoded = (JSON.parse(`"${body.replace(/\\+$/, "")}"`) as string).trim();
    } catch {
      decoded = body
        .replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r")
        .replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\\+$/, "").trim();
    }
    if (decoded) return decoded;
  }
  // تعذّر استخراج أي نص صالح — لا تُسرّب JSON خاماً؛ أرجِع فارغاً ليُصعَّد للبشر.
  return "";
}

// حارس تسريب استدعاءات الأدوات النصّية (11 يوليو 2026 — حادثة «مكبر السيارن»): عميل حقيقي
// استلم على واتساب كتلة {"tool_calls": [...]} خاماً ملحقةً بردٍّ طبيعي — النموذج «كتب» نيّة
// إرسال صورة المنتج نصّاً بدل إصدارها functionCall أصلياً (يحدث خاصةً مع الرسائل الصوتية).
// sanitizeReply أعلاه يمسك حالة «الردّ كله JSON» فقط ولا يرى كتلةً ملحقة بنصٍّ سليم.
// المعالجة من شقّين: (1) اقتصاص الكتلة من النص فلا يصل العميل أي كود إطلاقاً، (2) إنقاذ النيّة —
// تُحوَّل الاستدعاءات المستخرجة لنفس مسار executeAgentToolCalls الآمن (تحقّق zod لكل أداة هناك)،
// فيستلم العميل الصورة الموعودة فعلاً بدل وعدٍ مكسور. فشل التحليل = اقتصاص بلا إنقاذ (الأولوية
// المطلقة ألّا يتسرّب كود، حتى لو ضاعت الأداة).
type SalvagedToolCall = { name: string; arguments: Record<string, unknown> };

// ماسح أقواس واعٍ بالنصوص: يجد نهاية كائن JSON يبدأ عند start (يتجاوز الأقواس داخل السلاسل والهروب).
function findJsonObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { if (inString) escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseSalvagedCalls(blob: string): SalvagedToolCall[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(blob);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;

  // صيغة OpenAI-النصّية قد تحمل arguments ككائن مباشر أو كسلسلة JSON — نقبل الاثنين.
  const normalizeArgs = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value === "string") {
      try {
        const inner = JSON.parse(value);
        if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner as Record<string, unknown>;
      } catch { /* سلسلة غير صالحة — تُهمل */ }
    }
    return {};
  };

  const fromEntry = (entry: unknown): SalvagedToolCall | null => {
    if (!entry || typeof entry !== "object") return null;
    const item = entry as Record<string, unknown>;
    const fn = (item.function && typeof item.function === "object" ? item.function : item) as Record<string, unknown>;
    if (typeof fn.name !== "string" || !fn.name.trim()) return null;
    return { name: fn.name.trim(), arguments: normalizeArgs(fn.arguments) };
  };

  if (Array.isArray(obj.tool_calls)) {
    return obj.tool_calls.map(fromEntry).filter((call): call is SalvagedToolCall => call !== null);
  }
  const single = fromEntry(obj.function_call ?? obj);
  return single ? [single] : [];
}

export function extractTextualToolCalls(text: string): { cleanText: string; calls: SalvagedToolCall[] } {
  let working = text;
  const calls: SalvagedToolCall[] = [];
  // علامات كتلة استدعاء نصّية؛ حلقة محدودة تحسّباً لأكثر من كتلة في نفس الردّ.
  const markerPattern = /"tool_calls"|"function_call"|\{\s*"name"\s*:\s*"[\w.-]+"\s*,\s*"arguments"/;
  for (let round = 0; round < 3; round += 1) {
    const marker = working.match(markerPattern);
    if (marker?.index === undefined) break;
    // ارجع من العلامة لأقرب '{' يفتح الكائن الحاوي.
    const openIndex = working.lastIndexOf("{", marker.index);
    if (openIndex === -1) break;
    const endIndex = findJsonObjectEnd(working, openIndex);
    if (endIndex === -1) {
      // كتلة مقطوعة (بلا إغلاق) — اقتصّ من بدايتها لنهاية النص: لا يصل العميل كود ولو مبتوراً.
      working = working.slice(0, openIndex);
      break;
    }
    calls.push(...parseSalvagedCalls(working.slice(openIndex, endIndex + 1)));
    working = `${working.slice(0, openIndex)}${working.slice(endIndex + 1)}`;
  }
  return { cleanText: working.replace(/\n{3,}/g, "\n\n").trim(), calls };
}

// استدعاء الأدوات الأصلي قد يعيد استدعاء أداة بلا نصّ مصاحب. لتفادي ردّ فارغ، نولّد تأكيداً
// حتمياً موجزاً حسب نتيجة الأداة الناجحة — بلا استدعاء ذكاء ثانٍ (أوفر للرصيد وأأمن من الهلوسة).
function confirmationFromToolResults(results: AgentToolResult[]): string {
  const succeeded = (tool: string) => results.some((r) => r.tool === tool && r.status === "success");
  if (succeeded("handoff_to_human")) return HANDOFF_TOOL_CONFIRMATION;
  if (succeeded("create_order")) return "تمام، سجّلت طلبك ✅ وبنراجع التفاصيل ونؤكّدها لك قريباً.";
  if (succeeded("schedule_followup")) return "تمام، سجّلت الموعد وبنتابع معك في وقته.";
  if (succeeded("log_payment_claim")) return "شكراً، سجّلت بيانات الدفع وبيتأكّد منها الفريق ونرجع لك.";
  if (succeeded("send_product_media")) return "تفضّل، هذا هو المنتج الذي طلبته 👆 حابب أساعدك بشيء آخر؟";
  return "";
}

// مطابقات التصعيد انتقلت إلى ./agent-escalation (وحدة نقية قابلة للاختبار).

function isPlaceholderContent(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]");
}

function inboundSearchQuery(message: typeof messagesTable.$inferSelect | undefined): string {
  if (!message) return "";
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  for (const raw of attachments) {
    if (!raw || typeof raw !== "object") continue;
    const attachment = raw as { type?: string; caption?: string | null };
    if (typeof attachment.caption === "string" && attachment.caption.trim() && !isPlaceholderContent(attachment.caption)) {
      return attachment.caption.trim();
    }
    if (attachment.type === "image") return "صورة من العميل";
    if (attachment.type === "audio" || attachment.type === "voice") return "رسالة صوتية من العميل";
    if (attachment.type === "video") return "فيديو من العميل";
    if (attachment.type === "document") return "مستند من العميل";
  }
  const content = message.content?.trim() ?? "";
  if (isPlaceholderContent(content)) {
    if (content.includes("صورة")) return "صورة من العميل";
    if (content.includes("صوت")) return "رسالة صوتية من العميل";
    if (content.includes("فيديو")) return "فيديو من العميل";
    if (content.includes("مستند")) return "مستند من العميل";
  }
  return content;
}

function hasInboundMedia(message: typeof messagesTable.$inferSelect | undefined): boolean {
  if (!message) return false;
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  return attachments.some((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const type = (raw as { type?: string }).type;
    return ["image", "audio", "voice", "document", "video"].includes(String(type ?? ""));
  });
}

export async function runAgentReply(params: {
  workspaceId: string;
  conversationId: string;
  agentId: string;
  systemUserId: string;
}): Promise<{ reply: string; shouldEscalate: boolean; needsAttention?: boolean; runId: string; toolResults: AgentToolResult[] }> {
  const [agent] = await db
    .select()
    .from(aiAgentsTable)
    .where(and(eq(aiAgentsTable.id, params.agentId), eq(aiAgentsTable.workspaceId, params.workspaceId)))
    .limit(1);
  if (!agent) throw new Error("AI_AGENT_NOT_FOUND");
  // اسم المتجر للدور الافتراضي — جلب خفيف بالمفتاح الأساسي (انظر defaultRolePrompt).
  const [workspaceRow] = await db
    .select({ name: workspacesTable.name })
    .from(workspacesTable)
    .where(eq(workspacesTable.id, params.workspaceId))
    .limit(1);
  const workspaceName = workspaceRow?.name?.trim() ?? "";

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
  // لا تردّ على رسالة واردة فارغة (مسافات فقط) وبلا وسائط — تمنع ردوداً مكرّرة بلا داعٍ (سبام).
  if (lastInbound && !(lastInbound.content ?? "").trim() && !hasInboundMedia(lastInbound)) {
    return { reply: "", shouldEscalate: false, runId: "", toolResults: [] };
  }
  const primaryQuery = inboundSearchQuery(lastInbound) || lastInbound?.content || messages[messages.length - 1]?.content || "";
  // Launch fix (2 Jul): short follow-ups ("وكم سعره؟") carry no searchable keywords on
  // their own, so retrieval used to come back empty and the agent answered blind.
  // For short queries only, enrich with the previous customer turns — longer queries
  // stay untouched so tsv AND-matching keeps its precision.
  const priorInboundContext = messages
    .filter((message) => message.direction === "inbound")
    .slice(-3, -1)
    .map((message) => (message.content ?? "").trim())
    .filter((text) => text && !isPlaceholderContent(text))
    .join("\n");
  const searchQuery = primaryQuery.trim().length >= 15
    ? primaryQuery
    : [primaryQuery, priorInboundContext].filter(Boolean).join("\n").slice(0, 600);
  // تدقيق 10 يوليو: واجهة الوكيل تَعِد أن «قاعدة المعرفة المختارة هي مصدر إجابات هذا الوكيل»،
  // لكن الاختيار لم يكن يُمرَّر إطلاقاً — كل وكيل كان يقرأ كل معرفة المساحة. الآن: اختيار صريح
  // يُحترَم (عزل معرفي بين وكلاء نفس المتجر)؛ لا اختيار = كل المساحة كما قبل (يوسّع لا يضيّق).
  const agentKnowledgeBaseIds = Array.isArray(agent.knowledgeBaseIds)
    ? (agent.knowledgeBaseIds as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const knowledgeSources = await searchKnowledgeForAi({
    workspaceId: params.workspaceId,
    query: searchQuery,
    knowledgeBaseIds: agentKnowledgeBaseIds,
  });
  const mediaContext = await loadMediaContext(messages);
  // get_order_status (الدفعة 3): احقن حالة طلبات العميل في السياق ليردّ الوكيل على «وين طلبي؟» بدقّة (بنية أحادية التمرير).
  // حماية: فشل جلب الطلبات يجب ألّا يكسر الردّ كلّه — تدهور رشيق إلى سياق فارغ.
  let orderStatusContext = "";
  try {
    orderStatusContext = await loadOrderStatusContext(params.workspaceId, params.conversationId);
  } catch (err) {
    logger.warn({ err, conversationId: params.conversationId }, "loadOrderStatusContext failed — continuing without order context");
  }
  // تأريض الأسعار: كتالوج المخزون الحقيقي يُحقن كقائمة حصرية — فشله لا يكسر الردّ.
  let productCatalogContext = "";
  try {
    productCatalogContext = await loadProductCatalogContext(params.workspaceId);
  } catch (err) {
    logger.warn({ err, workspaceId: params.workspaceId }, "loadProductCatalogContext failed — continuing without catalog context");
  }
  // سياق ميتا الحي (الطور 2 — 11 يوليو 2026): منشورات/إعلانات ميتا كانت حبيسة مسار الاقتراح
  // اليدوي المعطَّل (draft-reply) فقط — هذا المسار الحيّ لم يكن يراها إطلاقاً. نفس أسلوب
  // التسامح مع الفشل المطبَّق أعلاه: فشل جلب منشورات ميتا لا يجوز أن يكسر الردّ للعميل.
  let metaStoreContext = "";
  try {
    metaStoreContext = (await loadMetaStoreContext(params.workspaceId)).context;
  } catch (err) {
    logger.warn({ err, workspaceId: params.workspaceId }, "loadMetaStoreContext failed — continuing without meta store context");
  }
  // الأجوبة المتعلَّمة (الطور 3 — 11 يوليو 2026): منجم agent-learning يستخرجها من المحادثات
  // الناجحة منذ أسابيع، لكنها كانت حبيسة مسار الاقتراح اليدوي المعطَّل هي الأخرى — المسار الحيّ
  // لم يرها قط. تُحقن فقط الأجوبة المعتمدة (status='active'؛ الحسّاسة تبقى pending_review خلف
  // بوابة مراجعة التاجر داخل loadLearnedContext نفسها). فشلها لا يكسر الردّ.
  let learnedContext = "";
  try {
    learnedContext = (await loadLearnedContext(params.workspaceId, lastInbound?.content ?? "")).context;
  } catch (err) {
    logger.warn({ err, workspaceId: params.workspaceId }, "loadLearnedContext failed — continuing without learned context");
  }
  // هوية القطاع (7 يوليو): sector_profiles مبذورة والوكيل يحمل sectorKey منذ البداية، لكن
  // المسار الحي كان يتجاهلهما (كانت حبيسة مسار الاقتراح اليدوي). حواجز القطاع («لا تقدم
  // تشخيصاً طبياً»، «لا تخترع خصومات») تُقوّي التأريض لا تبدّله. فشله لا يكسر الردّ.
  let sectorContext = "";
  try {
    sectorContext = await loadSectorAgentContext(params.workspaceId, agent);
  } catch (err) {
    logger.warn({ err, workspaceId: params.workspaceId }, "loadSectorAgentContext failed — continuing without sector context");
  }
  const executableTools = await loadExecutableAgentTools(params.workspaceId, params.agentId);
  // استدعاء الأدوات الأصلي: تعريفات منظّمة تُمرَّر للنموذج (Gemini/Vertex) بدل وصفها نصّاً وطلب JSON.
  const toolDeclarations = executableTools.length > 0 ? buildAgentToolDeclarations(executableTools) : undefined;
  const mediaGuidance = mediaContext.sources.length > 0
    ? [
        "تعليمات الوسائط: عند وصول صورة أو صوت أو فيديو بلا نص واضح، رحّب بالعميل واسأل سؤالاً توضيحياً واحداً فقط عن كيف يمكن المساعدة.",
        "لا تترك الرد فارغاً. لا تخمّن محتوى الوسائط غير الظاهر.",
        mediaContext.context.trim(),
      ].filter(Boolean).join("\n")
    : "";

  const transcript = messages
    .map((message) => `[${message.direction === "inbound" ? "العميل" : "الموظف"}]: ${message.content}`)
    .join("\n");
  const knowledgeContext = knowledgeSources.length > 0
    ? `\n\nمعرفة ذات صلة من قاعدة البيانات (هذه هي الحقيقة الحالية المحدَّثة — إن تعارض مصدران في معلومة فاعتمد حصراً الأحدث «آخر تحديث» وتجاهل الأقدم؛ وإن خالفت هذه المعرفةُ ردّاً سابقاً لك في المحادثة فاعتمدها الآن وصحّح المعلومة للعميل بلطف):\n${knowledgeSources.map((item, index) => `[${index + 1}]${item.updatedAt ? ` (آخر تحديث: ${new Date(item.updatedAt).toISOString().slice(0, 10)})` : ""} ${item.title}: ${item.content.slice(0, KNOWLEDGE_INJECT_CHARS)}`).join("\n")}`
    : "";
  // مرونة الأسلوب (3 يوليو): النموذج كان يفتتح كل ردّ بـ«أهلاً بك!» وكأن المحادثة
  // تبدأ من الصفر (3 ترحيبات في محادثة واحدة). الشرط حتمي من الكود لا من ذاكرة النموذج.
  const hasPriorAgentReply = messages.some((message) => message.direction === "outbound");
  const styleGuidance = hasPriorAgentReply
    ? "\nمهم: هذه ليست بداية المحادثة — لا تبدأ ردّك بأي تحية أو ترحيب («أهلاً»، «مرحباً»، «يا هلا»، «حياك»...). ادخل في صلب الإجابة مباشرةً، ونوّع افتتاحياتك وصياغتك عن ردودك السابقة في المحادثة."
    : "";
  const systemPrompt = [
    executableTools.length > 0 ? TOOL_USE_RULES : "",
    `Current date/time: ${new Date().toISOString()}.`,
    instructions?.rolePrompt ?? defaultRolePrompt(workspaceName),
    instructions?.businessRules ? `قواعد النشاط: ${instructions.businessRules}` : "",
    instructions?.forbiddenActions ? `ممنوعات يحددها التاجر (ملزمة): ${instructions.forbiddenActions}` : "",
    instructions?.escalationRules ? `قواعد التحويل لموظف (يحددها التاجر لقطاعه — تسري إضافةً للقواعد العامة): ${instructions.escalationRules}\nعندما تنطبق حالة من هذه القواعد على رسالة العميل، استدعِ أداة handoff_to_human فعلياً.` : "",
    sectorContext,
    GROUNDING_RULES,
    HUMAN_STYLE,
    CONVERSATION_DISCIPLINE,
    SCOPE_DISCIPLINE,
    `اللهجة: ${agent.dialect}.`,
    agent.tone ? (REPLY_LENGTH_PRESETS[agent.tone.trim()] ?? `النبرة: ${agent.tone}.`) : "",
    mediaGuidance,
  ].filter(Boolean).join("\n");
  const userPrompt = `اكتب رداً مناسباً على آخر رسالة في هذه المحادثة.

المحادثة:
${transcript || "لا توجد رسائل في هذه المحادثة"}${knowledgeContext}${productCatalogContext ? `\n\n${productCatalogContext}` : ""}${orderStatusContext ? `\n\n${orderStatusContext}` : ""}${metaStoreContext}${learnedContext}

المطلوب: أجب مباشرةً على آخر رسالة من العميل بمحتواها المحدّد. لا تكرّر ردّاً سابقاً حرفياً، ولا تكتفِ بعبارة ختامية عامة إلا إذا أنهى العميل المحادثة فعلاً. ردّ بالعربية بأسلوب إنساني ودافئ طبيعي مناسب للسياق.${styleGuidance}`;
  const model = agent.defaultModel && agent.defaultModel !== "mock" ? agent.defaultModel : getDefaultModel();

  // راوتر الموديلات (المرحلة 1): اختر flash للعادي / pro للصعب، ووجّه الصور لمسار الرؤية.
  // الصعوبة من إشارات التصعيد/التعارض وتعدّد النوايا وضعف تطابق المعرفة.
  const tier = classifyComplexity({
    inboundText: lastInbound?.content ?? "",
    knowledgeMatchCount: knowledgeSources.length,
    turnCount: messages.length,
    imageCount: mediaContext.images.length,
  });
  const route = resolveModel(
    mediaContext.images.length > 0
      ? "vision"
      : mediaContext.audio.length > 0
        ? "voice"
        : "text.reply",
    tier,
  );

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
    // PD-10: عند تفعيل الأدوات نطلب JSON صارماً (responseMimeType + حرارة منخفضة) ليلتزم النموذج بصيغة tool_calls
    // ولا يردّ نصّاً صرفاً يُسقط الأدوات. بلا أدوات، الردّ نصّ حرّ كما هو.
    const aiOutput = await runAIWithTimeout({
      messages: runMessages,
      model,
      // راوتر الموديلات: المعرّف المحدّد لمستوى/مهمة هذا الردّ (يُستخدم على مسار Vertex مع سقوط آمن).
      modelId: route.modelId,
      // فوترة النقاط: يُحتسب استهلاك توكنات هذا الردّ (بما فيه الرؤية/الصوت) نقاطاً مركزياً في runAI.
      workspaceId: params.workspaceId,
      aiRunId: run.id,
      taskType: "draft_reply",
      maxTokens: agent.maxOutputTokens,
      responseFormat: "text",
      // حرارة دافئة ليكون الردّ بشرياً مرناً (لا 0.1 الباردة). الأدوات الأصلية لا تحتاج حرارة منخفضة.
      temperature: AGENT_REPLY_TEMPERATURE,
      // استدعاء الأدوات الأصلي: تعريفات منظّمة؛ النموذج يعيد toolCalls منظّمة لا JSON نصّياً هشّاً (يقتل PD-8/PD-10).
      tools: toolDeclarations,
      // vision: مرّر الصور الواردة (base64) ليحلّلها النموذج بصرياً ويرد بناءً عليها.
      images: mediaContext.images,
      // voice: مرّر الملاحظات الصوتية الواردة (base64) ليفهمها النموذج سمعياً ويرد على محتواها.
      audio: mediaContext.audio,
    });

    // H5-1 + تحديث 9 يوليو (قرار مالك): لو AI غير متوفّر → صعّد للبشر، ولا تُرسل نص تجريبي
    // (محمية #10) — لكن لا تتركه صمتاً مطبقاً أيضاً: أرسل إشعار التحويل الحتمي الصادق
    // (التحويل يحدث فعلاً مع هذا الرد). «الانقطاع الفجائي» بلا كلمة كان أسوأ تجربة للعميل.
    if (aiOutput.fallbackUsed) {
      await db.update(aiRunsTable).set({
        status: "failed",
        errorMessage: "AI provider unavailable — escalating with handoff notice",
        completedAt: new Date(),
      }).where(and(eq(aiRunsTable.id, run.id), eq(aiRunsTable.workspaceId, params.workspaceId)));
      return { reply: HANDOFF_NOTICE, shouldEscalate: true, runId: run.id, toolResults: [] };
    }

    // استدعاء الأدوات الأصلي: النموذج يعيد toolCalls منظّمة مباشرةً — لا تحليل نصّ هشّ (يقتل PD-8/PD-10).
    // حادثة «مكبر السيارن» (11 يوليو): النموذج قد يكتب الاستدعاء نصّاً داخل الردّ بدل القناة
    // الأصلية — يُقتصّ من النص (لا يصل العميل كود أبداً) وتُنقَذ النيّة بدمجها في نفس مسار التنفيذ
    // الآمن أدناه (تحقّق zod لكل أداة). المكرَّر مع استدعاء أصلي بنفس الاسم يُهمَل (النموذج قد
    // يصدر القناتين معاً).
    const textualExtraction = extractTextualToolCalls(aiOutput.content);
    if (textualExtraction.calls.length > 0 || textualExtraction.cleanText !== aiOutput.content.trim()) {
      logger.warn(
        { runId: run.id, conversationId: params.conversationId, salvaged: textualExtraction.calls.map((call) => call.name) },
        "Textual tool-call JSON stripped from agent reply (salvaged into native execution path)",
      );
    }
    const nativeCalls = (aiOutput.toolCalls ?? []).map((call) => ({ name: call.name, arguments: call.args }));
    const nativeCallNames = new Set(nativeCalls.map((call) => call.name));
    const structuredCalls = [
      ...nativeCalls,
      ...textualExtraction.calls.filter((call) => !nativeCallNames.has(call.name)),
    ];
    const toolResults = await executeAgentToolCalls({
      workspaceId: params.workspaceId,
      conversationId: params.conversationId,
      agentId: params.agentId,
      aiRunId: run.id,
      systemUserId: params.systemUserId,
      calls: structuredCalls,
    });
    // فشل حرج فقط (طلب/دفعة/موعد/تحويل فشلت فعلياً) يمسح الردّ ويصعّد. فشل حميد — مثل صورة
    // منتج غير متوفرة — يُبقي الردّ النصي السليم ويُسجَّل ملاحظةً داخلية فقط (حادثة 10 يوليو).
    const hasToolProblem = hasCriticalAgentToolFailure(toolResults);
    const hasHandoff = toolResults.some((result) => result.tool === "handoff_to_human" && result.status === "success");
    const modelText = sanitizeReply(textualExtraction.cleanText);
    // نصّ النموذج إن وُجد؛ وإلا تأكيد حتمي حسب نتيجة الأداة (يتفادى الردّ الفارغ عند استدعاء أداة بلا نص).
    const candidateReply = hasToolProblem
      ? SAFE_REVIEW_REPLY
      : (modelText || confirmationFromToolResults(toolResults));
    // بوابة ادّعاء التنفيذ (7 يوليو): «تم تسجيل طلبك/تأكيد الدفع» بلا نتيجة أداة ناجحة مطابقة
    // = كذب على العميل — يُستبدل الردّ بالإحالة الآمنة ويُصعَّد. تأكيد الدفع محظور حتى مع نجاح
    // log_payment_claim (الأداة تسجّل ادّعاءً معلّقاً فقط). القاعدة النصية وحدها ثبت اختراقها
    // (حادثة «299 ريال» ادّعى بعدها «قمت بتحويل طلبك») — هذه ترجمتها البنيوية.
    const successfulTools = toolResults.filter((result) => result.status === "success").map((result) => result.tool);
    // حادثة 10 يوليو: عميل له طلب سابق فعلي قد يُقال له صدقاً «تم تأكيد طلبك» بلا استدعاء
    // create_order في هذا التشغيل — orderStatusContext غير الفارغ يعني وجود طلبات حقيقية له.
    const unbackedClaim = hasToolProblem
      ? null
      : findUnbackedActionClaim(candidateReply, successfulTools, {
          customerHasOrders: orderStatusContext.trim().length > 0,
        });
    const paymentClaim = !hasToolProblem && replyConfirmsPayment(candidateReply);
    // وعد تحويل/إرجاع مال للعميل (13 يوليو): مالي بحت بلا أداة استرداد — يُعامل كتأكيد الدفع
    // (استبدال + تصعيد دائماً). داخل claimGuardTripped ليُستبدَل الردّ وتتخطّاه الحُرّاس التالية.
    const moneyPromise = !hasToolProblem && replyPromisesMoneyToCustomer(candidateReply);
    const claimGuardTripped = unbackedClaim !== null || paymentClaim || moneyPromise;
    // حارس الروابط المخترعة (10 يوليو 2026): نفس فلسفة بوابة الادّعاء أعلاه — أي رابط في الردّ
    // نطاقه غير موجود حرفياً في أي سياق مرفق (البرومبت/المعرفة/الكتالوج/حالة الطلبات) يُعتبر
    // اختراعاً يُستبدل الردّ ويُصعَّد. تُتخطّى إن كانت بوابة الادّعاء قد استبدلت الردّ أصلاً.
    const allowedLinkContext = [systemPrompt, knowledgeContext, productCatalogContext, orderStatusContext].join("\n");
    const unauthorizedLink = claimGuardTripped ? null : findUnauthorizedLink(candidateReply, allowedLinkContext);
    // حارس الساعات المخترعة/المقلوبة (11 يوليو): زوج «ساعة+فترة» في الردّ غير موجود حرفياً في أي
    // سياق مرفق = اختراع (النموذج قلب 10ص-8م إلى 8ص-10م رغم قاعدة النقل الحرفي). السياق يشمل
    // نص المحادثة عمداً — ترديد ساعة ذكرها العميل نفسه مشروع. تفاصيل: agent-escalation.ts.
    const allowedHoursContext = [allowedLinkContext, transcript, metaStoreContext, learnedContext].join("\n");
    const ungroundedHours = (claimGuardTripped || unauthorizedLink) ? null : findUngroundedWorkHours(candidateReply, allowedHoursContext);
    // حارس الأسعار المخترعة/المسمَّمة ذاتياً (13 يوليو 2026): أي سعر في الردّ قيمتُه غير موجودة في
    // السياق الموثوق = اختراع يُستبدل الردّ ويُصعَّد. السياق الموثوق للسعر يستبعد عمداً ردودَ الوكيل
    // الصادرة (يكسر حلقة التسميم الذاتي: الرقم المختلق في السجل لا يصير مصدراً)، ومنشوراتِ ميتا
    // والأجوبةَ المتعلَّمة (قرار مقفل: المخزون هو سلطة السعر الوحيدة). يشمل رسائل العميل الواردة —
    // ترديد سعر ذكره العميل نفسه مشروع. تفاصيل: agent-escalation.ts.
    const customerInboundText = messages
      .filter((message) => message.direction === "inbound")
      .map((message) => message.content ?? "")
      .join("\n");
    const allowedPriceContext = [systemPrompt, knowledgeContext, productCatalogContext, orderStatusContext, customerInboundText].join("\n");
    const ungroundedPrice = (claimGuardTripped || unauthorizedLink || ungroundedHours)
      ? null
      : findUngroundedPrice(candidateReply, allowedPriceContext);
    const finalReply = (claimGuardTripped || unauthorizedLink || ungroundedHours || ungroundedPrice) ? SAFE_REVIEW_REPLY : candidateReply;

    if (!finalReply) {
      await db.update(aiRunsTable).set({
        status: "failed",
        errorMessage: "AI returned empty reply",
        completedAt: new Date(),
      }).where(and(eq(aiRunsTable.id, run.id), eq(aiRunsTable.workspaceId, params.workspaceId)));
      // ردّ فارغ → تصعيد، ومع إشعار تحويل صادق بدل الصمت المطبق (قرار مالك 9 يوليو).
      return { reply: HANDOFF_NOTICE, shouldEscalate: true, runId: run.id, toolResults };
    }

    // أسباب التصعيد مجمّعة باسمها الصريح — تُخزَّن في metadata.decision لتشخيص «لماذا تصرّف
    // الوكيل هكذا» لكل ردّ (بديل التخمين من السجلات). التصعيد بنيوي أولاً (أداة/بوابة)،
    // وشبكات الوعود ثانياً (الخادم يجعل كلام النموذج صادقاً)، وطلب العميل الصريح أخيراً.
    //
    // سياسة متدرّجة (10 يوليو 2026 — إصلاح «وباء إسكات الوكيل»): كانت «سأتأكد من الفريق»
    // (verification_promise) تُعامل كتحويل كامل: agent_status=human للأبد + إشعار تحويل للعميل.
    // ولأن قواعد التأريض نفسها تأمر النموذج بهذه العبارة كلما غابت معلومة، كانت أغلب المحادثات
    // تموت خلال أول رسائل («الوكيل لا يرد/لا يستخدم المخزون/يحوّل دون طلب العميل» — شكاوى حية).
    // الآن مستويان:
    //  - تحويل كامل (hardEscalationReasons): فشل أداة، بوابة الادّعاء، أداة handoff فعلية،
    //    وعد تحويل نصّي، طلب صريح من العميل → يسكت الوكيل + إشعار تحويل للعميل + إشعار التاجر.
    //  - تنبيه ناعم (needsAttention): «سأتأكد من الفريق» فقط → إشعار للتاجر + علامة needsHuman
    //    في الوارد، والوكيل يواصل خدمة العميل طبيعياً — لا إسكات ولا إشعار تحويل.
    const hardEscalationReasons: string[] = [];
    if (hasToolProblem) hardEscalationReasons.push("tool_failure");
    if (unbackedClaim) hardEscalationReasons.push(`unbacked_claim:${unbackedClaim}`);
    if (paymentClaim) hardEscalationReasons.push("payment_confirmation_claim");
    if (moneyPromise) hardEscalationReasons.push("money_transfer_promise");
    if (unauthorizedLink) hardEscalationReasons.push(`unauthorized_link:${unauthorizedLink}`);
    if (ungroundedHours) hardEscalationReasons.push(`ungrounded_hours:${ungroundedHours}`);
    if (ungroundedPrice) hardEscalationReasons.push(`ungrounded_price:${ungroundedPrice}`);
    if (hasHandoff) hardEscalationReasons.push("handoff_tool");
    if (replyPromisesHandoff(finalReply)) hardEscalationReasons.push("handoff_promise");
    if (includesEscalationKeyword(lastInbound?.content ?? "") && !hasInboundMedia(lastInbound)) {
      hardEscalationReasons.push("customer_request");
    }
    // تصعيد بنيّة العميل (الحل الجذري): نزاع جدّي/تهديد قانوني/اتهام احتيال في رسالة العميل يحتاج
    // بشراً فوراً — تصعيد صلب مستقلٌّ تماماً عن صياغة الوكيل (يُنهي مطاردة الأنماط لهذه الفئة).
    if (detectsSeriousDispute(lastInbound?.content ?? "")) hardEscalationReasons.push("dispute_complaint");
    const softAttentionReasons: string[] = [];
    if (replyPromisesVerification(finalReply)) softAttentionReasons.push("verification_promise");
    // وعد عمل من الفريق (13 يوليو): «طلبت من الفريق فيديو» → تنبيه ناعم يجعل الوعد صادقاً
    // (التاجر يُشعَر فيرسل الوسائط) دون إسكات الوكيل — نفس سياسة verification_promise المتدرّجة.
    if (replyPromisesTeamAction(finalReply)) softAttentionReasons.push("team_action_promise");
    // وعد تصعيد/رفع الأمر للإدارة أو الفريق (أ-2.5، رُصد حيّاً): تنبيه ناعم — التاجر يُشعَر ليراجع
    // ويتصرّف، والوكيل يواصل. «صعّدت طلبك» الصريحة يلتقطها حارس التحويل الصلب أعلاه ويغلب.
    if (replyPromisesEscalationReview(finalReply)) softAttentionReasons.push("escalation_review_promise");
    // مطالبة استرجاع مال (نيّة العميل): التاجر يُشعَر بكل رسالة استرجاع مهما كتب الوكيل — تنبيه
    // ناعم لا يُسكِت الوكيل (يبقى يجيب أسئلة سياسة الاسترجاع)، وحُرّاس أ-2 تمنع أي وعد مال خطر.
    if (detectsRefundDemand(lastInbound?.content ?? "")) softAttentionReasons.push("refund_demand");

    const shouldEscalate = hardEscalationReasons.length > 0;
    const needsAttention = !shouldEscalate && softAttentionReasons.length > 0;
    const escalationReasons = [...hardEscalationReasons, ...softAttentionReasons];
    // إشعار التحويل الصريح: فقط مع التحويل الكامل — التنبيه الناعم لا يغيّر ردّ العميل إطلاقاً.
    // يُحسب بعد أسباب التصعيد (الإشعار نفسه لا يولّد سبباً) وقبل التخزين (يُخزَّن ما سيُرسَل فعلاً).
    const handoffCommunication = ensureHandoffCommunicated(finalReply, shouldEscalate);
    const outboundReply = handoffCommunication.reply;

    await db.insert(aiMessagesTable).values([
      { workspaceId: params.workspaceId, aiRunId: run.id, role: "system", content: systemPrompt, metadata: {} },
      { workspaceId: params.workspaceId, aiRunId: run.id, role: "user", content: userPrompt, metadata: {} },
      {
        workspaceId: params.workspaceId,
        aiRunId: run.id,
        role: "assistant",
        content: outboundReply,
        metadata: {
          knowledgeSources,
          toolResults,
          toolCalls: structuredCalls.length > 0 ? structuredCalls : undefined,
          rawOutput: modelText !== aiOutput.content ? aiOutput.content : undefined,
          decision: {
            escalated: shouldEscalate,
            needsAttention,
            reasons: escalationReasons,
            replyReplacedByGuard: claimGuardTripped,
            handoffNoticeAppended: handoffCommunication.noticeAppended,
            knowledgeCount: knowledgeSources.length,
            knowledgeTopScore: knowledgeSources.reduce((max, source) => Math.max(max, source.score ?? 0), 0) || null,
            catalogInjected: productCatalogContext.length > 0,
            orderContextInjected: orderStatusContext.length > 0,
            metaStoreContextInjected: metaStoreContext.length > 0,
            learnedContextInjected: learnedContext.length > 0,
            salvagedTextualToolCalls: textualExtraction.calls.length,
            sectorInjected: sectorContext.length > 0,
          },
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

    // shouldEscalate = تحويل كامل فقط (يسكت الوكيل ويُبلَّغ العميل والتاجر).
    // needsAttention = تنبيه ناعم فقط (يُبلَّغ التاجر، والوكيل يواصل) — انظر السياسة المتدرّجة أعلاه.
    return { reply: outboundReply, shouldEscalate, needsAttention, runId: run.id, toolResults };
  } catch (err) {
    if ((err as { code?: string }).code === "ai_points_exhausted") {
      await db.update(aiRunsTable).set({
        status: "failed",
        errorMessage: "AI points exhausted",
        completedAt: new Date(),
      }).where(and(eq(aiRunsTable.id, run.id), eq(aiRunsTable.workspaceId, params.workspaceId)));
      // نفاد الرصيد → تصعيد بإشعار تحويل صادق (يُرسَل مرة واحدة — المحادثة تصير human بعدها
      // فيتجاهل الـworker بقية الرسائل، لا سيل إشعارات). لا ذكر للرصيد أمام العميل (محمية #10).
      return { reply: HANDOFF_NOTICE, shouldEscalate: true, runId: run.id, toolResults: [] };
    }
    await db.update(aiRunsTable).set({
      status: "failed",
      errorMessage: err instanceof Error ? err.message : "Unknown AI error",
      completedAt: new Date(),
    }).where(and(eq(aiRunsTable.id, run.id), eq(aiRunsTable.workspaceId, params.workspaceId)));
    throw err;
  }
}

// نتيجة محاكاة الوكيل (بوابة «اختبر قبل التفعيل» بنمط Fin). تعكس ما **سيفعله** الوكيل الحيّ بالضبط
// (نفس القواعد + التأريض + الأدوات المنظّمة + بوابة الادّعاء + توجيه الموديل) لكن **بلا أي أثر جانبي**.
export interface AgentSimulationResult {
  reply: string;
  knowledgeSources: string[];   // عناوين مصادر المعرفة التي استُخدمت فعلاً
  // نفس المصادر مع درجة الثقة (0-1) — تُعرض للتاجر ليعرف قوة استناد الردّ للمعرفة.
  sourcesDetailed: { title: string; score: number | null }[];
  toolCalls: { name: string; args: Record<string, unknown> }[];   // ما سيُستدعى — لا يُنفَّذ في المحاكاة
  wouldEscalate: boolean;       // هل ستتحوّل المحادثة لبشري
  escalationReasons: string[];  // أسباب التصعيد بأسمائها الصريحة (نفس أسماء المسار الحي)
  provider: string;
  aiUnavailable: boolean;       // النموذج غير متاح/تجريبي → ليست إجابة حقيقية
}

// محاكاة آمنة وأمينة لردّ الوكيل: تبني نفس السياق (معرفة + كتالوج + أدوات + قواعد) وتستدعي النموذج
// فعلياً، لكنها **لا تُنفّذ أي أداة، ولا تصعّد محادثة، ولا تُرسل، ولا تكتب أي سجلّ حيّ**. تعيد ما
// «سيحدث» فقط. تعيد استخدام نفس اللبنات النقية لحلقة الإنتاج (fidelity) دون لمس runAgentReply.
export async function simulateAgentReply(params: {
  workspaceId: string;
  agentId: string;
  message: string;
}): Promise<AgentSimulationResult> {
  const [agent] = await db
    .select()
    .from(aiAgentsTable)
    .where(and(eq(aiAgentsTable.id, params.agentId), eq(aiAgentsTable.workspaceId, params.workspaceId)))
    .limit(1);
  if (!agent) throw new Error("AI_AGENT_NOT_FOUND");
  // اسم المتجر للدور الافتراضي — جلب خفيف بالمفتاح الأساسي (انظر defaultRolePrompt).
  const [workspaceRow] = await db
    .select({ name: workspacesTable.name })
    .from(workspacesTable)
    .where(eq(workspacesTable.id, params.workspaceId))
    .limit(1);
  const workspaceName = workspaceRow?.name?.trim() ?? "";

  const [instructions] = await db
    .select()
    .from(aiAgentInstructionsTable)
    .where(and(eq(aiAgentInstructionsTable.agentId, params.agentId), eq(aiAgentInstructionsTable.workspaceId, params.workspaceId)))
    .limit(1);

  const message = params.message.trim();
  // نفس تقييد المعرفة المطبَّق في المسار الحيّ أعلاه — حتى تُطابق المحاكاةُ السلوكَ الحقيقي تماماً.
  const simKnowledgeBaseIds = Array.isArray(agent.knowledgeBaseIds)
    ? (agent.knowledgeBaseIds as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const knowledgeSources = await searchKnowledgeForAi({
    workspaceId: params.workspaceId,
    query: message,
    knowledgeBaseIds: simKnowledgeBaseIds,
  });
  let productCatalogContext = "";
  try {
    productCatalogContext = await loadProductCatalogContext(params.workspaceId);
  } catch (err) {
    logger.warn({ err, workspaceId: params.workspaceId }, "simulate: loadProductCatalogContext failed — continuing without catalog context");
  }
  // أمانة المحاكاة (الطور 2): نفس سياق ميتا الحيّ المحقون في المسار الحي أعلاه، بنفس التسامح مع الفشل.
  let metaStoreContext = "";
  try {
    metaStoreContext = (await loadMetaStoreContext(params.workspaceId)).context;
  } catch (err) {
    logger.warn({ err, workspaceId: params.workspaceId }, "simulate: loadMetaStoreContext failed — continuing without meta store context");
  }
  // أمانة المحاكاة (الطور 3): نفس الأجوبة المتعلَّمة المعتمدة المحقونة في المسار الحي أعلاه.
  let learnedContext = "";
  try {
    learnedContext = (await loadLearnedContext(params.workspaceId, message)).context;
  } catch (err) {
    logger.warn({ err, workspaceId: params.workspaceId }, "simulate: loadLearnedContext failed — continuing without learned context");
  }
  // أمانة المحاكاة: نفس سياق القطاع المحقون في المسار الحي.
  let sectorContext = "";
  try {
    sectorContext = await loadSectorAgentContext(params.workspaceId, agent);
  } catch (err) {
    logger.warn({ err, workspaceId: params.workspaceId }, "simulate: loadSectorAgentContext failed — continuing without sector context");
  }
  const executableTools = await loadExecutableAgentTools(params.workspaceId, params.agentId);
  const toolDeclarations = executableTools.length > 0 ? buildAgentToolDeclarations(executableTools) : undefined;

  const knowledgeContext = knowledgeSources.length > 0
    ? `\n\nمعرفة ذات صلة من قاعدة البيانات (هذه هي الحقيقة الحالية المحدَّثة — إن تعارض مصدران في معلومة فاعتمد حصراً الأحدث «آخر تحديث» وتجاهل الأقدم؛ وإن خالفت هذه المعرفةُ ردّاً سابقاً لك في المحادثة فاعتمدها الآن وصحّح المعلومة للعميل بلطف):\n${knowledgeSources.map((item, index) => `[${index + 1}]${item.updatedAt ? ` (آخر تحديث: ${new Date(item.updatedAt).toISOString().slice(0, 10)})` : ""} ${item.title}: ${item.content.slice(0, KNOWLEDGE_INJECT_CHARS)}`).join("\n")}`
    : "";
  const systemPrompt = [
    executableTools.length > 0 ? TOOL_USE_RULES : "",
    `Current date/time: ${new Date().toISOString()}.`,
    instructions?.rolePrompt ?? defaultRolePrompt(workspaceName),
    instructions?.businessRules ? `قواعد النشاط: ${instructions.businessRules}` : "",
    instructions?.forbiddenActions ? `ممنوعات يحددها التاجر (ملزمة): ${instructions.forbiddenActions}` : "",
    instructions?.escalationRules ? `قواعد التحويل لموظف (يحددها التاجر لقطاعه — تسري إضافةً للقواعد العامة): ${instructions.escalationRules}\nعندما تنطبق حالة من هذه القواعد على رسالة العميل، استدعِ أداة handoff_to_human فعلياً.` : "",
    sectorContext,
    GROUNDING_RULES,
    HUMAN_STYLE,
    CONVERSATION_DISCIPLINE,
    SCOPE_DISCIPLINE,
    `اللهجة: ${agent.dialect}.`,
    agent.tone ? (REPLY_LENGTH_PRESETS[agent.tone.trim()] ?? `النبرة: ${agent.tone}.`) : "",
  ].filter(Boolean).join("\n");
  const transcript = `[العميل]: ${message}`;
  const userPrompt = `اكتب رداً مناسباً على آخر رسالة في هذه المحادثة.

المحادثة:
${transcript}${knowledgeContext}${productCatalogContext ? `\n\n${productCatalogContext}` : ""}${metaStoreContext}${learnedContext}

المطلوب: أجب مباشرةً على آخر رسالة من العميل بمحتواها المحدّد. ردّ بالعربية بأسلوب إنساني ودافئ طبيعي مناسب للسياق.`;

  const model = agent.defaultModel && agent.defaultModel !== "mock" ? agent.defaultModel : getDefaultModel();
  const tier = classifyComplexity({ inboundText: message, knowledgeMatchCount: knowledgeSources.length, turnCount: 1, imageCount: 0 });
  const route = resolveModel("text.reply", tier);

  // استدعاء حقيقي للنموذج (يُفوتَر كاستخدام فعلي عبر workspaceId) بنفس أدوات الإنتاج — لكن لا تنفيذ.
  const aiOutput = await runAIWithTimeout({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    model,
    modelId: route.modelId,
    workspaceId: params.workspaceId,
    taskType: "draft_reply",
    maxTokens: agent.maxOutputTokens,
    responseFormat: "text",
    temperature: AGENT_REPLY_TEMPERATURE,
    tools: toolDeclarations,
  });

  // نفس حارس التسريب النصّي الحيّ (حادثة «مكبر السيارن») — المحاكاة يجب أن ترى ما سيُرسَل فعلاً.
  const textualExtraction = extractTextualToolCalls(aiOutput.content);
  const nativeSimCalls = (aiOutput.toolCalls ?? []).map((call) => ({ name: call.name, args: call.args }));
  const nativeSimNames = new Set(nativeSimCalls.map((call) => call.name));
  const intendedCalls = [
    ...nativeSimCalls,
    ...textualExtraction.calls.filter((call) => !nativeSimNames.has(call.name)).map((call) => ({ name: call.name, args: call.arguments })),
  ];
  const modelText = sanitizeReply(textualExtraction.cleanText);
  // نصّ المعاينة: نصّ النموذج، وإلا نفس التأكيد الحتمي الذي سيرسله المسار الحيّ عند استدعاء أداة بلا نص.
  const candidateReply = modelText || confirmationFromToolResults(
    intendedCalls.map((call) => ({ tool: call.name as AgentToolResult["tool"], status: "success" as const, summary: "" })),
  );
  // نفس بوابة الادّعاء الحيّة: في المحاكاة نفترض نجاح الاستدعاءات المنوية (تفاؤلياً)، فالادّعاء
  // المسنود باستدعاء منويّ يمرّ، والادّعاء بلا استدعاء أصلاً يُستبدل ويُعلَّم — كما سيحدث حياً.
  const intendedToolNames = intendedCalls.map((call) => call.name);
  const unbackedClaim = findUnbackedActionClaim(candidateReply, intendedToolNames);
  const paymentClaim = replyConfirmsPayment(candidateReply);
  const moneyPromise = replyPromisesMoneyToCustomer(candidateReply);
  const claimGuardTripped = unbackedClaim !== null || paymentClaim || moneyPromise;
  // نفس حارس الأسعار الحيّ: أي سعر في المعاينة غير موجود في السياق الموثوق = اختراع يُستبدل.
  // السياق هنا = التعليمات + المعرفة + الكتالوج + رسالة العميل (لا سياق طلبات في المحاكاة).
  const allowedPriceContext = [systemPrompt, knowledgeContext, productCatalogContext, message].join("\n");
  const ungroundedPrice = claimGuardTripped ? null : findUngroundedPrice(candidateReply, allowedPriceContext);
  const previewReply = (claimGuardTripped || ungroundedPrice) ? SAFE_REVIEW_REPLY : candidateReply;

  // نفس السياسة المتدرّجة الحيّة: «سأتأكد من الفريق» تنبيه ناعم لا يحوّل ولا يغيّر الردّ —
  // wouldEscalate هنا يعكس التحويل الكامل فقط (ما سيُسكِت الوكيل فعلاً)، والمعاينة = المُرسَل.
  const hardReasons: string[] = [];
  if (unbackedClaim) hardReasons.push(`unbacked_claim:${unbackedClaim}`);
  if (paymentClaim) hardReasons.push("payment_confirmation_claim");
  if (moneyPromise) hardReasons.push("money_transfer_promise");
  if (ungroundedPrice) hardReasons.push(`ungrounded_price:${ungroundedPrice}`);
  if (intendedCalls.some((call) => call.name === "handoff_to_human")) hardReasons.push("handoff_tool");
  if (replyPromisesHandoff(previewReply)) hardReasons.push("handoff_promise");
  if (includesEscalationKeyword(message)) hardReasons.push("customer_request");
  if (detectsSeriousDispute(message)) hardReasons.push("dispute_complaint");
  const softReasons: string[] = [];
  if (replyPromisesVerification(previewReply)) softReasons.push("verification_promise");
  if (replyPromisesTeamAction(previewReply)) softReasons.push("team_action_promise");
  if (replyPromisesEscalationReview(previewReply)) softReasons.push("escalation_review_promise");
  if (detectsRefundDemand(message)) softReasons.push("refund_demand");
  const handoffCommunication = ensureHandoffCommunicated(previewReply, hardReasons.length > 0);

  return {
    reply: handoffCommunication.reply,
    knowledgeSources: knowledgeSources.map((item) => item.title),
    sourcesDetailed: knowledgeSources.map((item) => ({ title: item.title, score: item.score ?? null })),
    toolCalls: intendedCalls,
    wouldEscalate: hardReasons.length > 0,
    escalationReasons: [...hardReasons, ...softReasons],
    provider: aiOutput.provider,
    aiUnavailable: aiOutput.fallbackUsed === true || aiOutput.provider === "mock",
  };
}
