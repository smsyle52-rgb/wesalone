// مطابقات التصعيد البشري — وحدة نقية (بلا db) حتى تُختبر مباشرة بوحدات vitest.
//
// تاريخ الضبط (3 يوليو 2026، من أدلة إنتاج حقيقية):
// - الكلمات المفردة العامة («موظف»، «بشري»، «مسؤول»، «اكلم احد») حُذفت — تلتقط جملاً
//   بريئة مثل «عندكم موظف توصيل؟» وتسببت بتحويلات بشرية خاطئة. المطابقة الآن أزواج نية.
// - أنماط «الوعد بالتحويل» الفضفاضة («سيتواصل معك»، «زملائي»، «للفريق المختص») حُذفت —
//   تلتقط تنسيق التوصيل العادي. بقيت عبارات التحويل الصريحة فقط.

// تطبيع عربي قبل المطابقة: إزالة التشكيل وتوحيد الهمزات/التاء المربوطة/الألف المقصورة —
// «اكلم انسان» (كما يكتبها العملاء فعلاً) يجب أن تطابق «أكلم إنسان».
export function normalizeArabic(value: string): string {
  return value
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase();
}

// طلب صريح من العميل لإنسان/موظف — مخزنة بصيغة مطبَّعة.
// «تحويل» وحدها مستبعدة عمداً (تلتقط «تحويل بنكي»).
const ESCALATION_KEYWORDS = [
  // أزواج نية: فعل طلب + إنسان/موظف
  "اكلم انسان",
  "كلمني انسان",
  "اريد انسان",
  "ابغي انسان",
  "ابي انسان",
  "عايز انسان",
  "انسان حقيقي",
  "شخص حقيقي",
  "بشر حقيقي",
  "تحويل بشري",
  "موظف بشري",
  "اكلم موظف",
  "كلمني موظف",
  "اريد موظف",
  "ابغي موظف",
  "ابي موظف",
  "عايز موظف",
  "حولني لموظف",
  "حولني لشخص",
  "حولني للدعم",
  "حولوني لموظف",
  // ملاحظة تطبيع (10 يوليو): «مسؤول» تُكتب هنا بواو عادية لا همزة (ؤ) — normalizeArabic يحوّل
  // ؤ←و في رسالة العميل فلا تُطابق أبداً كلمة مفتاحية بها همزة خام (بق كامن غير مختبر سابقاً).
  "اكلم مسوول",
  "اكلم مدير",
  "اريد مدير",
  "ابغي مدير",
  "خدمه العملاء",
  "دعم فني",
  // حادثة 10 يوليو: العميل يطلب «الإدارة» أو «الفريق» — أشهر صيغ الطلب في السوق اليمني/الخليجي،
  // وكانت غائبة كلياً (الوكيل اخترع رقم تواصل بدل التحويل). أزواج نية كسابقاتها، لا مفردات.
  "اكلم الاداره",
  "كلمني الاداره",
  "اريد الاداره",
  "ابغي الاداره",
  "ابي الاداره",
  "عايز الاداره",
  "حولني للاداره",
  "حولوني للاداره",
  "اكلم الفريق",
  "كلمني الفريق",
  "حولني للفريق",
  "حولوني للفريق",
  "صعد طلبي",
  "صعدو طلبي",
  "تصعيد طلبي",
  // اكتشاف اختبار حمل آلي (10 يوليو 2026، 3 سيناريوهات مستقلة أكّدته): «أبي أتكلم مع مسؤول
  // المتجر مباشرة» لا تُطابق أي نمط — صيغة الفعل «أتكلم مع» (تكلّم، متعدٍّ بحرف جر) شائعة جداً
  // بجانب «اكلم» (أكلم، متعدٍّ مباشر) الموجودة أعلاه، لكنها حرفياً كلمة مختلفة فلا يلتقطها التطبيع
  // الحالي (يوحّد الهمزات لا تصريف الفعل). أزواج نية كسابقاتها — لا نضيف «مسؤول» مجردة (تطابق
  // «من المسؤول عن التوصيل؟» البريئة، موجودة كحالة سلبية بالاختبارات).
  "اتكلم مع مسوول",
  "اتكلم مع موظف",
  "اتكلم مع مدير",
  "اتكلم مع الاداره",
  "اتكلم مع الفريق",
  "حولني لمسوول",
  "حولوني لمسوول",
  // القائمة الأصلية (سلوك ما قبل 2 يوليو — لم يشتكِ منها أحد)
  "مدير",
  "شكوي",
  "الغاء",
];

