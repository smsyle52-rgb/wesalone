import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const AR_LOCALE = "ar-YE-u-nu-latn";

export function formatNumber(amount: number | string) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return n.toLocaleString(AR_LOCALE);
}

export function formatCurrency(amount: number | string, currency = "YER") {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `${formatNumber(n)} ${currency === "YER" ? "ر.ي" : currency}`;
}

export function formatDate(date: string | Date | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString(AR_LOCALE, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(date: string | Date | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleString(AR_LOCALE, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(date: string | Date | null | undefined) {
  if (!date) return "—";
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  const days = Math.floor(hrs / 24);
  return `منذ ${days} يوم`;
}

export const statusLabels: Record<string, string> = {
  new: "جديد", open: "مفتوح", pending: "قيد الانتظار", snoozed: "مؤجل",
  bot: "بوت", resolved: "تم الحل", closed: "مغلق",
  in_progress: "قيد التنفيذ", waiting_on_customer: "بانتظار العميل",
  todo: "للإنجاز", done: "منجز", cancelled: "ملغى",
  completed: "مكتمل", draft: "مسودة", submitted: "مُرسل", approved: "معتمد", active: "نشط", paused: "متوقف", disabled: "معطل",
  scheduled: "مجدول", sending: "جارٍ الإرسال", failed: "فشل",
  confirmed: "مؤكد", processing: "قيد المعالجة",
  ready: "جاهز", shipped: "مشحون", delivered: "مسلّم", returned: "مُرتجع", refunded: "مسترد", rejected: "مرفوض",
  qualified: "مؤهل", proposal: "عرض", negotiation: "تفاوض", won: "ربح", lost: "خسارة",
  unpaid: "غير مدفوع", partial: "جزئي", paid: "مدفوع",
  overdue: "متأخر", skipped: "تم التخطي",
};

export const followupTypeLabels: Record<string, string> = {
  manual: "يدوي", sales: "مبيعات", support: "دعم", collection: "تحصيل", reminder: "تذكير",
};

export const stageLabels: Record<string, string> = {
  new: "جديدة", qualified: "مؤهلة", proposal: "عرض سعر",
  negotiation: "تفاوض", won: "ربح", lost: "خسارة",
};

export const priorityLabels: Record<string, string> = {
  urgent: "عاجل", high: "عالي", normal: "عادي", medium: "متوسط", low: "منخفض",
};

export const methodLabels: Record<string, string> = {
  cash: "نقداً", kuraimi: "كريمي", jawali: "جوالي", bank_transfer: "تحويل بنكي", other: "أخرى",
};

export const orderChannelLabels: Record<string, string> = {
  manual: "يدوي", whatsapp: "واتساب", phone: "هاتف", website: "موقع", walk_in: "حضوري",
};

export const channelLabels: Record<string, string> = {
  manual: "يدوي",
  whatsapp: "واتساب",
  whatsapp_manual: "واتساب يدوي",
  whatsapp_api: "واتساب مباشر (لاحقاً)",
    website_widget: "موقعك الإلكتروني (لاحقاً)",
  telegram: "تيليغرام",
  instagram: "إنستغرام",
  messenger: "ماسنجر",
  voice: "صوتي",
  sms: "رسائل",
  email: "بريد",
  webchat: "دردشة",
  phone: "هاتف",
};

export const channelStatusLabels: Record<string, string> = {
  active: "نشط",
  pending_meta_review: "قيد مراجعة Meta",
  disabled: "معطّل",
  coming_soon: "قريباً",
};

export const CHANNEL_CATALOG = [
  { type: "whatsapp_manual", label: "واتساب يدوي", status: "active", description: "فتح واتساب يدوياً عند الحاجة بدون إرسال تلقائي من النظام" },
  { type: "website_widget", label: "موقعك الإلكتروني (لاحقاً)", status: "coming_soon", description: "سيتم تفعيل استقبال رسائل الموقع لاحقاً" },
  { type: "whatsapp_api", label: "واتساب مباشر (لاحقاً)", status: "pending_meta_review", description: "سيتم تفعيل الربط المباشر لاحقاً" },
  { type: "telegram", label: "تيليغرام", status: "coming_soon", description: "سيتم إضافته قريباً" },
  { type: "instagram", label: "إنستغرام", status: "coming_soon", description: "سيتم إضافته قريباً" },
  { type: "messenger", label: "ماسنجر", status: "coming_soon", description: "سيتم إضافته قريباً" },
  { type: "voice", label: "صوتي", status: "coming_soon", description: "سيتم إضافته قريباً" },
] as const;