// عبارات التحويل الصريحة في ردّ الوكيل. النموذج أحادي التمرير: قد يكتب «قمت بتحويل
// طلبك» بلا استدعاء أداة — الخادم يجعل الادعاء حقيقة (وعد مكسور أسوأ من تصعيد زائد).
// لكن العبارات العامة («سيتواصل معك المندوب») ليست ادعاء تحويل — لا تُصعّد.
//
// حادثة 4 يوليو 2026 (محادثة استفسار شراكة/استثمار حقيقية): النموذج تهرّب بمفردة
// «سأصعّد للإدارة» بدل «تحويل» — لم تطابق أي نمط، فبقيت المحادثة agentStatus=active
// بلا إشعار للتاجر رغم أن الوكيل وعد العميل 4 مرات بأن الإدارة ستتواصل معه. أُضيفت
// عائلة «صعّد» الكاملة موازية تماماً لعائلة «حوّل» الموجودة.
const HANDOFF_PROMISE_PATTERNS = [
  "ساحول",
  "احولك",
  "احول طلبك",
  "احول حضرتك",
  "احول المحادثه",
  "بتحويل طلبك",
  "بتحويل المحادثه",
  "قمت بتحويل",
  "تم تحويل",
  "تم التحويل",
  "سيتم تحويل",
  "حولت طلبك",
  "حولنا طلبك",
  "ساحيل",
  "احيل طلبك",
  "انقل طلبك",
  "سيتم نقل طلبك",
  "اوصلك بالفريق",
  "اوصلك بموظف",
  // عائلة «صعّد» (تصعيد) — نفس بنية عائلة «حوّل» أعلاه
  "ساصعد",
  "اصعد طلبك",
  "اصعد حضرتك",
  "اصعد المحادثه",
  "بتصعيد طلبك",
  "بتصعيد المحادثه",
  "قمت بتصعيد",
  "تم تصعيد",
  "تم التصعيد",
  "سيتم تصعيد",
  "صعدت طلبك",
  "صعدنا طلبك",
];

export function includesEscalationKeyword(value: string): boolean {
  const normalized = normalizeArabic(value);
  return ESCALATION_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

// توازن التصعيد — قلب المنتج (حادثتا 6 و10 يوليو 2026):
// • «إذا تحتاج تحويل بشري سأحوّلك» = عرضٌ ينتظر موافقة العميل → لا تصعيد (لا استعجال).
// • «صعّدت طلبك للفريق، تحب أساعدك بشي ثاني؟» = وعدٌ واقع يليه سؤال مجاملة → يُنفَّذ (لا وعد مكسور).
// المحادثات العربية نادراً تستخدم النقاط، ففحصُ «هل توجد أداة شرط في الجملة؟» وحده جعل سؤال
// المجاملة بعد الوعد يلغيه. القاعدة الأدق: أداة الشرط تُعفي الوعدَ فقط إذا وردت **قبله** في
// جملته — الشرط يحكم ما بعده لا ما قبله. الفحص جملةً-جملة (كي لا يُعفي عرضٌ في جملةٍ وعداً
// في أخرى)، و«ان» المفردة مستبعدة عمداً: تلتبس بـ«أن» المصدرية («يسعدني أن أحوّلك») و«الآن».
const OFFER_MARKER_WORDS = ["اذا", "لو", "هل"];
const OFFER_MARKER_SUBSTRINGS = ["تحب", "تبي", "تبغ", "ودك", "تريد", "ترغب", "يناسبك"];

function earliestHandoffPatternIndex(normalizedSentence: string): number {
  let earliest = -1;
  for (const pattern of HANDOFF_PROMISE_PATTERNS) {
    const index = normalizedSentence.indexOf(pattern);
    if (index >= 0 && (earliest < 0 || index < earliest)) earliest = index;
  }
  return earliest;
}

function hasOfferMarkerBefore(normalizedSentence: string, patternIndex: number): boolean {
  const prefix = normalizedSentence.slice(0, patternIndex);
  if (OFFER_MARKER_SUBSTRINGS.some((marker) => prefix.includes(marker))) return true;
  const words = prefix.split(/\s+/);
  return words.some((word) => OFFER_MARKER_WORDS.includes(word));
}

export function replyPromisesHandoff(reply: string): boolean {
  const sentences = reply.split(/(?<=[.!؟?\n…])/);
  return sentences.some((sentence) => {
    const normalized = normalizeArabic(sentence);
    const patternIndex = earliestHandoffPatternIndex(normalized);
    if (patternIndex < 0) return false;
    return !hasOfferMarkerBefore(normalized, patternIndex);
  });
}

// ─── بوابة ادّعاء التنفيذ (7 يوليو 2026) ─────────────────────────────────────
// GROUNDING_RULES تمنع ادّعاء تنفيذ إجراء بلا أداة — لكنها وصية نصّية للنموذج فقط.
// هذه البوابة تجعل المنع بنيوياً: ردٌّ يدّعي «سجّلت طلبك/حجزت موعدك» بلا نتيجة أداة
// ناجحة مطابقة = ادّعاء كاذب يُستبدل ويُصعَّد (نفس عقيدة «الوعد = تنفيذ» المثبتة أعلاه).
// الأنماط أفعال إنجاز صريحة بصيغة الماضي/تم — لا تلتقط عرض حالة طلب موجود
// («طلبك مسجل لدينا») ولا اقتراح موعد («أقترح موعد غداً، يناسبك؟»).

export type ActionClaimTool = "create_order" | "schedule_followup";

const ACTION_CLAIM_PATTERNS: Record<ActionClaimTool, string[]> = {
  create_order: [
    "سجلت طلبك",
    "سجلنا طلبك",
    "تم تسجيل طلبك",
    "تم تسجيل الطلب",
    "تم انشاء طلبك",
    "تم انشاء الطلب",
    "انشات طلبك",
    "انشانا طلبك",
    "انشات لك طلب",
    "اضفت طلبك",
    "تم اضافه طلبك",
    "تم رفع طلبك",
    "رفعت طلبك",
    "اكدت طلبك",
    "تم تاكيد طلبك",
    "تم تاكيد الطلب",
    "تم استلام طلبك",
    "استلمنا طلبك",
    "طلبك تم بنجاح",
  ],
  schedule_followup: [
    "حجزت لك موعد",
    "حجزنا لك موعد",
    "تم حجز موعدك",
    "تم حجز الموعد",
    "سجلت موعدك",
    "سجلت لك موعد",
    "تم تحديد موعدك",
    "تم تثبيت موعدك",
    "ثبت موعدك",
    // زيارة مهندس/فني (تدقيق 13 يوليو): الوكيل ادّعى «رتّبت زيارة مهندس» بلا أداة — التزامٌ
    // ميداني كاذب. صيغ الماضي/الإنجاز فقط (لا «أرتّب لك زيارة؟» العرضية). إن استُدعيت
    // schedule_followup فعلاً فالموظف يرى المتابعة وينفّذ؛ وإلا يُستبدل الردّ ويُصعَّد.
    "رتبت زياره",
    "رتبنا زياره",
    "رتبت لك زياره",
    "تم ترتيب زياره",
    "تم ترتيب الزياره",
    "رتبت لك موعد زياره",
    "حددت لك زياره",
    "بعثنا لك مهندس",
    "سنرسل لك مهندس",
    "سنرسل لك فني",
    "سيزورك المهندس",
    "سيزورك الفني",
    "سيصلك المهندس",
    "سيصلك الفني",
  ],
};

// تأكيد الدفع محظور مطلقاً على الوكيل (SAFETY_SYSTEM_PROMPT + محمية المدفوعات):
// حتى log_payment_claim الناجحة تسجّل ادّعاءً معلّقاً فقط — أي ردّ يؤكّد استلام
// المال أو قبوله كذبٌ مالي يُستبدل ويُصعَّد بصرف النظر عن نتائج الأدوات.
const PAYMENT_CONFIRMATION_CLAIMS = [
  "تم تاكيد الدفع",
  "تم تاكيد دفعتك",
  "تاكدنا من الدفع",
  "تم استلام المبلغ",
  "استلمنا المبلغ",
  "وصلنا المبلغ",
  "وصل المبلغ",
  "تم استلام الدفعه",
  "استلمنا الدفعه",
  "وصلت الدفعه",
  "تم استلام دفعتك",
  "تم قبول الدفع",
  "الدفع موكد",
  "دفعتك موكده",
  "تم التحقق من الدفع",
];

export function replyConfirmsPayment(reply: string): boolean {
  const normalized = normalizeArabic(reply);
  return PAYMENT_CONFIRMATION_CLAIMS.some((pattern) => normalized.includes(pattern));
}

// ─── وعد تحويل/إرجاع مال للعميل (13 يوليو 2026) ─────────────────────────────────
// تدقيق الإنتاج رصد ردوداً تَعِد العميل بأن النظام «سيحوّل/سيرسل له مبلغاً» أو «يرجع له فلوسه» —
// بلا أي أداة استرداد/تحويل صادر (لا وجود لها أصلاً)، فهو وعدٌ مالي كاذب وناقل احتيال استرداد.
// يُعامل معاملة تأكيد الدفع: استبدال الردّ بالإحالة الآمنة + تصعيد **دائماً** (قرار مالي بشري بحت).
//
// تمييز حاسم لتفادي الإيجابيات الكاذبة: المستهدَف هو المال المتّجه **للعميل** (لك/لحسابك/مبلغك/
// فلوسك) — لا تعليمة الدفع المشروعة المتّجهة **للمتجر** («حوّل المبلغ على حسابنا/على الرقم»)، ولا
// «نرجع لك بعد قليل» (متابعة لا مال). لذا كل نمط يشترط اسم مال صريح + مستفيداً = العميل.
const MONEY_TO_CUSTOMER_CLAIMS = [
  // صيغة الاسم أو ترتيب «المبلغ … لك» (لا يلتقطها نمط الفعل+لك أدناه)
  "تحويل المبلغ لك",
  "تحويل المبلغ لحسابك",
  "تحويل المبلغ الي حسابك",
  "نحول المبلغ لحسابك",
  "المبلغ لحسابك",
  "استرجاع مبلغك",
  "استرداد مبلغك",
  "استرداد المبلغ لك",
  "ارجاع المبلغ لك",
  "اعاده المبلغ لك",
  "ترجيع مبلغك",
  "رد المبلغ لك",
  "رد مبلغك",
];
// فعل تحويل/إرسال/إرجاع + «لك/لكم» + اسم مال (مبلغ/فلوس/ألف) خلال 18 حرفاً — يلتقط صيغ
// المسافات والأرقام («سنحول لك مبلغ 20 ألف») دون التقاط «نرجع لك خلال 3 أيام» (لا اسم مال).
//
// تعميم مورفولوجي (13 يوليو، بعد فحص حيّ): النموذج تهرّب بصيغة الغائب «يرجعوا لك المبلغ» وبالبادئة
// «بحول/راح يرجعون» — التعداد اليدوي لصيغ المتكلم فقط كان يفلتها. الحل مبدئي لا تعدادي: بادئة فعل
// اختيارية (بـ/سـ/نـ/يـ/تـ/ا + «راح» الخليجية) + جذر + لاحقة جمع اختيارية. مرساة «لك + اسم مال»
// تُبقي الإيجابيات الكاذبة منخفضة: «حوّل المبلغ على حسابنا» (لا «لك») و«نرجع لك بعد يومين» (لا مال)
// لا يُطابقان. جذر «حول» آمن هنا لأنه مقيّد بـ«لك»+مال (لا يلتقط «حديث حول المبلغ» — لا «لك»).
const MONEY_TO_CUSTOMER_PATTERN =
  /(?:را?ح\s*)?[بسنيتا]*(?:حول|رسل|بعث|رجع|عيد|رد|سترجع)(?:وا|ون|و)?\s*لك(?:م)?[^.،!؟\n]{0,18}(?:مبلغ|فلوس|الف)/;

export function replyPromisesMoneyToCustomer(reply: string): boolean {
  const normalized = normalizeArabic(reply);
  if (MONEY_TO_CUSTOMER_CLAIMS.some((pattern) => normalized.includes(pattern))) return true;
  return MONEY_TO_CUSTOMER_PATTERN.test(normalized);
}

// يعيد أول أداة ادّعى الردُّ تنفيذَها دون نتيجة ناجحة مطابقة لها — أو null إن كان الردّ صادقاً.
// successfulTools = أسماء الأدوات التي أعادت status="success" في هذا التشغيل تحديداً.
//
// حادثة 10 يوليو 2026 (مباشرة): عميل طلب أوردر، الوكيل ردّ «تم تأكيد طلبك، سيتواصل معك
// الفريق» بلا استدعاء create_order إطلاقاً — صفحة الطلبات بقيت فارغة. لكن نفس العبارة
// حرفياً صادقة تماماً حين يقرأ الوكيل سياق طلب سابق فعلي للعميل (get_order_status يحقنه
// في المطالبة) ويُخبره بحالته — هذا تقرير حالة لا ادّعاء تنفيذ. customerHasOrders يميّز
// الحالتين: صحيح فقط حين للعميل طلبات موجودة فعلاً، فتُعفى ادّعاءات create_order وحدها
// (schedule_followup لا يتأثر — لا سياق موعد مشابه يُحقن اليوم).
export function findUnbackedActionClaim(
  reply: string,
  successfulTools: readonly string[],
  opts?: { customerHasOrders?: boolean },
): ActionClaimTool | null {
  const normalized = normalizeArabic(reply);
  for (const [tool, patterns] of Object.entries(ACTION_CLAIM_PATTERNS) as [ActionClaimTool, string[]][]) {
    if (successfulTools.includes(tool)) continue;
    if (tool === "create_order" && opts?.customerHasOrders === true) continue;
    if (patterns.some((pattern) => normalized.includes(pattern))) return tool;
  }
  return null;
}

// ─── وعد التحقّق «سأتأكد من الفريق» (7 يوليو 2026) ───────────────────────────
// GROUNDING_RULES وSAFETY_SYSTEM_PROMPT يأمران النموذج حرفياً بقول «سأتأكد من الفريق»
// عند غياب المعلومة — لكن لا شيء في المسار الحي كان يُبلغ الفريق فعلاً، فالعبارة
// المأمور بها كانت وعداً مكسوراً دائماً (العميل ينتظر والتاجر أعمى). هذه الشبكة
// تجعل الوعد صادقاً: أي ردّ يعد بالتأكد-والرجوع يُصعَّد للبشر (الردّ نفسه يبقى كما هو).
// المطابقة مقيّدة بعائلة «تأكّد» + (الفريق/الإدارة أو الرجوع للعميل) داخل نفس الجملة —
// «تأكّد من طلبك قبل الدفع» (توجيه للعميل) و«للتأكيد، طلبك يشمل…» لا تطابقان.
const VERIFY_TEAM_PATTERNS = [
  "اتاكد من الفريق",
  "ساتاكد من الفريق",
  "بتاكد من الفريق",
  "نتاكد من الفريق",
  "اتاكد لك من الفريق",
  "بتاكد لك من الفريق",
  "اتاكد من الاداره",
  "ساتاكد من الاداره",
  "اراجع الفريق",
  "نراجع الفريق",
  "اسال الفريق",
  "ساسال الفريق",
];

// «تأكّد … وأرجع/أرد لك» في جملة واحدة (حتى 40 حرفاً بينهما) — يلتقط الصيغ الحرّة
// مثل «أحتاج أتأكد من هذه المعلومة وأرجع لك» دون فتح الباب لكل جملة فيها «أرجع».
const VERIFY_THEN_RETURN = /(?:سا|س|ا|ب|ن)تاكد[^.،!؟\n]{0,40}(?:وارجع|ونرجع|وارد عليك|ونرد عليك|وبرد عليك|وارد لك|ونوافيك)/;

export function replyPromisesVerification(reply: string): boolean {
  const normalized = normalizeArabic(reply);
  if (VERIFY_TEAM_PATTERNS.some((pattern) => normalized.includes(pattern))) return true;
  return VERIFY_THEN_RETURN.test(normalized);
}

// ─── وعد عمل من «الفريق» بصيغة الماضي (13 يوليو 2026) ────────────────────────────
// تدقيق الإنتاج رصد ردوداً تدّعي «طلبت من الفريق إرسال فيديو» ونحوها — لا آلية تُبلغ الفريق فعلاً،
// فالعميل ينتظر ما لن يصل. نفس عقيدة verification_promise (10 يوليو): تنبيه ناعم يجعل الوعد
// صادقاً (إشعار للتاجر ليرسل الوسائط بنفسه) بلا إسكات الوكيل — لا تصعيد كامل يقتل المحادثة.
// صيغ الماضي/الإنجاز فقط («طلبت/بلّغت/الفريق سيرسل لك») لا العرض («أطلب من الفريق؟»).
const TEAM_ACTION_PATTERNS = [
  "طلبت من الفريق",
  "طلبنا من الفريق",
  "بلغت الفريق",
  "ابلغت الفريق",
  "ابلغنا الفريق",
  "خبرت الفريق",
  "نسقت مع الفريق",
  "الفريق راح يرسل لك",
  "الفريق سيرسل لك",
  "الفريق بيرسل لك",
];

export function replyPromisesTeamAction(reply: string): boolean {
  const normalized = normalizeArabic(reply);
  return TEAM_ACTION_PATTERNS.some((pattern) => normalized.includes(pattern));
}

// ─── وعد تصعيد/رفع الأمر للإدارة أو الفريق للمراجعة (أ-2.5، 13 يوليو 2026) ────────
// رُصد حيّاً تحت ضغط استرجاع: الوكيل يَعِد «أرفع الموضوع للإدارة للمراجعة» / «أصعّد الموضوع
// للفريق المختص» — وعدُ تصعيدٍ حقيقي لا يُنفَّذ (يفلت من حارس التحويل الصريح ومن حارس التأكّد
// معاً، فلا إشعار ولا تصعيد = وعد مكسور). المطابقة النصّية الضيّقة فشلت حيّاً (النموذج يولّد صيغاً
// لا تُحصى: «أرفع الموضوع»، «تصعيد الموضوع»، «أصعّد للمختص»...)، فالحل بنيوي: فعل/اسم تصعيد-رفع
// + هدف (إدارة/فريق/مختص/قسم/مسؤول) في الجملة نفسها. المعالجة **ناعمة** عمداً (لا تلمس الردّ،
// أسوأ حالاتها إشعار تاجر زائد) — فالتوسيع منخفض الخطر، ويجعل الوعد صادقاً بإشعار التاجر ليراجع.
// «صعّدت طلبك» الصريحة يلتقطها حارس التحويل الصلب أيضاً (يغلب) — لا تعارض.
const ESCALATION_REVIEW_VERB =
  /رفع|ارفع|سارفع|برفع|رفعت|رفعنا|نرفع|صعد|اصعد|ساصعد|صعدت|صعدنا|تصعيد|بتصعيد|احول|نحول|انقل|ننقل|اوصل/;
const ESCALATION_REVIEW_TARGET =
  /الاداره|للاداره|الفريق|للفريق|المختص|للمختص|المعني|للمعني|القسم|للقسم|المسوول|للمسوول|المشرف|للمشرف/;

export function replyPromisesEscalationReview(reply: string): boolean {
  const sentences = normalizeArabic(reply).split(/[.،!؟\n…]/);
  return sentences.some((sentence) => {
    if (!ESCALATION_REVIEW_TARGET.test(sentence)) return false;
    const verbMatch = sentence.match(ESCALATION_REVIEW_VERB);
    if (!verbMatch || verbMatch.index === undefined) return false;
    // عرضٌ («هل تحب أصعّد الموضوع للإدارة؟») ينتظر موافقة العميل — ليس وعداً. أداة الشرط قبل
    // الفعل تُعفيه (نفس قاعدة precedence المثبتة في replyPromisesHandoff، يُعاد استخدام مساعدها).
    return !hasOfferMarkerBefore(sentence, verbMatch.index);
  });
}

// ─── حارس الروابط المخترعة (10 يوليو 2026، + أ-3 توسعة 13 يوليو) ────────────────
// حوادث حيّة سابقة: النموذج اخترع رقم/رابط تواصل غير موجود في أي سياق مرفق (GROUNDING_RULES
// وصية نصّية فقط ولا تكفي وحدها). هذه الدالة تجعل المنع بنيوياً على مستوى الخادم: أي رابط
// يظهر في ردّ الوكيل يجب أن يكون موجوداً في السياق المسموح به (البرومبت + المعرفة + الكتالوج
// + حالة الطلبات) — وإلا فهو مخترع.
//
// النطاق مقابل الرابط الكامل: للمواقع العادية (موقع المتجر) المطابقة على مستوى **النطاق** فقط
// عمداً — نطاق مذكور في المعرفة بمسار مختلف ليس اختراعاً. لكن **منصّات المحتوى (UGC)** حيث كلُّ
// رابط محتوى فريد (تيك توك/يوتيوب/سناب) المطابقة على النطاق لا تكفي: حادثة الإنتاج (13 يوليو)
// مرّر فيها الوكيل رابطَي تيك توك مخترعَين لأن tiktok.com ورد مرة في سياق آخر — فالنطاق «مسنود»
// شكلاً بينما الفيديو مختلق. لهذه المنصّات نشترط تطابق **المسار الكامل** حرفياً في السياق.
const LINK_CANDIDATE_PATTERN =
  /https?:\/\/[^\s]+|www\.[^\s]+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|ai|one|shop|store|co|me|sa|ye|ae)\b(?:\/[^\s]*)?/gi;

// علامات ترقيم عربية ولاتينية شائعة في نهاية الجملة قد تلتصق بنهاية رابط مقتطَع من نصّ حرّ.
const TRAILING_PUNCTUATION_PATTERN = /[.,;:!؟?»«)('"]+$/;

// منصّات محتوى المستخدم — كل رابط فيها محتوى فريد، فتطابق النطاق وحده لا يُثبت أن هذا المحتوى
// موجود فعلاً في السياق (على عكس موقع المتجر). لهذه نشترط المسار الكامل.
const UGC_CONTENT_DOMAINS = ["tiktok.com", "youtube.com", "youtu.be", "snapchat.com", "pinterest.com"];

// يحوّل مرشّح رابط خام إلى نطاقه المطبَّع: أحرف صغيرة، بلا بروتوكول ولا www. بادئة،
// بلا علامات ترقيم لاصقة، وقبل أول / أو ? (أي بلا مسار أو استعلام).
function extractDomain(candidate: string): string {
  let value = candidate.toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.replace(TRAILING_PUNCTUATION_PATTERN, "");
  const cutIndex = value.search(/[/?]/);
  return cutIndex >= 0 ? value.slice(0, cutIndex) : value;
}

// نفس التطبيع لكن مع الإبقاء على المسار الكامل (للمقارنة الحرفية في منصّات UGC).
function normalizeFullUrl(candidate: string): string {
  return candidate
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(TRAILING_PUNCTUATION_PATTERN, "");
}

function isUgcDomain(domain: string): boolean {
  return UGC_CONTENT_DOMAINS.some((ugc) => domain === ugc || domain.endsWith(`.${ugc}`));
}

// يعيد أول رابط غير مُصرَّح به في الردّ (غير موجود في allowedContext)، أو null إن كانت كل
// الروابط مسنودة. للمواقع العادية: يكفي وجود النطاق. لمنصّات UGC ذات المسار: يجب وجود الرابط
// كاملاً بمساره (نطاق مجرّد بلا مسار لمنصّة UGC = مقبول بالنطاق — لا محتوى مخترع بعد).
export function findUnauthorizedLink(reply: string, allowedContext: string): string | null {
  const candidates = reply.match(LINK_CANDIDATE_PATTERN);
  if (!candidates) return null;
  const normalizedContext = allowedContext.toLowerCase();
  for (const candidate of candidates) {
    const domain = extractDomain(candidate);
    if (!domain) continue;
    if (isUgcDomain(domain)) {
      const fullUrl = normalizeFullUrl(candidate);
      // رابط بمسار فعلي (أطول من النطاق) → يجب تطابقه الكامل؛ نطاق UGC مجرّد → يكفي النطاق.
      const hasPath = fullUrl.length > domain.length + 1;
      if (hasPath) {
        if (!normalizedContext.includes(fullUrl)) return fullUrl;
      } else if (!normalizedContext.includes(domain)) {
        return domain;
      }
    } else if (!normalizedContext.includes(domain)) {
      return domain;
    }
  }
  return null;
}

// حارس ساعات الدوام المخترعة/المقلوبة (11 يوليو 2026 — جولة «المستخدم الحي»): النموذج قلب
// «من 10 صباحاً حتى 8 مساءً» إلى «من 8 صباحاً حتى 10 مساءً» رغم قاعدة النقل الحرفي في البرومبت،
// واخترع دواماً كاملاً بعد حذف مصدره — عميل يصل لمحل مغلق = ضرر حقيقي. نفس فلسفة حارس الروابط:
// كل زوج «ساعة + فترة» (صباحاً/مساءً/ظهراً/عصراً/فجراً) في الردّ يجب أن يوجد حرفياً في سياق
// مرفق (البرومبت/المحادثة/المعرفة/الكتالوج/الطلبات) — وإلا فهو اختراع يُستبدل الردّ ويُصعَّد.
// السياق يشمل نص المحادثة عمداً: ترديد ساعة ذكرها العميل نفسه («أجي الساعة 7 مساءً؟») مشروع.
const HOUR_PERIOD_PATTERN = /(\d{1,2})\s*(?:ال)?(صباح|مساء|ظهر|عصر|فجر)/g;
const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function normalizeForHours(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_INDIC_DIGITS.indexOf(digit)))
    .replace(/\s+/g, " ");
}

export function findUngroundedWorkHours(reply: string, allowedContext: string): string | null {
  const normalizedReply = normalizeForHours(reply);
  const normalizedContext = normalizeForHours(allowedContext);
  for (const match of normalizedReply.matchAll(HOUR_PERIOD_PATTERN)) {
    const hour = match[1];
    const period = match[2];
    const grounded = new RegExp(`${hour}\\s*(?:ال)?${period}`).test(normalizedContext);
    if (!grounded) return `${hour} ${period}`;
  }
  return null;
}

// ─── حارس الأسعار المخترعة/المسمَّمة ذاتياً (13 يوليو 2026) ──────────────────────
// أخطر عطل رصده تدقيق الإنتاج: وكيل متجر بلا منتج «مروحة درون» في المخزون اخترع سعرها
// 12000، ثم — لأن ردوده السابقة تُحقن في مطالبة الدور التالي ضمن سجل المحادثة — كرّر الرقم
// المختلق، ثم حوّره في نفس اليوم إلى 14000 و10000 بلا أي مصدر (حلقة تسميم ذاتي). GROUNDING_RULES
// تمنع اختراع الأسعار نصّياً، لكن القاعدة النصّية وحدها ثبت اختراقها مراراً (حادثة 299 ريال).
// هذا هو المنع البنيوي: أي «سعر» في الردّ (رقم مقترن بعملة أو بكلمة «ألف») يجب أن توجد قيمته
// العددية في السياق الموثوق حصراً — الكتالوج/المعرفة/حالة الطلبات/تعليمات التاجر/رسائل العميل
// الواردة — وإلا فهو مخترع يُستبدل الردّ ويُصعَّد.
//
// قرار التصميم الجوهري (كسر الحلقة): المستدعي يبني allowedContext **بدون ردود الوكيل الصادرة**،
// فحتى لو كان الرقم المسمَّم في سجل المحادثة، لا يُعتبر مصدراً — تكراره في أي دور لاحق يُحجب أيضاً.
// ومنشورات ميتا والأجوبة المتعلَّمة مستبعدة أيضاً بقرار مقفل: «المخزون هو سلطة السعر الوحيدة».
//
// عدم التماثل المقصود بين الجانبين (يقلّل الإيجابيات الكاذبة لأدنى حد):
//  • في الردّ: تُتحدّى فقط الأرقامُ المقترنة بعملة/«ألف» (لا النِّسب «20%»، ولا المدد «3 أيام»،
//    ولا أرقام الطلبات) — فالأرقام غير السعرية لا تُحجب أبداً.
//  • في السياق: تُقبل **كل** الأرقام أساساً للتأريض (لا المقترنة بعملة فقط) — لأن عملة الكتالوج
//    قد تكون فارغة لبعض المتاجر، فاشتراط العملة كان سيحجب أسعارها الحقيقية كلها. التساهل هنا في
//    اتجاه آمن (يمنع الحجب الخاطئ لا العكس).
// حدّ معروف مؤجَّل: حساب الحزم («قطعتان بـ1000» = 2×500) قد يُحجب إن لم يرد 1000 في السياق —
// مقبول مؤقتاً (المخرج تحويلٌ بشري صادق لا ضرر)، ويصير نمطاً لاحقاً إن تكرّر (عقيدة المنصة).
const PRICE_CURRENCY_PATTERN =
  /ريالا?|ر\.?\s?[يسق]|درهم|دولار|دينار|جنيه|﷼|\$|sar|yer|usd|aed|qar|kwd|egp|omr|bhd/;
const PRICE_NUMBER_PATTERN = /\d{1,3}(?:[,،٬]\d{3})+|\d+(?:\.\d+)?/g;
const THOUSAND_WORD_AFTER = /^\s*(?:الف|الاف)(?![ا-ي])/; // «ألف/آلاف» بعد التطبيع، وليس بداية كلمة أطول («الفنان»)

function priceDigitsToWestern(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/٫/g, ".");
}

// يستخرج القيم العددية «السعرية» من نصّ. currencyAnchoredOnly=true للردّ (يتحدّى الأرقام
// المقترنة بعملة/«ألف» فقط)، false للسياق (كل رقم يصلح للتأريض). «ألف/آلاف» تُوسَّع ×1000.
function extractPriceValues(rawText: string, currencyAnchoredOnly: boolean): number[] {
  const text = normalizeArabic(priceDigitsToWestern(rawText));
  const values: number[] = [];
  const regex = new RegExp(PRICE_NUMBER_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const base = Number.parseFloat(raw.replace(/[,،٬]/g, ""));
    if (!Number.isFinite(base)) continue;
    const after = text.slice(match.index + raw.length, match.index + raw.length + 8);
    const before = text.slice(Math.max(0, match.index - 8), match.index);
    const isThousand = THOUSAND_WORD_AFTER.test(after);
    const value = isThousand ? base * 1000 : base;
    if (currencyAnchoredOnly) {
      const anchored = isThousand || PRICE_CURRENCY_PATTERN.test(after) || PRICE_CURRENCY_PATTERN.test(before);
      if (!anchored) continue;
    }
    values.push(value);
  }
  return values;
}

// يعيد أول سعر في الردّ قيمتُه غير موجودة في السياق الموثوق (مخترع)، أو null إن كان كل سعر مسنوداً.
// دالة نقية بلا اعتماديات — كسابقاتها. المستدعي مسؤول عن بناء trustedContext بلا ردود الوكيل الصادرة.
function extractFixedPriceAdditions(pricingRules: string): number[] {
  const normalized = normalizeArabic(priceDigitsToWestern(pricingRules));
  const additions = new Set<number>();
  const pattern = /(?:اضافه|اضف|زياده(?:\s+قدرها)?)\s*\(?\s*(\d{1,3}(?:[,،ج]\d{3})+|\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    const value = Number.parseFloat(match[1]!.replace(/[,،ج]/g, ""));
    if (Number.isFinite(value) && value > 0) additions.add(value);
  }
  return [...additions];
}

export function findUngroundedPrice(
  reply: string,
  trustedContext: string,
  pricingRules = "",
  productCatalogContext = "",
  productSubjectContext = reply,
): string | null {
  const candidates = extractPriceValues(reply, true);
  if (candidates.length === 0) return null;
  const grounded = new Set(extractPriceValues(trustedContext, false));
  // بعض المتاجر تستورد سعر الجملة وتضع في تعليمات الوكيل زيادة ثابتة على سعر المخزون.
  // لا نعتبر كل أرقام التعليمات أسعاراً موثوقة (الأمثلة قديمة أو تخص منتجاً آخر)؛ نأخذ فقط
  // مبالغ الإضافة المصرّح بها صراحةً، ونسمح بالناتج الحسابي من سعر مخزون حقيقي.
  const additions = extractFixedPriceAdditions(pricingRules);
  if (additions.length > 0) {
    // لا نكوّن السعر النهائي من أي رقم عابر في المعرفة/الكمية أو من منتج آخر ضمن حشو الكتالوج.
    // يجب أن يكون سعر الأساس من سطر منتج حقيقي، وأن يظهر اسم ذلك المنتج في سؤال العميل أو الرد.
    const subjectNorm = normalizeArabic(productSubjectContext);
    const relevantCatalogPrices = parseCatalogPricePoints(productCatalogContext)
      .filter((point) => distinctiveWords(point.name).some((word) => subjectNorm.includes(word)))
      .map((point) => point.price);
    for (const basePrice of relevantCatalogPrices) {
      for (const addition of additions) grounded.add(basePrice + addition);
    }
  }
  for (const value of candidates) {
    if (!grounded.has(value)) return String(value);
  }
  return null;
}

// ─── حارس تضارب المنتج (13 يوليو 2026 — حادثة MP300) ──────────────────────────
// أخطر من الاختراع الصريح: findUngroundedPrice أعلاه يتحقق فقط أن الرقم موجود في مكان ما
// بالسياق — فسعر حقيقي 100% لمنتج (فساتين يد لبانة: 2250) يمرّ بلا اعتراض حتى لو نُسب زوراً
// لمنتج آخر لا وجود له في الكتالوج المحقون أصلاً (العميل كتب «موديل 300»، والمعرفة ذكرت
// «MP300» كمثال تنسيق بحت لا بيانات منتج، فدمج النموذج تسمية العميل المخترعة بأرقام فستان
// حقيقي وقدّمها كأنها بيانات ذلك «الموديل»). القاعدة هنا أضيق: أي سعر حقيقي من الكتالوج يظهر
// في الردّ يجب أن يظهر معه اسم منتجه الحقيقي هو نفسه في نفس الردّ — وإلا فهو رقم صحيح بعنوان
// خاطئ، بصرف النظر عن أي تسمية أخرى (حقيقية أو مخترعة) نُسب إليها.
// حدّ معروف مقبول (يوافق فلسفة الحارس الناعم نفسها): ردّ قصير يكرّر سعراً بلا إعادة اسم المنتج
// (متابعة طبيعية لسؤال «بكم؟» السابق) قد يُنبَّه زوراً — مقبول لأن الحارس ناعم (لا يُسكِت الوكيل،
// فقط يستبدل هذا الردّ بعينه)، مقابل خطر أكبر بكثير: تسريب بيانات منتج حقيقي (سعر/توفر) تحت
// اسم لا يخص التاجر إطلاقاً.
function parseCatalogPricePoints(catalogContext: string): Array<{ name: string; price: number }> {
  const points: Array<{ name: string; price: number }> = [];
  // يطابق سطر formatProductCatalog حرفياً: "- الاسم: السعر العملة...".
  const lineRegex = /^- (.+?): (\d+(?:\.\d+)?) /gm;
  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(catalogContext)) !== null) {
    const price = Number.parseFloat(match[2]!);
    if (Number.isFinite(price)) points.push({ name: match[1]!.trim(), price });
  }
  return points;
}

// كلمات المنتج المميّزة: كلمات الاسم بعد التطبيع بطول ≥3 محارف. اشتراط ظهور الاسم كاملاً حرفياً
// أعطى false-positive حياً (اختبار محلي 16 يوليو): الوكيل يختصر «طقم صلاة 5 قطع» إلى «طقم الصلاة»
// فيُستبدل ردُّ سعرٍ صحيح بـ«سأتأكد من الفريق» — يغذّي شكوى «لا يقرأ المخزون». نكتفي بظهور كلمة
// مميّزة واحدة على الأقل من اسم المنتج (يكسر النسب الخاطئ في حادثة MP300 حيث لا تظهر «فساتين»
// ولا «لبانة» إطلاقاً، ويسمح بالاختصار الطبيعي حيث تظهر «طقم» أو «صلاة»).
function distinctiveWords(name: string): string[] {
  return normalizeArabic(name).split(/\s+/).filter((w) => w.length >= 3);
}

// يعيد "الاسم:السعر" لأول منتج ظهر سعرُه الحقيقي في الردّ بلا أي كلمة مميّزة من اسمه، أو null.
// يحتاج كتالوجاً بمنتجَين فأكثر (بمنتج واحد لا احتمال نسب خاطئ). المنتج بلا كلمة مميّزة (اسم
// رقمي/قصير جداً) يُتخطّى — لا يمكن التحقق منه بأمان بلا false-positive.
export function findMisattributedProductPrice(reply: string, catalogContext: string): string | null {
  const points = parseCatalogPricePoints(catalogContext);
  if (points.length < 2) return null;
  const replyPrices = new Set(extractPriceValues(reply, true));
  if (replyPrices.size === 0) return null;
  const replyNorm = normalizeArabic(reply);
  for (const point of points) {
    if (!replyPrices.has(point.price)) continue;
    const words = distinctiveWords(point.name);
    if (words.length === 0) continue;
    if (!words.some((w) => replyNorm.includes(w))) return `${point.name}:${point.price}`;
  }
  return null;
}
