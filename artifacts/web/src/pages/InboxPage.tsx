import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link, useSearch } from "wouter";
import { PageHeader } from "@/components/ui/PageHeader";
import { NotificationCenter } from "@/components/NotificationCenter";
import { Modal } from "@/components/ui/Modal";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { formatDateTime, timeAgo, channelLabels, statusLabels, priorityLabels, channelStatusLabels, CHANNEL_CATALOG } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { openInboxStream, type InboxStreamStatus } from "@/lib/realtime";
import { FaWhatsapp, FaInstagram, FaFacebookMessenger } from "react-icons/fa6";
import { Search, MoreHorizontal, ArrowRight, User, FileText, ArrowLeftRight, StickyNote, Sparkles, Plus, Smile, Paperclip, Mic, Send, ShieldCheck, AlertTriangle, Clock, X, SlidersHorizontal, Pin } from "lucide-react";

const BASE = `${import.meta.env.BASE_URL}api`;

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const json = JSON.parse(text);
      if (typeof json.error === "string" && json.error.trim()) message = json.error;
    } catch {
      message = text;
    }
    throw new Error(message);
  }
  return res.json();
}

type MessageAttachment = {
  type?: string;
  url?: string;
  media_id?: string;
  caption?: string | null;
  filename?: string;
};

function asMessageAttachments(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MessageAttachment => !!item && typeof item === "object");
}

function attachmentMediaSrc(conversationId: string, messageId: string, index: number): string {
  return `${BASE}/conversations/${conversationId}/messages/${messageId}/attachments/${index}`;
}

function MessageAttachments({ conversationId, messageId, attachments }: { conversationId: string; messageId: string; attachments: unknown }) {
  const items = asMessageAttachments(attachments);
  if (items.length === 0) return null;

  return (
    <div className="space-y-2 mb-2">
      {items.map((attachment, index) => {
        const type = attachment.type ?? "media";
        const src = attachment.url ?? attachmentMediaSrc(conversationId, messageId, index);
        if (type === "image" || type === "sticker") {
          return (
            <img
              key={`${messageId}-${index}`}
              src={src}
              alt={attachment.caption ?? "صورة"}
              className="max-w-full max-h-56 rounded-lg border border-border/40 object-contain bg-background/40"
              loading="lazy"
            />
          );
        }
        if (type === "audio" || type === "voice") {
          return <audio key={`${messageId}-${index}`} controls src={src} className="w-full max-w-sm" />;
        }
        if (type === "video") {
          return <video key={`${messageId}-${index}`} controls src={src} className="max-w-full max-h-56 rounded-lg" />;
        }
        return (
          <a
            key={`${messageId}-${index}`}
            href={src}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs underline opacity-90"
          >
            {type === "document" ? `📎 ${attachment.filename ?? "مستند"}` : "📎 وسائط"}
          </a>
        );
      })}
    </div>
  );
}

const CONV_STATUSES = [
  { value: "", label: "الكل" },
  { value: "new", label: "جديد" },
  { value: "open", label: "مفتوح" },
  { value: "pending", label: "قيد الانتظار" },
  { value: "snoozed", label: "مؤجل" },
  { value: "resolved", label: "تم الحل" },
  { value: "closed", label: "مغلق" },
];

const SAVED_VIEWS = [
  { value: "", label: "كل المحادثات" },
  { value: "mine", label: "الموكلة لي" },
  { value: "unassigned", label: "بدون مسؤول" },
  { value: "open_tickets", label: "تذاكر مفتوحة" },
  { value: "closed", label: "مغلقة" },
  { value: "sla_breached", label: "مع SLA متجاوز" },
];

const STATUS_ACTIONS: Record<string, { label: string; next: string }[]> = {
  new: [{ label: "فتح", next: "open" }],
  open: [{ label: "إيقاف مؤقت", next: "pending" }, { label: "حل", next: "resolved" }],
  pending: [{ label: "إعادة فتح", next: "open" }],
  snoozed: [{ label: "إعادة فتح", next: "open" }],
  resolved: [{ label: "إعادة فتح", next: "open" }, { label: "إغلاق نهائي", next: "closed" }],
  closed: [{ label: "إعادة فتح", next: "open" }],
  bot: [{ label: "تولي المحادثة", next: "open" }],
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "text-red-600 bg-red-50 border-red-200",
  high: "text-orange-600 bg-orange-50 border-orange-200",
  normal: "text-gray-600 bg-gray-50 border-gray-200",
  low: "text-blue-600 bg-blue-50 border-blue-200",
};

const PRIORITY_DOT_COLORS: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-gray-400",
  low: "bg-blue-500",
};

const COMPACT_STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  open: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  snoozed: "bg-purple-100 text-purple-700",
  resolved: "bg-gray-100 text-gray-600",
  closed: "bg-gray-200 text-gray-500",
  bot: "bg-indigo-100 text-indigo-700",
};

const CHANNEL_ICONS: Record<string, string> = {
  whatsapp_manual: "📱",
  whatsapp: "📱",
  whatsapp_api: "📱",
  website_widget: "💬",
  telegram: "✈️",
  instagram: "📷",
  messenger: "💬",
  voice: "📞",
  manual: "✍️",
  email: "📧",
  sms: "📩",
};

const AI_CATEGORY_LABELS: Record<string, string> = {
  customer_service: "خدمة عملاء",
  remote_work: "عمل عن بعد",
  job_inquiry: "استفسار وظيفي",
  job_application: "تقديم على وظيفة",
  e_commerce: "تجارة إلكترونية",
  "e-commerce": "تجارة إلكترونية",
  sales: "مبيعات",
  support: "دعم",
  complaint: "شكوى",
  billing: "فوترة",
  payment: "مدفوعات",
  order: "طلب",
  general: "عام",
};

const AI_SENTIMENT_LABELS: Record<string, string> = {
  positive: "إيجابي",
  negative: "سلبي",
  neutral: "محايد",
  mixed: "مختلط",
};

const AI_SUGGESTION_LABELS: Record<string, string> = {
  create_ticket: "إنشاء تذكرة",
  create_task: "إنشاء مهمة",
  create_followup: "إنشاء متابعة",
  create_opportunity: "إنشاء فرصة",
  create_order: "إنشاء طلب",
  assign_agent: "تعيين مسؤول",
  request_payment: "طلب دفع",
  ask_for_details: "طلب تفاصيل إضافية",
  escalate: "تصعيد",
};

function startCaseArabicLabel(value: string): string {
  return value.split(/[_-]+/).filter(Boolean).join(" ").trim();
}

function formatAiCategory(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "غير مصنف";
  return AI_CATEGORY_LABELS[value] ?? startCaseArabicLabel(value);
}

function formatAiPriority(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "غير محددة";
  return priorityLabels[value] ?? startCaseArabicLabel(value);
}

function formatAiSentiment(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "غير واضح";
  return AI_SENTIMENT_LABELS[value] ?? startCaseArabicLabel(value);
}

function formatAiTag(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  return AI_CATEGORY_LABELS[value] ?? AI_SENTIMENT_LABELS[value] ?? priorityLabels[value] ?? startCaseArabicLabel(value);
}

function formatAiSuggestionLabel(suggestion: any): string {
  const raw = suggestion?.label ?? suggestion?.action_type;
  if (typeof raw !== "string" || !raw.trim()) return "اقتراح";
  return AI_SUGGESTION_LABELS[raw] ?? startCaseArabicLabel(raw);
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cn("text-xs px-1.5 py-0.5 rounded border font-medium", PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.normal)}>
      {priorityLabels[priority] ?? priority}
    </span>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
      {CHANNEL_ICONS[channel] ?? "💬"} {channelLabels[channel] ?? channel}
    </span>
  );
}

function CompactChannelBadge({ channel }: { channel: string }) {
  return (
    <span
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs"
      title={channelLabels[channel] ?? channel}
      aria-label={channelLabels[channel] ?? channel}
    >
      {CHANNEL_ICONS[channel] ?? "💬"}
    </span>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const label = priorityLabels[priority] ?? priority;
  return (
    <span
      className={cn("inline-flex h-2.5 w-2.5 shrink-0 rounded-full", PRIORITY_DOT_COLORS[priority] ?? PRIORITY_DOT_COLORS.normal)}
      title={label}
      aria-label={label}
    />
  );
}

function CompactStatusChip({ status }: { status: string }) {
  const normalizedStatus = status;
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.68rem] font-bold", COMPACT_STATUS_COLORS[normalizedStatus] ?? "bg-gray-100 text-gray-600")}>
      {statusLabels[normalizedStatus] ?? normalizedStatus}
    </span>
  );
}

function normalizeConversationStatus(status: unknown, lifecycleState?: unknown): string {
  if (typeof lifecycleState === "string" && lifecycleState.trim()) return lifecycleState;
  if (typeof status === "string" && status.trim()) return status;
  return "new";
}

function normalizeConversationLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function formatDisplayId(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? `#${value}` : null;
}

const PRESENCE_DOT_COLORS: Record<"online" | "away" | "offline", string> = {
  online: "bg-emerald-500",
  away: "bg-amber-500",
  offline: "bg-slate-300",
};

function resolvePresence(member: any): { tone: "online" | "away" | "offline"; label: string } {
  // Note (W5-T1 partial): availability defaults to 'offline' in the DB and there is
  // no UI yet to set it meaningfully, so "offline" is deliberately NOT special-cased
  // here — doing so would make every member appear offline regardless of recent
  // activity. Only explicit non-default signals (online/away) short-circuit the
  // lastSeenAt heuristic below; once a real toggle UI exists this can be revisited.
  const availability = typeof member?.availability === "string" ? member.availability.toLowerCase() : null;
  if (availability === "online") return { tone: "online", label: "متصل" };
  if (availability === "busy" || availability === "away") return { tone: "away", label: "بعيد" };

  const rawLastSeenAt = member?.lastSeenAt;
  const lastSeenAt = typeof rawLastSeenAt === "string" || rawLastSeenAt instanceof Date
    ? new Date(rawLastSeenAt)
    : null;

  if (lastSeenAt && !Number.isNaN(lastSeenAt.getTime())) {
    const diffMinutes = Math.max(0, (Date.now() - lastSeenAt.getTime()) / 60000);
    if (diffMinutes <= 10) return { tone: "online", label: "نشط الآن" };
    if (diffMinutes <= 180) return { tone: "away", label: "بعيد الآن" };
  }

  return { tone: "offline", label: "غير متصل" };
}

function DisplayIdBadge({ value }: { value: unknown }) {
  const displayId = formatDisplayId(value);
  if (!displayId) return null;

  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted px-1.5 py-0.5 text-[0.68rem] font-bold text-muted-foreground">
      {displayId}
    </span>
  );
}

function LabelsRow({ labels, compact = false }: { labels: string[]; compact?: boolean }) {
  if (labels.length === 0) return null;
  const visible = labels.slice(0, compact ? 2 : 3);
  const overflow = labels.length - visible.length;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {visible.map((label) => (
        <span
          key={label}
          className={cn(
            "inline-flex max-w-full items-center truncate rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-medium text-sky-700",
            compact ? "text-[0.62rem]" : "text-xs",
          )}
          title={label}
        >
          {label}
        </span>
      ))}
      {overflow > 0 && (
        <span className={cn("inline-flex rounded-full border border-border bg-muted px-2 py-0.5 font-medium text-muted-foreground", compact ? "text-[0.62rem]" : "text-xs")}>
          +{overflow}
        </span>
      )}
    </div>
  );
}

function AssignmentChip({ member, membershipId, compact = false }: { member?: any; membershipId?: string | null; compact?: boolean }) {
  if (!membershipId) {
    return (
      <span className={cn("inline-flex shrink-0 items-center rounded-full border border-dashed border-border bg-background px-2 py-0.5 font-medium text-muted-foreground", compact ? "text-[0.62rem]" : "text-xs")}>
        بدون مسؤول
      </span>
    );
  }

  const presence = resolvePresence(member);
  const name = typeof member?.name === "string" && member.name.trim() ? member.name.trim() : "مسؤول";
  const text = compact ? name : `${name} · ${presence.label}`;

  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-medium text-foreground/80", compact ? "text-[0.62rem]" : "text-xs")}
      title={`المسؤول: ${name}`}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", PRESENCE_DOT_COLORS[presence.tone])} />
      <span className="truncate">{text}</span>
    </span>
  );
}

function ChannelIconBadge({ channel, size = 18 }: { channel: string; size?: number }) {
  const s = size;
  if (channel.startsWith("whatsapp")) return <FaWhatsapp size={s} className="text-[#128C4A]" />;
  if (channel === "instagram") return <FaInstagram size={s} className="text-pink-600" />;
  if (channel === "messenger") return <FaFacebookMessenger size={s} className="text-blue-600" />;
  return <span style={{ fontSize: s * 0.8 }}>💬</span>;
}

function ContactInitials({ name, size = 40 }: { name?: string | null; size?: number }) {
  const initials = (name ?? "؟").trim().slice(0, 2);
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary"
    >
      {initials}
    </span>
  );
}

function isProviderLive(providerStatus: any): boolean {
  return (providerStatus?.provider === "vertex" || providerStatus?.provider === "gemini") && !providerStatus?.fallbackMode;
}

function providerLiveLabel(providerStatus: any): string {
  // محمية #10: لا يُكشف اسم الموديل (Vertex/Gemini) ولا عبارة «وضع تجريبي» في الواجهة.
  if (!providerStatus?.fallbackMode && (providerStatus?.provider === "vertex" || providerStatus?.provider === "gemini")) {
    return "المساعد الذكي مفعّل";
  }
  return "المساعد غير متاح مؤقتاً";
}

// تبسيط حالة المحادثة لعرض الجوال إلى حالة واحدة فقط من ثلاث (بدل تركيب
// status/agentStatus/needsHuman/priority في عدة شارات متزامنة). مغلقة تعلو أي
// شيء آخر؛ ثم الوكيل نشط فعلاً؛ وإلا فهي تحتاج تدخلاً بشرياً (لا وكيل مفعّل،
// موقوف، أو مُصعَّد) — هذا يغطي كل الحالات الحقيقية بلا استثناء.
type MobileConvStatus = "closed" | "ai_active" | "needs_human";
function mobileConvStatus(c: { status?: string; agentStatus?: string | null; needsHuman?: boolean }): MobileConvStatus {
  if (c.status === "closed" || c.status === "resolved") return "closed";
  if (c.agentStatus === "active") return "ai_active";
  return "needs_human";
}
const MOBILE_STATUS_BADGE: Record<MobileConvStatus, { label: string; className: string }> = {
  ai_active: { label: "الذكاء يرد", className: "bg-green-50 text-green-700 border-green-200" },
  needs_human: { label: "تحتاج تدخل", className: "bg-amber-50 text-amber-700 border-amber-200" },
  closed: { label: "مغلقة", className: "bg-gray-100 text-gray-500 border-gray-200" },
};

export default function InboxPage() {
  const { hasPermission, user } = useAuth();
  const qc = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<EventSource | null>(null);
  const selectedConvIdRef = useRef<string | null>(null);

  const canRead = hasPermission("conversations:read");
  const canCreate = hasPermission("conversations:create");
  const canReply = hasPermission("conversations:reply");
  const canAssign = hasPermission("conversations:assign");
  const canResolve = hasPermission("conversations:resolve");
  const canUpdate = hasPermission("conversations:update");
  const canCreateTicket = hasPermission("tickets:create");
  const canCreateTask = hasPermission("tasks:create");
  const canCreateFollowup = hasPermission("followups:create");
  const canCreateOpportunity = hasPermission("opportunities:create");
  const canCreateOrder = hasPermission("orders:create");
  const canUseAI = hasPermission("ai:use");
  // PD-11 fix: conversations:manage غير معرّفة في النظام (لا يملكها أحد) → الزر كان لا يظهر أبداً.
  // resolve صلاحية موجودة يملكها كل موظف يدير الوارد (owner/manager/agent).
  const canManageConversationAgent = hasPermission("conversations:resolve");
  const canReadChannels = hasPermission("channels:read");
  const canReadQuickReplies = hasPermission("quick_replies:read");
  const canWriteSavedViews = hasPermission("saved_views:write");
  const canReadSavedViews = hasPermission("saved_views:read");
  const canReadUsage = hasPermission("settings:read");

  const [statusFilter, setStatusFilter] = useState("");
  const [viewFilter, setViewFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  // 6 يوليو 2026: الوارد كان يجلب أول 50 محادثة فقط بلا أي ترقيم — أي محادثة تتجاوز الأحدث
  // 50 (شكوى المالك: "الوارد ناقص لا يحمل جميع المحادثات") غير قابلة للوصول إطلاقاً رغم أن
  // الخادم يُرجع total/page أصلاً. صفحة 1 عند أي تغيير فلتر لتفادي عرض صفحة فارغة/خاطئة.
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [viewFilter, statusFilter, searchQuery, channelFilter, assigneeFilter]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const notificationDeepLink = useSearch();
  useEffect(() => {
    const targetId = new URLSearchParams(notificationDeepLink).get("conversation");
    if (targetId) {
      setSelectedConvId(targetId);
      setDetailTab("conversation");
      setMobileView("detail");
    }
  }, [notificationDeepLink]);
  const [messageText, setMessageText] = useState("");
  const mobileComposerRef = useRef<HTMLTextAreaElement>(null);
  const desktopComposerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    for (const ref of [mobileComposerRef, desktopComposerRef]) {
      const el = ref.current;
      if (!el) continue;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, [messageText]);
  const [mediaUrl, setMediaUrl] = useState("");
  const [messageMode, setMessageMode] = useState<"reply" | "note">("reply");
  const [detailTab, setDetailTab] = useState<"conversation" | "notes" | "customer" | "timeline">("conversation");
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [sortMode, setSortMode] = useState<"newest" | "oldest" | "priority" | "sla">("newest");
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedBulk, setSelectedBulk] = useState<string[]>([]);
  const [showNewConv, setShowNewConv] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [newConvForm, setNewConvForm] = useState({ contactId: "", channel: "whatsapp_manual", subject: "", priority: "normal" });
  const [quickCreate, setQuickCreate] = useState<null | "ticket" | "task" | "followup" | "opportunity" | "order">(null);
  const [aiPanel, setAiPanel] = useState<null | "summary" | "draft" | "classify" | "suggest">(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const [aiClassify, setAiClassify] = useState<Record<string, unknown> | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<any[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [quickForm, setQuickForm] = useState({ title: "", priority: "normal", type: "manual", dueAt: "", notes: "" });
  const [orderForm, setOrderForm] = useState({ channel: "manual", currency: "YER", notes: "" });
  const [realtimeStatus, setRealtimeStatus] = useState<InboxStreamStatus>("reconnecting");

  // ── إعادة تصميم الجوال (8 يوليو) ──────────────────────────────────────────
  const [mobileStatusFilter, setMobileStatusFilter] = useState<"" | "needs_human" | "ai_active" | "closed">("");
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showMobileMoreMenu, setShowMobileMoreMenu] = useState(false);
  const [showMobileCustomerInfo, setShowMobileCustomerInfo] = useState(false);
  const [showMobileTransfer, setShowMobileTransfer] = useState(false);
  const [showMobileAttach, setShowMobileAttach] = useState(false);
  const [showMobileConvSearch, setShowMobileConvSearch] = useState(false);
  const [convSearchQuery, setConvSearchQuery] = useState("");
  const [suggestReplyLoading, setSuggestReplyLoading] = useState(false);
  const [suggestReplyError, setSuggestReplyError] = useState<string | null>(null);
  // تثبيت المحادثات: لا عمود pinned في قاعدة البيانات (ولا نضيف هجرة لهذا التبسيط
  // البصري) — تثبيت محلي حقيقي عبر localStorage بدل زر شكلي بلا وظيفة. يبقى على
  // هذا الجهاز فقط؛ ليس مشتركاً بين أعضاء الفريق.
  const [pinnedConvIds, setPinnedConvIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("wesal:pinnedConversations") ?? "[]"); } catch { return []; }
  });
  function togglePinConversation(convId: string) {
    setPinnedConvIds((prev) => {
      const next = prev.includes(convId) ? prev.filter((id) => id !== convId) : [convId, ...prev];
      try { localStorage.setItem("wesal:pinnedConversations", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  selectedConvIdRef.current = selectedConvId;

  const { data: workspaceData } = useQuery({
    queryKey: ["workspace-name-inbox"],
    queryFn: () => apiFetch("workspace"),
    enabled: canRead,
    staleTime: 300000,
  });
  const workspaceName: string = (workspaceData as { workspace?: { name?: string } } | undefined)?.workspace?.name ?? "وصال ون";

  const { data: usageData } = useQuery({
    queryKey: ["workspace-usage-inbox"],
    queryFn: () => apiFetch("workspace/usage"),
    enabled: canRead && canReadUsage,
    staleTime: 30000,
  });

  const params = new URLSearchParams();
  if (viewFilter) params.set("view", viewFilter);
  if (statusFilter) params.set("status", statusFilter);
  if (searchQuery) params.set("search", searchQuery);
  if (channelFilter) params.set("channel", channelFilter);
  if (assigneeFilter) params.set("assignee", assigneeFilter);
  params.set("limit", "50");
  params.set("page", String(page));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["conversations", viewFilter, statusFilter, searchQuery, channelFilter, assigneeFilter, page],
    queryFn: () => apiFetch(`conversations?${params.toString()}`),
    enabled: canRead,
    refetchInterval: 10000,
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["conversation", selectedConvId],
    queryFn: () => apiFetch(`conversations/${selectedConvId}`),
    enabled: !!selectedConvId && canRead,
    refetchInterval: 5000,
  });

  // فتح المحادثة يصفّر unreadCount في الخادم (انظر conversations.routes.ts GET /:id).
  // حدّث قائمة المحادثات لتعكس الشارة الصحيحة فوراً بدل انتظار الـpoll الدوري.
  useEffect(() => {
    if (detail?.conversation?.id) {
      qc.invalidateQueries({ queryKey: ["conversations"] });
    }
  }, [detail?.conversation?.id]);

  const { data: membersData } = useQuery({
    queryKey: ["workspace-members"],
    queryFn: () => apiFetch("users"),
    enabled: canRead,
  });

  const { data: providerStatus } = useQuery({
    queryKey: ["ai-provider-status"],
    queryFn: () => apiFetch("ai/provider-status"),
    enabled: canRead,
    staleTime: 30000,
  });

  const { data: contactsData } = useQuery({
    queryKey: ["contacts-mini"],
    queryFn: () => apiFetch("contacts?limit=200"),
    enabled: canCreate,
  });

  const { data: channelAccountsData } = useQuery({
    queryKey: ["channel-accounts"],
    queryFn: () => apiFetch("channels/accounts"),
    enabled: canRead && canReadChannels,
    staleTime: 60000,
  });

  const { data: quickRepliesData } = useQuery({
    queryKey: ["quick-replies"],
    queryFn: () => apiFetch("quick-replies"),
    enabled: canReadQuickReplies,
  });

  const { data: savedViewsData } = useQuery({
    queryKey: ["saved-views", "conversations"],
    queryFn: () => apiFetch("saved-views?resource=conversations"),
    enabled: canReadSavedViews,
  });

  const { data: slaRulesData } = useQuery({
    queryKey: ["sla-rules"],
    queryFn: () => apiFetch("sla-rules"),
    enabled: canRead,
  });

  const { data: metaChannelsData } = useQuery({
    queryKey: ["meta-channels", "inbox-banner"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/integrations/meta/channels`, { credentials: "include" });
      if (!res.ok) return { accounts: [] };
      return res.json();
    },
    enabled: canRead,
    staleTime: 30000,
  });

  const hasConnectedMetaChannels = (metaChannelsData?.accounts ?? []).some((channel: any) => channel.status === "active");
  const pointsStatus = (usageData as { points?: { exhausted?: boolean; remaining?: number | null; balance?: number | null } } | undefined)?.points;
  const pointsExhausted = Boolean(pointsStatus?.exhausted);
  const pointsRemaining = Number(pointsStatus?.remaining ?? 0);
  const extraPointsBalance = Number(pointsStatus?.balance ?? 0);
  const pointsAlert = pointsExhausted ? (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-950">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-black">نفدت نقاط الذكاء</span>
          <span className="hidden truncate text-rose-800 sm:inline" title="الردود التلقائية متوقفة، والرسائل تبقى في الوارد للفريق البشري حتى الترقية أو الشحن.">
            — الردود التلقائية متوقفة، الرسائل تصل الوارد للفريق البشري
          </span>
          <span className="hidden shrink-0 text-[0.7rem] font-semibold text-rose-700 lg:inline">
            (المتبقي: {pointsRemaining.toLocaleString("ar-u-nu-latn")} · الإضافي: {extraPointsBalance.toLocaleString("ar-u-nu-latn")})
          </span>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Link href="/billing">
            <span className="inline-flex rounded-md bg-rose-700 px-2.5 py-1 text-[0.7rem] font-bold text-white hover:bg-rose-800">ترقية الباقة</span>
          </Link>
          <Link href="/points">
            <span className="inline-flex rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[0.7rem] font-bold text-rose-800 hover:bg-rose-100">شحن نقاط</span>
          </Link>
        </div>
      </div>
    </div>
  ) : null;

  const createSavedView = useMutation({
    mutationFn: () => apiFetch("saved-views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `عرض محفوظ ${new Date().toLocaleTimeString("ar-YE-u-nu-latn", { hour: "2-digit", minute: "2-digit" })}`,
        resource: "conversations",
        filters: { view: viewFilter, status: statusFilter, search: searchQuery, channel: channelFilter, assignee: assigneeFilter },
        isPinned: true,
        sortOrder: 0,
      }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-views", "conversations"] }),
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages?.length]);

  const refreshInboxQueries = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["conversations"] });
    const currentConversationId = selectedConvIdRef.current;
    if (currentConversationId) {
      qc.invalidateQueries({ queryKey: ["conversation", currentConversationId] });
    }
  }, [qc]);

  const closeInboxStream = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
    setRealtimeStatus("closed");
  }, []);

  const openFreshInboxStream = useCallback(() => {
    if (!canRead) return;
    streamRef.current?.close();
    streamRef.current = openInboxStream({
      onStatus: setRealtimeStatus,
      onMessageReceived: refreshInboxQueries,
    });
  }, [canRead, refreshInboxQueries]);

  useEffect(() => {
    if (!canRead) {
      closeInboxStream();
      return;
    }
    openFreshInboxStream();
    return closeInboxStream;
  }, [canRead, closeInboxStream, openFreshInboxStream]);

  useEffect(() => {
    if (!canRead) return;

    const reconnectAndRefresh = () => {
      openFreshInboxStream();
      refreshInboxQueries();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") reconnectAndRefresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", reconnectAndRefresh);
    window.addEventListener("online", reconnectAndRefresh);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", reconnectAndRefresh);
      window.removeEventListener("online", reconnectAndRefresh);
    };
  }, [canRead, openFreshInboxStream, refreshInboxQueries]);

  const invalidateDetail = () => {
    qc.invalidateQueries({ queryKey: ["conversation", selectedConvId] });
    qc.invalidateQueries({ queryKey: ["conversations"] });
  };

  const createConv = useMutation({
    mutationFn: (body: typeof newConvForm) => apiFetch("conversations", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      setShowNewConv(false);
      setNewConvForm({ contactId: "", channel: "whatsapp_manual", subject: "", priority: "normal" });
      if (data.conversation?.id) {
        setSelectedConvId(data.conversation.id);
        setMobileView("detail");
      }
    },
  });

  const sendMessage = useMutation({
    mutationFn: ({ content, isNote, outboundMediaUrl }: { content: string; isNote: boolean; outboundMediaUrl?: string }) =>
      apiFetch(`conversations/${selectedConvId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          direction: "outbound",
          isPrivateNote: isNote,
          contentType: isNote ? "note" : outboundMediaUrl ? "image" : "text",
          ...(outboundMediaUrl ? { mediaUrl: outboundMediaUrl, mediaType: "image" } : {}),
        }),
      }),
    onSuccess: () => { setMessageText(""); setMediaUrl(""); invalidateDetail(); },
  });

  const changeStatus = useMutation({
    mutationFn: ({ convId, status }: { convId: string; status: string }) =>
      apiFetch(`conversations/${convId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }),
    onSuccess: invalidateDetail,
  });

  const assignConv = useMutation({
    mutationFn: ({ convId, membershipId }: { convId: string; membershipId: string | null }) =>
      apiFetch(`conversations/${convId}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId }),
      }),
    onSuccess: invalidateDetail,
  });

  const changeAgentStatus = useMutation({
    mutationFn: ({ convId, status }: { convId: string; status: "active" | "paused" | "human" }) =>
      apiFetch(`conversations/${convId}/agent-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }),
    onSuccess: invalidateDetail,
    onError: (err: Error) => toast.error(err.message || "تعذّر تغيير حالة الوكيل"),
  });

  const importConv = useMutation({
    mutationFn: ({ convId, text }: { convId: string; text: string }) =>
      apiFetch(`conversations/${convId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => { setImportText(""); setShowImport(false); invalidateDetail(); },
  });

  const quickCreateMutation = useMutation({
    mutationFn: ({ type, body }: { type: "ticket" | "task" | "followup" | "opportunity" | "order"; body: Record<string, unknown> }) =>
      apiFetch(type === "ticket" ? "tickets" : type === "task" ? "tasks" : type === "followup" ? "followups" : type === "opportunity" ? "opportunities" : "orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["followups"] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setQuickCreate(null);
      setQuickForm({ title: "", priority: "normal", type: "manual", dueAt: "", notes: "" });
      setOrderForm({ channel: "manual", currency: "YER", notes: "" });
    },
  });

  const list: any[] = data?.conversations ?? [];
  const totalConversations: number = data?.total ?? 0;
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(totalConversations / pageSize));
  const counts: Record<string, number> = data?.counts ?? {};
  const members: any[] = membersData?.members ?? membersData?.users ?? [];
  const memberByMembershipId = new Map(
    members.map((member) => [String(member.membershipId ?? member.id ?? ""), member] as const).filter(([membershipId]) => membershipId),
  );
  const quickReplies: any[] = quickRepliesData?.quickReplies ?? [];
  const savedViews: any[] = savedViewsData?.savedViews ?? [];
  const slaRules: any[] = slaRulesData?.slaRules ?? [];
  const sortedList = [...list].sort((a, b) => {
    if (sortMode === "oldest") return new Date(a.lastMessageAt ?? a.createdAt).getTime() - new Date(b.lastMessageAt ?? b.createdAt).getTime();
    if (sortMode === "priority") {
      const weight: Record<string, number> = { urgent: 4, high: 3, normal: 2, low: 1 };
      return (weight[b.priority] ?? 0) - (weight[a.priority] ?? 0);
    }
    if (sortMode === "sla") {
      const slaA = a.unreadCount > 0 && a.lastMessageAt ? Date.now() - new Date(a.lastMessageAt).getTime() : 0;
      const slaB = b.unreadCount > 0 && b.lastMessageAt ? Date.now() - new Date(b.lastMessageAt).getTime() : 0;
      return slaB - slaA;
    }
    return new Date(b.lastMessageAt ?? b.createdAt).getTime() - new Date(a.lastMessageAt ?? a.createdAt).getTime();
  });
  const defaultSlaMinutes = Math.max(1, Number(slaRules.find((rule) => rule.active)?.firstResponseMinutes ?? 30));
  const totalUnread = list.reduce((sum, c) => sum + (Number(c.unreadCount) || 0), 0);
  const activeFilterCount = [
    viewFilter,
    statusFilter,
    channelFilter,
    assigneeFilter,
    sortMode !== "newest" ? sortMode : "",
  ].filter(Boolean).length;

  async function runAISummarize() {
    if (!selectedConvId) return;
    setAiLoading(true); setAiError(null); setAiSummary(null); setAiPanel("summary");
    try {
      const res = await apiFetch("ai/runs/summarize-conversation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: selectedConvId, model: "mock" }),
      });
      setAiSummary(res.summary);
    } catch (e) { setAiError((e as Error).message); }
    finally { setAiLoading(false); }
  }

  async function runAIDraft() {
    if (!selectedConvId) return;
    setAiLoading(true); setAiError(null); setAiDraft(null); setAiPanel("draft");
    try {
      const res = await apiFetch("ai/runs/draft-reply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: selectedConvId, model: "mock" }),
      });
      setAiDraft(res.draft);
    } catch (e) { setAiError((e as Error).message); }
    finally { setAiLoading(false); }
  }

  async function runAIClassify() {
    if (!selectedConvId) return;
    setAiLoading(true); setAiError(null); setAiClassify(null); setAiPanel("classify");
    try {
      const res = await apiFetch("ai/runs/classify-conversation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: selectedConvId, model: "mock" }),
      });
      setAiClassify(res.classification);
    } catch (e) { setAiError((e as Error).message); }
    finally { setAiLoading(false); }
  }

  async function runAISuggest() {
    if (!selectedConvId) return;
    setAiLoading(true); setAiError(null); setAiSuggestions([]); setAiPanel("suggest");
    try {
      const res = await apiFetch("ai/runs/suggest-actions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: selectedConvId, model: "mock" }),
      });
      setAiSuggestions(res.suggestions ?? []);
    } catch (e) { setAiError((e as Error).message); }
    finally { setAiLoading(false); }
  }

  // نسخة الجوال من "اقترح رد": نفس نقطة الاتصال (ai/runs/draft-reply) التي
  // يستخدمها runAIDraft، لكن تكتب الناتج مباشرة في مربع الكتابة كمسودة قابلة
  // للتعديل بدل عرضه في بطاقة منفصلة تحتاج ضغطة "إدراج" إضافية. حالة تحميل/خطأ
  // مستقلة عن aiLoading/aiError المشتركة مع تلخيص/تصنيف حتى لا تتزاحم الحالتان.
  async function runSuggestReplyIntoComposer() {
    if (!selectedConvId) return;
    setSuggestReplyLoading(true);
    setSuggestReplyError(null);
    try {
      const res = await apiFetch("ai/runs/draft-reply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: selectedConvId, model: "mock" }),
      });
      if (res.draft) {
        setMessageText(res.draft);
        setMessageMode("reply");
      }
    } catch (e) {
      setSuggestReplyError((e as Error).message || "تعذّر توليد الاقتراح");
    } finally {
      setSuggestReplyLoading(false);
    }
  }

  function selectConv(conv: any) {
    setSelectedConvId(conv.id);
    setDetailTab("conversation");
    setSelectedBulk([]);
    setMobileView("detail");
  }

  function toggleBulk(id: string) {
    setSelectedBulk((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  }

  function applySavedView(view: any) {
    const filters = view.filters ?? {};
    setViewFilter(String(filters.view ?? ""));
    setStatusFilter(String(filters.status ?? ""));
    setSearchQuery(String(filters.search ?? ""));
    setChannelFilter(String(filters.channel ?? ""));
    setAssigneeFilter(String(filters.assignee ?? ""));
  }

  function insertQuickReply(reply: any) {
    setMessageText(reply.body);
    setMessageMode("reply");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && (messageText.trim() || mediaUrl.trim())) {
      e.preventDefault();
      sendMessage.mutate({
        content: messageText,
        isNote: messageMode === "note",
        outboundMediaUrl: messageMode === "note" ? undefined : mediaUrl.trim() || undefined,
      });
    }
  }

  function attachImageByUrl() {
    const url = window.prompt("ألصق رابط صورة عام (HTTPS):");
    if (url?.trim()) setMediaUrl(url.trim());
  }

  const conv = detail?.conversation;
  const ticket = detail?.ticket;
  const messages: any[] = detail?.messages ?? [];
  const visibleMessages = messages.filter((msg: any) => {
    const isInternal = msg.direction === "internal" || msg.isPrivateNote;
    if (detailTab === "notes") return isInternal;
    if (detailTab === "conversation") return !isInternal;
    return true;
  });
  const timelineMessages = messages.slice(-8).reverse();
  const contactChannels: any[] = detail?.contactChannels ?? [];
  const waLink: string | null = detail?.waLink ?? null;
  const assignedMember = detail?.assignedMember;
  const conversationLabels = normalizeConversationLabels(conv?.labels);
  const conversationUnifiedStatus = normalizeConversationStatus(conv?.status, conv?.lifecycleState);
  const assignedPresenceMember = conv?.assignedMembershipId
    ? memberByMembershipId.get(String(conv.assignedMembershipId))
    : null;
  const assignedConversationMember = assignedPresenceMember
    ? { ...assignedPresenceMember, name: assignedMember?.name ?? assignedPresenceMember.name }
    : assignedMember;
  const filteredQuickReplies = messageText.trim().startsWith("/")
    ? quickReplies.filter((reply) => reply.shortcut?.startsWith(messageText.trim()) || reply.title?.includes(messageText.trim().slice(1))).slice(0, 6)
    : [];

  const statusActions = conv ? (STATUS_ACTIONS[conv.status] ?? []) : [];

  const channelAccounts: any[] = channelAccountsData?.accounts ?? [];
  const currentChannelAccount = conv?.channelAccountId
    ? channelAccounts.find((account) => account.id === conv.channelAccountId)
    : null;
  const agentStatus = conv?.agentStatus as "active" | "paused" | "human" | undefined;
  const needsAgentReactivation = Boolean(conv?.needsHuman || agentStatus === "human");
  const agentStatusAction = needsAgentReactivation ? "active" : agentStatus === "active" ? "paused" : "active";
  const showAgentControls = Boolean(
    (conv?.channelAccountId && currentChannelAccount?.defaultAgentId && agentStatus) || needsAgentReactivation,
  );
  const agentPausedUntil = conv?.agentPausedUntil ? new Date(conv.agentPausedUntil) : null;
  const agentPausedUntilLabel = agentPausedUntil && !Number.isNaN(agentPausedUntil.getTime())
    ? agentPausedUntil.toLocaleTimeString("ar-YE-u-nu-latn", { hour: "2-digit", minute: "2-digit" })
    : null;
  const agentBadge =
    agentStatus === "active"
      ? { label: "🤖 يرد تلقائياً", className: "bg-green-50 text-green-700 border-green-200" }
      : agentStatus === "paused"
        ? { label: `⏸️ موقوف${agentPausedUntilLabel ? ` حتى ${agentPausedUntilLabel}` : ""}`, className: "bg-yellow-50 text-yellow-700 border-yellow-200" }
        : needsAgentReactivation
          ? { label: "👤 يرد بشري", className: "bg-gray-50 text-gray-700 border-gray-200" }
          : null;

  // بطاقة الجوال المبسّطة: قرار واحد فقط — الوكيل يرد أو الموظف يتولى. "موقوف
  // مؤقتاً" و"يحتاج تفعيلاً" (needsHuman) كلاهما "الموظف يتولي" من منظور المستخدم؛
  // agentStatusAction أعلاه يعطي فعلياً نفس الإجراء التالي الصحيح لكلتا الحالتين
  // مسبقاً، فلا حاجة لتغيير أي منطق — تبسيط عرض فقط.
  const mobileAgentCardIsHuman = agentStatus !== "active";
  // زر واحد ديناميكي بدل قائمة انتقالات الحالة الكاملة: لو توجد خطوة "إغلاق"
  // حقيقية (resolved/closed) نسمّيها "إغلاق المحادثة" بدل كلمة "حل"؛ غير ذلك
  // نعرض أول إجراء متاح بتسميته الأصلية (مثل "إعادة فتح" لمحادثة مغلقة فعلاً).
  const closingAction = statusActions.find((a) => a.next === "resolved" || a.next === "closed");
  const primaryStatusAction = closingAction ?? statusActions[0] ?? null;
  const primaryStatusLabel = primaryStatusAction
    ? (primaryStatusAction.next === "resolved" || primaryStatusAction.next === "closed" ? "إغلاق المحادثة" : primaryStatusAction.label)
    : null;

  if (!canRead) {
    return (
      <div dir="rtl" className="p-6">
        <PageHeader title="صندوق الوارد" subtitle="إدارة المحادثات مع العملاء" />
        <div className="mt-6 p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm text-center">
          ليس لديك صلاحية عرض المحادثات
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="flex flex-1 h-full min-h-0 flex-col overflow-hidden">

      {/* ═══════════ MOBILE LAYOUT (lg:hidden) ═══════════ */}
      <div className="lg:hidden flex flex-col h-full overflow-hidden bg-background">

        {/* ── MOBILE: LIST VIEW ── */}
        {mobileView === "list" && (
          <>
            {/* Header */}
            <header className="shrink-0 flex items-center gap-2 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 bg-background border-b border-border">
              <button
                onClick={() => setShowMobileSearch((v) => { const next = !v; if (!next) setSearchQuery(""); return next; })}
                className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center bg-muted text-muted-foreground"
              >
                {showMobileSearch ? <X size={18} /> : <Search size={18} />}
              </button>
              {showMobileSearch ? (
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث بالاسم أو الرقم..."
                  className="flex-1 min-w-0 rounded-full border border-border bg-muted px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
              ) : (
                <h1 className="flex-1 min-w-0 text-base font-black text-foreground tracking-tight truncate">{workspaceName}</h1>
              )}
              <button
                onClick={() => setShowMobileFilters(true)}
                className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center bg-muted text-muted-foreground"
                title="فلاتر متقدمة"
              >
                <SlidersHorizontal size={16} />
              </button>
              <ContactInitials name={user?.name} size={36} />
            </header>

            {pointsAlert && <div className="shrink-0 px-3 py-2">{pointsAlert}</div>}

            {/* شريط حالة واحد مبسّط: الكل / تحتاج تدخل / الذكاء يرد / مغلقة — بدل شرائط
                القنوات + بطاقة الإحصاءات + شارات متعددة متزامنة على كل بطاقة. */}
            <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 overflow-x-auto border-b border-border/40" style={{ scrollbarWidth: "none" }}>
              {(
                [
                  { key: "", label: "الكل" },
                  { key: "needs_human", label: "تحتاج تدخل" },
                  { key: "ai_active", label: "الذكاء يرد" },
                  { key: "closed", label: "مغلقة" },
                ] as { key: typeof mobileStatusFilter; label: string }[]
              ).map(({ key, label }) => {
                const isActive = mobileStatusFilter === key;
                return (
                  <button
                    key={key}
                    onClick={() => setMobileStatusFilter(key)}
                    className={cn(
                      "shrink-0 rounded-full px-3.5 py-1.5 text-[0.8rem] font-bold whitespace-nowrap border transition-colors",
                      isActive ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Conversation Items — بطاقة مبسّطة: صورة/حرف، اسم، آخر رسالة، وقت، رمز
                القناة، وحالة واحدة فقط. المثبّتة (محلياً) تعلو القائمة. */}
            <div className="flex-1 overflow-y-auto">
              {(() => {
                const filtered = mobileStatusFilter
                  ? sortedList.filter((c: any) => mobileConvStatus(c) === mobileStatusFilter)
                  : sortedList;
                const displayList = [...filtered].sort((a, b) => {
                  const pinnedA = pinnedConvIds.includes(a.id) ? 1 : 0;
                  const pinnedB = pinnedConvIds.includes(b.id) ? 1 : 0;
                  return pinnedB - pinnedA;
                });
                if (isLoading) {
                  return <div className="flex items-center justify-center h-40 text-muted-foreground text-sm animate-pulse">جار التحميل...</div>;
                }
                if (displayList.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
                      <span className="text-2xl">📭</span>
                      <span>لا توجد محادثات</span>
                    </div>
                  );
                }
                return displayList.map((c: any) => {
                  const badge = MOBILE_STATUS_BADGE[mobileConvStatus(c)];
                  const isPinned = pinnedConvIds.includes(c.id);
                  return (
                    <button key={c.id} onClick={() => selectConv(c)} className={cn(
                      "w-full flex items-center gap-3 px-4 py-3.5 border-b border-border/40 transition-colors text-start",
                      selectedConvId === c.id ? "bg-primary/8" : "hover:bg-muted/30"
                    )}>
                      <div className="relative shrink-0">
                        <ContactInitials name={c.contactName} size={44} />
                        <span className="absolute -bottom-0.5 -start-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-card shadow ring-1 ring-card">
                          <ChannelIconBadge channel={c.channel} size={12} />
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className="min-w-0 flex-1 flex items-center gap-1">
                            {isPinned && <Pin size={11} className="shrink-0 text-primary" fill="currentColor" />}
                            <span className={cn("block truncate text-sm", (c.unreadCount ?? 0) > 0 ? "font-black text-foreground" : "font-semibold text-foreground/80")}>
                              {c.contactName ?? "عميل غير معروف"}
                            </span>
                          </span>
                          <span className="text-[0.68rem] text-muted-foreground shrink-0">{timeAgo(c.lastMessageAt ?? c.createdAt)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs text-muted-foreground truncate leading-snug">{c.lastMessage ?? c.subject ?? "—"}</span>
                          {(c.unreadCount ?? 0) > 0 && (
                            <span className="shrink-0 h-5 min-w-5 rounded-full bg-primary text-primary-foreground text-[0.65rem] font-black flex items-center justify-center px-1">
                              {c.unreadCount}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5">
                          <span className={cn("text-[0.68rem] px-2 py-0.5 rounded-full border font-bold", badge.className)}>{badge.label}</span>
                        </div>
                      </div>
                    </button>
                  );
                });
              })()}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 px-4 py-3 border-t border-border/40 text-xs text-muted-foreground">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-40"
                  >
                    السابق
                  </button>
                  <span>صفحة {page} من {totalPages} ({totalConversations} محادثة)</span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-40"
                  >
                    التالي
                  </button>
                </div>
              )}
              <div className="h-[calc(1rem+env(safe-area-inset-bottom))]" />
            </div>

            {/* FAB */}
            {canCreate && (
              <button
                onClick={() => setShowNewConv(true)}
                className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] start-4 z-20 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center justify-center hover:bg-primary/90 transition-colors"
              >
                <Plus size={24} />
              </button>
            )}
          </>
        )}

        {/* ── MOBILE: CONVERSATION DETAIL ──
            طبقة ملء-شاشة (fixed inset-0) — نفس نمط واتساب/تيليجرام: فتح محادثة يُخفي
            رأس التطبيق العام وشريط التنقل السفلي تلقائياً بدل تكديسهما فوق رأس
            المحادثة. قِسنا الهدر فعلياً: 71px رأس مكرر + 92px تنقّل سفلي بلا فائدة
            أثناء الدردشة = 183px من 812px (22%) كانت تُسرق من مساحة الرسائل. */}
        {mobileView === "detail" && (
          <div className="fixed inset-0 z-30 flex flex-col bg-background lg:hidden">
            {/* Conversation Header — رجوع، صورة، اسم، القناة+آخر نشاط، ⋮ فقط */}
            <header className="shrink-0 flex items-center gap-2 px-3 pt-[calc(0.6rem+env(safe-area-inset-top))] pb-3 bg-background border-b border-border">
              <button onClick={() => setMobileView("list")} className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center bg-muted hover:bg-muted/80 text-foreground">
                <ArrowRight size={18} />
              </button>
              {conv ? (
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <div className="relative shrink-0">
                    <ContactInitials name={conv.contactName} size={36} />
                    <span className="absolute -bottom-0.5 -start-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-card shadow ring-1 ring-card">
                      <ChannelIconBadge channel={conv.channel} size={10} />
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-foreground truncate">{conv.contactName ?? "عميل غير معروف"}</div>
                    <div className="text-xs text-muted-foreground truncate">{channelLabels[conv.channel] ?? conv.channel} · آخر نشاط {timeAgo(conv.lastMessageAt ?? conv.updatedAt)}</div>
                  </div>
                </div>
              ) : (
                <div className="flex-1" />
              )}
              {conv && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center bg-muted text-muted-foreground hover:bg-muted/80">
                      <MoreHorizontal size={16} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => setShowMobileConvSearch(true)}>
                      البحث داخل المحادثة
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => togglePinConversation(conv.id)}>
                      {pinnedConvIds.includes(conv.id) ? "إلغاء تثبيت المحادثة" : "تثبيت المحادثة"}
                    </DropdownMenuItem>
                    {waLink && (
                      <DropdownMenuItem onClick={() => window.open(waLink, "_blank")}>
                        فتح في واتساب
                      </DropdownMenuItem>
                    )}
                    {canResolve && primaryStatusAction && (
                      <DropdownMenuItem onClick={() => changeStatus.mutate({ convId: conv.id, status: primaryStatusAction.next })}>
                        {primaryStatusLabel}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </header>

            {/* بطاقة حالة واحدة: الوكيل يرد، أو الموظف يتولى — قرار واحد بزر واحد */}
            {conv && showAgentControls && (
              <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 bg-muted/30 border-b border-border/50">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-foreground">
                    {mobileAgentCardIsHuman ? "أنت تتولى المحادثة" : "الوكيل يرد تلقائياً"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {mobileAgentCardIsHuman ? "تم إيقاف الوكيل مؤقتاً في هذه المحادثة" : "الوكيل نشط ويرد نيابة عنك"}
                  </div>
                </div>
                {canManageConversationAgent && (
                  <button
                    onClick={() => changeAgentStatus.mutate({ convId: conv.id, status: agentStatusAction })}
                    disabled={changeAgentStatus.isPending}
                    className={cn("shrink-0 px-3.5 py-2 rounded-full text-xs font-bold border disabled:opacity-50 min-h-11",
                      mobileAgentCardIsHuman ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border")}
                  >
                    {mobileAgentCardIsHuman ? "إعادة للوكيل" : "استلام المحادثة"}
                  </button>
                )}
              </div>
            )}
            {conv && !showAgentControls && conv.channelAccountId && currentChannelAccount && !currentChannelAccount.defaultAgentId && canManageConversationAgent && (
              <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-100 text-amber-700 text-xs">
                <AlertTriangle size={13} className="shrink-0" />
                <span>القناة بلا وكيل افتراضي —</span>
                <Link to="/integrations" className="font-bold underline">اضبطه من إعدادات القنوات</Link>
              </div>
            )}

            {/* شريط الأدوات: معلومات العميل / تحويل / المزيد فقط — الباقي داخل المزيد */}
            {conv && (
              <div className="shrink-0 flex items-stretch bg-card border-b border-border">
                {[
                  { icon: <User size={16} />, label: "معلومات العميل", action: () => setShowMobileCustomerInfo(true) },
                  { icon: <ArrowLeftRight size={16} />, label: "تحويل", action: () => setShowMobileTransfer(true) },
                  { icon: <MoreHorizontal size={16} />, label: "المزيد", action: () => setShowMobileMoreMenu(true) },
                ].map(({ icon, label, action }) => (
                  <button
                    key={label}
                    onClick={action}
                    className="flex flex-col items-center justify-center gap-1 flex-1 py-2.5 hover:bg-muted/50 transition-colors border-e border-border last:border-e-0 min-h-11"
                  >
                    <span className="text-muted-foreground">{icon}</span>
                    <span className="text-[0.6rem] text-muted-foreground font-medium">{label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Messages */}
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4 space-y-3">
              {detailLoading ? (
                <div className="flex items-center justify-center h-20 text-muted-foreground text-sm animate-pulse">جار التحميل...</div>
              ) : !conv ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground text-sm">
                  <span className="text-4xl">💬</span>
                  <span>اختر محادثة من القائمة</span>
                </div>
              ) : (
                visibleMessages.map((msg: any) => {
                  const isInternal = msg.type === "note" || msg.source === "note" || msg.direction === "internal" || msg.isPrivateNote;
                  const isOutbound = msg.direction === "outbound";
                  return (
                    <div key={msg.id} className={cn("flex items-end gap-2", isInternal ? "justify-center" : isOutbound ? "justify-start" : "justify-end")}>
                      {isInternal ? (
                        <div className="max-w-[90%] break-words rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm italic text-amber-800 [overflow-wrap:anywhere]">
                          <div className="flex items-center gap-1 mb-1 not-italic font-bold text-amber-700 text-xs">
                            🔒 ملاحظة داخلية {msg.senderName && <span>— {msg.senderName}</span>}
                          </div>
                          <div>{msg.content}</div>
                          <div className="text-xs mt-1 opacity-60">{formatDateTime(msg.sentAt)}</div>
                        </div>
                      ) : isOutbound ? (
                        <>
                          <div className="max-w-[78%] break-words rounded-2xl rounded-bl-sm bg-primary px-3.5 py-2.5 text-sm text-primary-foreground [overflow-wrap:anywhere]">
                            {msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}
                            {selectedConvId && <MessageAttachments conversationId={selectedConvId} messageId={msg.id} attachments={msg.attachments} />}
                            <div className="text-[0.65rem] mt-1 opacity-60 flex items-center gap-1 justify-end">
                              {msg.senderName && <span>{msg.senderName}</span>}
                              <span>{formatDateTime(msg.sentAt)}</span>
                            </div>
                          </div>
                          <span className="shrink-0 h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-black text-primary">و</span>
                        </>
                      ) : (
                        <>
                          <ContactInitials name={conv.contactName} size={28} />
                          <div className="max-w-[78%] break-words rounded-2xl rounded-br-sm bg-muted px-3.5 py-2.5 text-sm text-foreground [overflow-wrap:anywhere]">
                            {msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}
                            {selectedConvId && <MessageAttachments conversationId={selectedConvId} messageId={msg.id} attachments={msg.attachments} />}
                            <div className="text-[0.65rem] mt-1 opacity-60">{formatDateTime(msg.sentAt)}</div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* نتيجة "تلخيص المحادثة" — الأداة الوحيدة المتبقية ظاهرة على الجوال غير
                اقتراح الرد (الذي انتقل مباشرة لشريط الكتابة). التصنيف واقتراح
                الخطوة التالية ما زالا يعملان على الديسكتوب، لم يُحذَفا، فقط لم
                يعودا مربوطين بواجهة الجوال كي لا تزدحم الشاشة. */}
            {canUseAI && aiPanel === "summary" && aiSummary && (
              <div className="shrink-0 mx-3 mb-2 rounded-2xl border border-purple-200 bg-purple-50 px-4 py-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Sparkles size={14} className="text-purple-600" />
                  <span className="text-xs font-bold text-purple-700">ملخص المحادثة</span>
                  <button onClick={() => { setAiPanel(null); setAiSummary(null); }} className="ms-auto text-purple-400 hover:text-purple-600 text-sm">✕</button>
                </div>
                <p className="text-xs text-purple-900 leading-relaxed">{aiSummary}</p>
              </div>
            )}
            {canUseAI && aiPanel === "summary" && aiLoading && (
              <div className="shrink-0 mx-3 mb-2 text-center text-xs text-purple-600 animate-pulse">جارٍ تلخيص المحادثة...</div>
            )}
            {canUseAI && aiPanel === "summary" && aiError && (
              <div className="shrink-0 mx-3 mb-2 flex items-center justify-between gap-2 text-xs text-destructive bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                <span>{aiError}</span>
                <button onClick={runAISummarize} className="shrink-0 font-bold underline">إعادة المحاولة</button>
              </div>
            )}

            {/* Composer: [+] [نص] [اقتراح رد — للموظف فقط] [إرسال] */}
            {canReply ? (
              <div className="shrink-0 bg-background border-t border-border px-3 pt-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                {workspaceName && (
                  <div className="text-xs text-center text-muted-foreground mb-2">
                    الرد سيكون من فريق {workspaceName}
                  </div>
                )}
                {suggestReplyError && (
                  <div className="flex items-center justify-between gap-2 text-xs text-destructive bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-2">
                    <span>{suggestReplyError}</span>
                    <button onClick={runSuggestReplyIntoComposer} className="shrink-0 font-bold underline">إعادة المحاولة</button>
                  </div>
                )}
                <div className={cn(
                  "flex items-center gap-2 rounded-2xl border px-3 py-2",
                  messageMode === "note" ? "border-yellow-300 bg-yellow-50" : "border-border bg-card"
                )}>
                  <button
                    onClick={() => setShowMobileAttach(true)}
                    className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center bg-muted text-muted-foreground hover:bg-muted/80"
                    title="إرفاق"
                  >
                    <Plus size={17} />
                  </button>
                  <textarea
                    ref={mobileComposerRef}
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    placeholder={messageMode === "note" ? "ملاحظة داخلية (لا يراها العميل)..." : "اكتب ردك..."}
                    className="flex-1 bg-transparent text-sm outline-none resize-none min-h-[1.5rem] max-h-40 overflow-y-auto"
                  />
                  {messageMode === "note" && (
                    <button onClick={() => setMessageMode("reply")} className="shrink-0 text-[0.65rem] text-yellow-700 font-bold px-2 py-1 rounded-full bg-yellow-100 border border-yellow-200">
                      ملاحظة
                    </button>
                  )}
                  {/* اقتراح رد يظهر فقط عندما الموظف يتولى — لا فائدة منه والوكيل نشط أصلاً */}
                  {canUseAI && mobileAgentCardIsHuman && messageMode === "reply" && (
                    <button
                      onClick={runSuggestReplyIntoComposer}
                      disabled={suggestReplyLoading}
                      title="اقتراح رد"
                      className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center bg-purple-50 text-purple-600 hover:bg-purple-100 disabled:opacity-50"
                    >
                      {suggestReplyLoading ? (
                        <span className="h-3.5 w-3.5 rounded-full border-2 border-purple-300 border-t-purple-600 animate-spin" />
                      ) : (
                        <Sparkles size={15} />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => (messageText.trim() || mediaUrl.trim()) && sendMessage.mutate({
                      content: messageText,
                      isNote: messageMode === "note",
                      outboundMediaUrl: messageMode === "note" ? undefined : mediaUrl.trim() || undefined,
                    })}
                    disabled={(!messageText.trim() && !mediaUrl.trim()) || sendMessage.isPending}
                    className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
                  >
                    {sendMessage.isPending ? <span className="text-xs">...</span> : <Send size={15} />}
                  </button>
                </div>
                {sendMessage.isError && (
                  <p className="text-xs text-destructive mt-1 text-center">{(sendMessage.error as Error)?.message}</p>
                )}
              </div>
            ) : (
              <div className="shrink-0 px-4 py-3 border-t border-border text-center text-xs text-yellow-700 bg-yellow-50 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                ليس لديك صلاحية الرد على المحادثات
              </div>
            )}

            {/* + إرفاق: صورة (رابط فعلي) / ملف (غير مبني بعد) / قالب (يحتاج قناة واتساب) / ملاحظة داخلية */}
            <Drawer open={showMobileAttach} onOpenChange={setShowMobileAttach}>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>إرفاق</DrawerTitle>
                </DrawerHeader>
                <div className="px-4 pb-6 grid grid-cols-2 gap-3">
                  <button
                    onClick={() => { attachImageByUrl(); setShowMobileAttach(false); }}
                    className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-4 hover:bg-muted/50 transition-colors"
                  >
                    <span className="text-2xl">🖼️</span>
                    <span className="text-xs font-bold text-foreground">صورة (رابط)</span>
                  </button>
                  <button disabled title="رفع ملف مباشر غير متاح بعد"
                    className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 p-4 opacity-60 cursor-not-allowed">
                    <span className="text-2xl">📎</span>
                    <span className="text-xs font-bold text-foreground">ملف</span>
                  </button>
                  <button disabled title="إدراج القوالب يحتاج قناة واتساب مربوطة"
                    className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 p-4 opacity-60 cursor-not-allowed">
                    <span className="text-2xl">📄</span>
                    <span className="text-xs font-bold text-foreground">قالب</span>
                  </button>
                  <button
                    onClick={() => { setMessageMode("note"); setShowMobileAttach(false); }}
                    className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-4 hover:bg-muted/50 transition-colors"
                  >
                    <span className="text-2xl">🔒</span>
                    <span className="text-xs font-bold text-foreground">ملاحظة داخلية</span>
                  </button>
                </div>
              </DrawerContent>
            </Drawer>

            {/* المزيد (شريط الأدوات): ملاحظة / قالب / تلخيص / واتساب / إغلاق */}
            <Drawer open={showMobileMoreMenu} onOpenChange={setShowMobileMoreMenu}>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>المزيد</DrawerTitle>
                </DrawerHeader>
                <div className="px-4 pb-6 space-y-1">
                  <button
                    onClick={() => { setMessageMode("note"); setShowMobileMoreMenu(false); }}
                    className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-11"
                  >
                    <StickyNote size={17} className="text-muted-foreground" /> إضافة ملاحظة داخلية
                  </button>
                  <button disabled title="إدراج القوالب يحتاج قناة واتساب مربوطة"
                    className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-muted-foreground opacity-60 cursor-not-allowed min-h-11"
                  >
                    <FileText size={17} /> إرسال قالب
                  </button>
                  {canUseAI && (
                    <button
                      onClick={() => { runAISummarize(); setShowMobileMoreMenu(false); }}
                      className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-11"
                    >
                      <Sparkles size={17} className="text-purple-600" /> تلخيص المحادثة
                    </button>
                  )}
                  {waLink && (
                    <button
                      onClick={() => { window.open(waLink, "_blank"); setShowMobileMoreMenu(false); }}
                      className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-11"
                    >
                      <FaWhatsapp size={17} className="text-[#128C4A]" /> فتح في واتساب
                    </button>
                  )}
                  {canResolve && conv && primaryStatusAction && (
                    <button
                      onClick={() => { changeStatus.mutate({ convId: conv.id, status: primaryStatusAction.next }); setShowMobileMoreMenu(false); }}
                      className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-11"
                    >
                      <ArrowLeftRight size={17} className="text-muted-foreground" /> {primaryStatusLabel}
                    </button>
                  )}
                </div>
              </DrawerContent>
            </Drawer>

            {/* معلومات العميل — نفس بطاقة الديسكتوب (اسم/هاتف/شركة + القنوات المرتبطة) */}
            <Drawer open={showMobileCustomerInfo} onOpenChange={setShowMobileCustomerInfo}>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>معلومات العميل</DrawerTitle>
                </DrawerHeader>
                {conv && (
                  <div className="px-4 pb-6 space-y-3 text-sm">
                    <div className="rounded-xl border border-border bg-background p-4 space-y-2">
                      <div className="text-xs text-muted-foreground">العميل</div>
                      <div className="font-semibold">{conv.contactName ?? "عميل غير معروف"}</div>
                      <div className="text-muted-foreground">{conv.contactPhone ?? "لا يوجد رقم محفوظ"}</div>
                      <div className="text-muted-foreground">{conv.contactCompany ?? "لا توجد شركة"}</div>
                    </div>
                    <div className="rounded-xl border border-border bg-background p-4 space-y-2">
                      <div className="text-xs text-muted-foreground">القنوات المرتبطة</div>
                      {contactChannels.length === 0 ? (
                        <div className="text-muted-foreground">لا توجد قنوات محفوظة</div>
                      ) : contactChannels.map((channel: any) => (
                        <div key={channel.id} className="flex justify-between gap-2">
                          <span>{channel.channelType}</span>
                          <span dir="ltr" className="text-muted-foreground">{channel.identifier}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </DrawerContent>
            </Drawer>

            {/* تحويل: نفس قائمة الفريق وطفرة assignConv المستخدمة في الديسكتوب */}
            <Drawer open={showMobileTransfer} onOpenChange={setShowMobileTransfer}>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>تحويل المحادثة</DrawerTitle>
                  <DrawerDescription>اختر الموظف المسؤول عن المتابعة</DrawerDescription>
                </DrawerHeader>
                <div className="px-4 pb-6 space-y-1">
                  <button
                    onClick={() => { if (conv) assignConv.mutate({ convId: conv.id, membershipId: null }); setShowMobileTransfer(false); }}
                    className={cn("w-full flex items-center justify-between rounded-xl px-3 py-3 text-sm font-medium hover:bg-muted transition-colors min-h-11",
                      !conv?.assignedMembershipId ? "bg-primary/10 text-primary" : "text-foreground")}
                  >
                    بدون مسؤول
                  </button>
                  {members.map((m: any) => {
                    const membershipId = String(m.membershipId ?? m.id);
                    const isAssigned = String(conv?.assignedMembershipId ?? "") === membershipId;
                    return (
                      <button
                        key={membershipId}
                        onClick={() => { if (conv) assignConv.mutate({ convId: conv.id, membershipId }); setShowMobileTransfer(false); }}
                        className={cn("w-full flex items-center justify-between rounded-xl px-3 py-3 text-sm font-medium hover:bg-muted transition-colors min-h-11",
                          isAssigned ? "bg-primary/10 text-primary" : "text-foreground")}
                      >
                        <span>{m.name}</span>
                        <span className="text-xs text-muted-foreground">{resolvePresence(m).label}</span>
                      </button>
                    );
                  })}
                </div>
              </DrawerContent>
            </Drawer>

            {/* بحث داخل المحادثة: تصفية عميلة على الرسائل المحمّلة فعلياً */}
            <Drawer open={showMobileConvSearch} onOpenChange={(open) => { setShowMobileConvSearch(open); if (!open) setConvSearchQuery(""); }}>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>البحث داخل المحادثة</DrawerTitle>
                </DrawerHeader>
                <div className="px-4 pb-6 space-y-3">
                  <input
                    autoFocus
                    value={convSearchQuery}
                    onChange={(e) => setConvSearchQuery(e.target.value)}
                    placeholder="ابحث في نص الرسائل..."
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                    {convSearchQuery.trim() === "" ? (
                      <p className="text-xs text-muted-foreground text-center py-4">اكتب كلمة للبحث ضمن الرسائل المحمّلة في هذه المحادثة</p>
                    ) : (() => {
                      const q = convSearchQuery.trim().toLowerCase();
                      const matches = visibleMessages.filter((msg: any) => (msg.content ?? "").toLowerCase().includes(q));
                      return matches.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4">لا نتائج مطابقة</p>
                      ) : matches.map((msg: any) => (
                        <div key={msg.id} className="rounded-lg border border-border bg-background p-3 text-sm">
                          <div className="text-xs text-muted-foreground mb-1">{formatDateTime(msg.sentAt)}</div>
                          <div className="line-clamp-3">{msg.content}</div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              </DrawerContent>
            </Drawer>
          </div>
        )}
      </div>
      {/* ═══════════ END MOBILE LAYOUT ═══════════ */}

      {/* ═══════════ DESKTOP LAYOUT (hidden lg:flex) ═══════════ */}
      <div className="hidden lg:flex lg:flex-col lg:flex-1 lg:overflow-hidden">
      {/* رأس مضغوط بسطر واحد — كل بكسل عمودي هنا يُسرق من المحادثات نفسها */}
      <div className="shrink-0 px-3 pb-2">
        <div className="flex h-11 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="text-base font-bold text-foreground">صندوق الوارد</h1>
            {totalUnread > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.7rem] font-bold text-primary-foreground">
                {totalUnread}
              </span>
            )}
            <span className="hidden items-center gap-1.5 text-[0.7rem] text-muted-foreground lg:inline-flex">
              <span className={cn("h-1.5 w-1.5 rounded-full", realtimeStatus === "live" ? "bg-emerald-500" : "bg-muted-foreground")} />
              {realtimeStatus === "live" ? "مباشر" : "إعادة اتصال"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden lg:block"><NotificationCenter /></span>
            {canCreate ? (
              <button onClick={() => setShowNewConv(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
                <Plus size={16} /> محادثة جديدة
              </button>
            ) : (
              <button disabled title="ليس لديك صلاحية إنشاء المحادثات"
                className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-lg bg-primary/40 px-3.5 text-sm font-semibold text-primary-foreground opacity-50">
                <Plus size={16} /> محادثة جديدة
              </button>
            )}
          </div>
        </div>

        {/* تنبيهات بسطر واحد نحيف — لا كتل متكدسة */}
        {!hasConnectedMetaChannels && (
          <div className="mb-1.5 flex h-9 items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs text-amber-900">
            <span className="truncate">لا توجد قنوات متصلة بعد — اربط واتساب من التكاملات.</span>
            <Link href="/integrations">
              <span className="shrink-0 rounded-md bg-amber-900 px-2.5 py-1 text-[0.7rem] font-semibold text-white hover:bg-amber-800">التكاملات</span>
            </Link>
          </div>
        )}
        {pointsAlert && <div className="mb-1.5">{pointsAlert}</div>}
        {isError && (
          <div className="mb-1.5 flex h-9 items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 text-xs text-destructive">
            <span className="truncate">تعذّر تحميل المحادثات</span>
            <button onClick={() => refetch()} className="shrink-0 text-[0.7rem] font-semibold underline">إعادة المحاولة</button>
          </div>
        )}
      </div>

      <div className="flex w-full min-h-0 flex-1 gap-3 overflow-hidden px-0 pb-[calc(5.75rem+var(--app-safe-bottom))] sm:px-3 lg:pb-0">
        <div className={cn(
          "flex min-h-0 shrink-0 self-stretch flex-col overflow-hidden rounded-xl border border-border bg-card",
          "w-full lg:w-[360px] xl:w-[380px]",
          mobileView === "detail" ? "hidden lg:flex" : "flex"
        )}>
          <div className="shrink-0 border-b border-border p-2.5">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search size={15} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="inbox-search"
                  name="inboxSearch"
                  aria-label="بحث في المحادثات"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="بحث في المحادثات..."
                  className="h-9 w-full rounded-lg border border-input bg-background pe-9 ps-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowMobileFilters(true)}
                className={cn(
                  "relative inline-flex h-9 shrink-0 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors",
                  activeFilterCount > 0 ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:bg-muted",
                )}
              >
                تصفية
                {activeFilterCount > 0 && (
                  <span className="ms-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-bold text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>

            <Drawer open={showMobileFilters} onOpenChange={setShowMobileFilters}>
              <DrawerContent className="max-h-[88vh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <DrawerHeader className="text-start">
                  <DrawerTitle>تصفية المحادثات</DrawerTitle>
                  <DrawerDescription>اضبط طريقة عرض صندوق الوارد.</DrawerDescription>
                </DrawerHeader>
                <div className="space-y-5 px-4 pb-4">
                  <section className="space-y-2">
                    <div className="text-xs font-bold text-muted-foreground">العروض السريعة</div>
                    <div className="flex flex-wrap gap-2">
                      {SAVED_VIEWS.map((view) => (
                        <button
                          key={view.value}
                          type="button"
                          onClick={() => {
                            setViewFilter(view.value);
                            if (view.value === "closed") setStatusFilter("");
                          }}
                          className={cn(
                            "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                            viewFilter === view.value ? "bg-foreground text-background" : "border border-border bg-card text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {view.label}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="space-y-2">
                    <div className="text-xs font-bold text-muted-foreground">العروض المحفوظة</div>
                    <div className="space-y-1">
                      {savedViews.length > 0 ? (
                        savedViews.map((view) => (
                          <button
                            key={view.id}
                            type="button"
                            onClick={() => applySavedView(view)}
                            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                          >
                            <span>{view.name}</span>
                            {view.isPinned && <span className="text-xs text-primary">مثبت</span>}
                          </button>
                        ))
                      ) : (
                        <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                          لا توجد عروض محفوظة بعد. أنشئ عرضك الأول.
                        </p>
                      )}
                    </div>
                    {canWriteSavedViews && (
                      <button
                        type="button"
                        onClick={() => createSavedView.mutate()}
                        disabled={createSavedView.isPending}
                        className="w-full rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        + عرض محفوظ جديد
                      </button>
                    )}
                  </section>

                  <section className="space-y-2">
                    <div className="text-xs font-bold text-muted-foreground">الحالة</div>
                    <div className="flex flex-wrap gap-2">
                      {CONV_STATUSES.map((s) => (
                        <button key={s.value} onClick={() => setStatusFilter(s.value)}
                          className={cn("rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                            statusFilter === s.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                          {s.label}
                          {s.value && counts[s.value] ? ` (${counts[s.value]})` : ""}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="grid grid-cols-1 gap-3">
                    <label className="block text-xs font-bold text-muted-foreground" htmlFor="mobile-channel-filter">القناة</label>
                    <select id="mobile-channel-filter" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none">
                      <option value="">كل القنوات</option>
                      {Object.entries(channelLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>

                    <label className="block text-xs font-bold text-muted-foreground" htmlFor="mobile-assignee-filter">المسؤول</label>
                    <select id="mobile-assignee-filter" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none">
                      <option value="">كل الموظفين</option>
                      <option value="unassigned">غير مُعيَّن</option>
                      {members.map((m: any) => <option key={m.membershipId ?? m.id} value={m.membershipId ?? m.id}>{m.name}</option>)}
                    </select>

                    <label className="block text-xs font-bold text-muted-foreground" htmlFor="mobile-sort-mode">الترتيب</label>
                    <select id="mobile-sort-mode" value={sortMode} onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none">
                      <option value="newest">الأحدث</option>
                      <option value="oldest">الأقدم</option>
                      <option value="priority">الأعلى أولوية</option>
                      <option value="sla">SLA منتهي</option>
                    </select>
                  </section>

                  <section className="rounded-xl border border-border bg-muted/30 p-3">
                    <button
                      type="button"
                      onClick={() => { setBulkMode((value) => !value); setSelectedBulk([]); }}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-sm font-semibold transition-colors",
                        bulkMode ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-background text-foreground hover:bg-muted",
                      )}
                    >
                      {bulkMode ? "إلغاء التحديد المتعدد" : "تحديد متعدد"}
                    </button>
                  </section>
                </div>
              </DrawerContent>
            </Drawer>
          </div>

          <div className="flex-1 overflow-y-auto">
            {bulkMode && (
              <div className="m-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary shadow-sm">
                وضع التحديد المتعدد مفعّل — استخدم زر إلغاء التحديد للعودة إلى فتح المحادثات.
              </div>
            )}
            {bulkMode && selectedBulk.length > 0 && (
              <div className="sticky top-0 z-10 m-2 p-2 rounded-lg bg-primary text-primary-foreground shadow-sm flex items-center justify-between gap-2 text-xs">
                <span>{selectedBulk.length} محدد</span>
                <div className="flex gap-1">
                  <button className="px-2 py-1 rounded bg-white/15">إسناد</button>
                  <button className="px-2 py-1 rounded bg-white/15">إغلاق</button>
                  <button className="px-2 py-1 rounded bg-white/15">وسم</button>
                </div>
              </div>
            )}
            {isLoading ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm animate-pulse">جار التحميل...</div>
            ) : sortedList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
                <span className="text-2xl">📭</span>
                <span>لا توجد محادثات</span>
              </div>
            ) : (
              sortedList.map((c: any) => (
                <button key={c.id} onClick={() => bulkMode ? toggleBulk(c.id) : selectConv(c)} className={cn(
                  "group relative w-full flex items-start gap-3 px-3 py-3 border-b border-border/40 transition-colors text-start",
                  selectedConvId === c.id ? "bg-primary/[.07]" : "hover:bg-muted/40",
                  selectedBulk.includes(c.id) && "bg-primary/10"
                )}>
                  {selectedConvId === c.id && <span className="absolute inset-y-1.5 start-0 w-[3px] rounded-e bg-primary" />}
                  {bulkMode ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-sm font-black shadow-sm",
                        selectedBulk.includes(c.id)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-primary/70 bg-background text-transparent",
                      )}
                    >
                      ✓
                    </span>
                  ) : (
                    <span className="relative mt-0.5 shrink-0">
                      <ContactInitials name={c.contactName} size={40} />
                      <span className="absolute -bottom-0.5 -start-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-card ring-2 ring-card">
                        {c.channel?.includes("whatsapp") ? <FaWhatsapp size={13} className="text-[#25D366]" />
                          : c.channel === "instagram" ? <FaInstagram size={13} className="text-[#E1306C]" />
                          : c.channel === "messenger" ? <FaFacebookMessenger size={13} className="text-[#0084FF]" />
                          : <ChannelBadge channel={c.channel} />}
                      </span>
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className={cn("truncate text-[0.9rem]", c.unreadCount > 0 ? "font-bold text-foreground" : "font-semibold text-foreground/90")}>
                            {c.contactName ?? "عميل غير معروف"}
                          </span>
                          <DisplayIdBadge value={c.displayId} />
                        </span>
                        {c.contactPhone && <span dir="ltr" className="block truncate text-[0.72rem] text-muted-foreground">{c.contactPhone}</span>}
                      </span>
                      <span className={cn("shrink-0 text-[0.7rem]", c.unreadCount > 0 ? "font-semibold text-primary" : "text-muted-foreground")}>
                        {timeAgo(c.lastMessageAt ?? c.createdAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className={cn("truncate text-[0.8rem] leading-5", c.unreadCount > 0 ? "text-foreground/80" : "text-muted-foreground")}>
                        {c.lastMessage ?? c.subject ?? "—"}
                      </span>
                      {c.unreadCount > 0 && (
                        <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[0.7rem] font-bold text-primary-foreground">
                          {c.unreadCount}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <CompactStatusChip status={normalizeConversationStatus(c.status, c.lifecycleState)} />
                      <AssignmentChip
                        member={c.assignedMembershipId ? memberByMembershipId.get(String(c.assignedMembershipId)) : null}
                        membershipId={c.assignedMembershipId}
                        compact
                      />
                      {c.needsHuman && (
                        <span className="rounded-full bg-amber-100 px-2 py-px text-[0.68rem] font-bold text-amber-800">يحتاج تدخل</span>
                      )}
                      {c.priority && c.priority !== "normal" && <PriorityBadge priority={c.priority} />}
                      {c.ticketNumber && (
                        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-px text-[0.68rem] font-medium text-amber-700">
                          تذكرة #{c.ticketNumber}
                        </span>
                      )}
                      {c.unreadCount > 0 && c.lastMessageAt && new Date(c.lastMessageAt).getTime() < Date.now() - defaultSlaMinutes * 60 * 1000 && (
                        <span className="rounded border border-red-200 bg-red-50 px-1.5 py-px text-[0.68rem] text-red-700">SLA متجاوز</span>
                      )}
                    </div>
                    {normalizeConversationLabels(c.labels).length > 0 && (
                      <div className="mt-1">
                        <LabelsRow labels={normalizeConversationLabels(c.labels)} />
                      </div>
                    )}
                  </div>
                </button>
              ))
            )}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 border-t border-border/40 px-4 py-3 text-xs text-muted-foreground">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-40"
                >
                  السابق
                </button>
                <span>صفحة {page} من {totalPages} ({totalConversations} محادثة)</span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-40"
                >
                  التالي
                </button>
              </div>
            )}
          </div>
        </div>

        <div className={cn(
          "me-0 flex min-h-0 min-w-0 self-stretch flex-col overflow-hidden rounded-xl border border-border bg-card lg:h-full lg:flex-[1_1_720px] lg:max-w-[920px]",
          mobileView === "list" && !selectedConvId ? "hidden lg:flex" : "flex",
          mobileView === "list" && selectedConvId ? "hidden lg:flex" : ""
        )}>
          {!selectedConvId ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground text-sm">
              <span className="text-4xl">💬</span>
              <span>اختر محادثة من القائمة لعرض تفاصيلها</span>
            </div>
          ) : detailLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm animate-pulse">جار التحميل...</div>
          ) : !conv ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              تعذّر تحميل المحادثة
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-border px-3 py-2 sm:px-4">
                <div className="flex min-w-0 items-center gap-2">
                  <button onClick={() => setMobileView("list")} className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden">
                    ← رجوع
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate font-semibold text-foreground">{conv.contactName ?? "عميل غير معروف"}</div>
                      {conv.contactPhone && <div dir="ltr" className="shrink-0 text-xs text-muted-foreground">{conv.contactPhone}</div>}
                    </div>
                    {conv.subject && (
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        <span className="font-medium">الموضوع: </span>{conv.subject}
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <DisplayIdBadge value={conv.displayId} />
                      <ChannelBadge channel={conv.channel} />
                      <CompactStatusChip status={conversationUnifiedStatus} />
                      <AssignmentChip member={assignedConversationMember} membershipId={conv.assignedMembershipId} />
                    </div>
                    {conversationLabels.length > 0 && (
                      <div className="mt-1">
                        <LabelsRow labels={conversationLabels} />
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <CompactChannelBadge channel={conv.channel} />
                    <PriorityDot priority={conv.priority} />
                    <CompactStatusChip status={conversationUnifiedStatus} />
                    {showAgentControls && agentBadge && (
                      <div className="flex items-center gap-1">
                        <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap", agentBadge.className)}>
                          {agentBadge.label}
                        </span>
                        {canManageConversationAgent && (
                          <button
                            onClick={() => changeAgentStatus.mutate({
                              convId: conv.id,
                              status: agentStatusAction,
                            })}
                            disabled={changeAgentStatus.isPending}
                            className={cn(
                              "px-2 py-0.5 rounded-full text-xs font-medium border disabled:opacity-50",
                              needsAgentReactivation
                                ? "bg-green-600 text-white border-green-600 hover:bg-green-700"
                                : "bg-muted text-muted-foreground hover:bg-muted/80 border-border",
                            )}
                          >
                            {needsAgentReactivation ? "إعادة للوكيل" : agentStatus === "active" ? "أوقف" : "أعد الوكيل"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex min-w-0 items-center gap-2">
                  <div className="flex shrink-0 items-center gap-1.5">
                    {canResolve && statusActions[0] && (
                      <button
                        key={statusActions[0].next}
                        onClick={() => changeStatus.mutate({ convId: conv.id, status: statusActions[0].next })}
                        disabled={changeStatus.isPending}
                        className="rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted/80 disabled:opacity-50"
                      >
                        {statusActions[0].label}
                      </button>
                    )}

                    {waLink ? (
                      <a href={waLink} target="_blank" rel="noopener noreferrer"
                        className="rounded-md border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 transition-colors hover:bg-green-100">
                        واتساب
                      </a>
                    ) : (
                      <button disabled title="لا يوجد رقم واتساب لهذا العميل"
                        className="cursor-not-allowed rounded-md border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground opacity-50">
                        واتساب
                      </button>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label="إجراءات المحادثة"
                          className="rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-bold text-foreground transition-colors hover:bg-muted/70">
                          ···
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" sideOffset={6} className="w-60">
                        {canAssign && (
                          <div className="px-2 py-1.5">
                            <label htmlFor="inbox-conversation-assignee" className="text-xs font-medium text-muted-foreground">المسؤول</label>
                            <select
                              id="inbox-conversation-assignee"
                              name="conversationAssignee"
                              aria-label="تعيين المحادثة إلى موظف"
                              value={conv.assignedMembershipId ?? ""}
                              onChange={(e) => assignConv.mutate({ convId: conv.id, membershipId: e.target.value || null })}
                              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none">
                              <option value="">غير مُعيَّن</option>
                              {members.map((m: any) => (
                                <option key={m.membershipId ?? m.id} value={m.membershipId ?? m.id}>
                                  {`${m.name} · ${resolvePresence(m).label}`}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {(canAssign || statusActions.length > 1 || conv.needsHuman || ticket) && <div className="-mx-1 my-1 h-px bg-muted" />}

                        {canResolve && statusActions.slice(1).map((action) => (
                          <DropdownMenuItem key={action.next} className="cursor-pointer text-start" onSelect={() => changeStatus.mutate({ convId: conv.id, status: action.next })}>
                            {action.label}
                          </DropdownMenuItem>
                        ))}
                        {canManageConversationAgent && needsAgentReactivation && (
                          <DropdownMenuItem
                            className="cursor-pointer text-start font-medium text-green-700 focus:text-green-800"
                            onSelect={() => changeAgentStatus.mutate({ convId: conv.id, status: "active" })}
                          >
                            إعادة للوكيل
                          </DropdownMenuItem>
                        )}
                        {conv.needsHuman && (
                          <div className="px-2 py-1.5 text-sm font-medium text-amber-700">
                            يحتاج تدخل
                          </div>
                        )}
                        {ticket && (
                          <DropdownMenuItem asChild className="cursor-pointer text-start">
                            <a href={`/tickets?id=${ticket.id}`}>تذكرة #{ticket.number}</a>
                          </DropdownMenuItem>
                        )}

                        <div className="-mx-1 my-1 h-px bg-muted" />

                        {canCreateTicket ? (
                          <DropdownMenuItem className="cursor-pointer text-start" onSelect={() => setQuickCreate("ticket")}>
                            🎫 تذكرة
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem disabled title="ليس لديك صلاحية إنشاء تذاكر" className="text-start">
                            🎫 تذكرة
                          </DropdownMenuItem>
                        )}
                        {canCreateTask ? (
                          <DropdownMenuItem className="cursor-pointer text-start" onSelect={() => setQuickCreate("task")}>
                            ✅ مهمة
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem disabled title="ليس لديك صلاحية إنشاء مهام" className="text-start">
                            ✅ مهمة
                          </DropdownMenuItem>
                        )}
                        {canCreateFollowup && conv.contactId ? (
                          <DropdownMenuItem className="cursor-pointer text-start" onSelect={() => setQuickCreate("followup")}>
                            🔔 متابعة
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            disabled
                            title={!conv.contactId ? "يجب ربط المحادثة بعميل قبل إنشاء متابعة" : "ليس لديك صلاحية إنشاء متابعات"}
                            className="text-start">
                            🔔 متابعة
                          </DropdownMenuItem>
                        )}
                        {canCreateOpportunity ? (
                          <DropdownMenuItem className="cursor-pointer text-start" onSelect={() => setQuickCreate("opportunity")}>
                            💡 فرصة
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem disabled title="ليس لديك صلاحية إنشاء الفرص" className="text-start">
                            💡 فرصة
                          </DropdownMenuItem>
                        )}
                        {canCreateOrder && conv.contactId ? (
                          <DropdownMenuItem className="cursor-pointer text-start" onSelect={() => setQuickCreate("order")}>
                            📦 طلب
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            disabled
                            title={!conv.contactId ? "يجب ربط المحادثة بعميل قبل إنشاء طلب" : "ليس لديك صلاحية إنشاء الطلبات"}
                            className="text-start">
                            📦 طلب
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem disabled title="سيتم تفعيل هذا الإجراء في مرحلة لاحقة" className="text-start">
                          💰 دفعة
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="min-w-0 flex-1 overflow-x-auto">
                    <div className="flex w-max gap-1 rounded-lg bg-muted/50 p-1">
                      {[
                        ["conversation", "المحادثة"],
                        ["notes", "ملاحظات"],
                        ["customer", "العميل"],
                        ["timeline", "السجل"],
                      ].map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            setDetailTab(key as typeof detailTab);
                            if (key === "notes") setMessageMode("note");
                            if (key === "conversation") setMessageMode("reply");
                          }}
                          className={cn(
                            "shrink-0 rounded-md px-2 py-1 text-[0.7rem] font-medium sm:px-2.5 sm:text-xs",
                            detailTab === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                  </div>
                </div>
              </div>
              </div>
              {conv && !showAgentControls && conv.channelAccountId && currentChannelAccount && !currentChannelAccount.defaultAgentId && canManageConversationAgent && (
                <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-100 text-amber-700 text-xs">
                  <AlertTriangle size={13} className="shrink-0" />
                  <span>القناة بلا وكيل افتراضي —</span>
                  <Link to="/integrations" className="font-bold underline">اضبطه من إعدادات القنوات</Link>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 space-y-3">
                {detailTab === "customer" ? (
                  <div className="grid md:grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-border bg-background p-4 space-y-2">
                      <div className="text-xs text-muted-foreground">العميل</div>
                      <div className="font-semibold">{conv.contactName ?? "عميل غير معروف"}</div>
                      <div className="text-muted-foreground">{conv.contactPhone ?? "لا يوجد رقم محفوظ"}</div>
                      <div className="text-muted-foreground">{conv.contactCompany ?? "لا توجد شركة"}</div>
                    </div>
                    <div className="rounded-xl border border-border bg-background p-4 space-y-2">
                      <div className="text-xs text-muted-foreground">القنوات المرتبطة</div>
                      {contactChannels.length === 0 ? (
                        <div className="text-muted-foreground">لا توجد قنوات محفوظة</div>
                      ) : contactChannels.map((channel: any) => (
                        <div key={channel.id} className="flex justify-between gap-2">
                          <span>{channel.channelType}</span>
                          <span dir="ltr" className="text-muted-foreground">{channel.identifier}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : detailTab === "timeline" ? (
                  <div className="space-y-2">
                    {timelineMessages.length === 0 ? (
                      <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">لا يوجد سجل بعد</div>
                    ) : timelineMessages.map((msg: any) => (
                      <div key={msg.id} className="rounded-lg border border-border bg-background p-3 text-sm">
                        <div className="text-xs text-muted-foreground mb-1">{formatDateTime(msg.sentAt)} · {msg.senderName ?? (msg.senderType === "customer" ? conv.contactName ?? "العميل" : msg.senderType === "agent" ? "الوكيل الذكي" : msg.senderType)}</div>
                        <div className="line-clamp-2">{msg.isPrivateNote ? "ملاحظة داخلية" : msg.content}</div>
                      </div>
                    ))}
                  </div>
                ) : visibleMessages.length === 0 && (
                  <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">
                    {detailTab === "notes" ? "لا توجد ملاحظات داخلية بعد" : "لا توجد رسائل بعد"}
                  </div>
                )}
                {(detailTab === "conversation" || detailTab === "notes") && visibleMessages.map((msg: any) => {
                  const isOutbound = msg.direction === "outbound";
                  const isInternal = msg.direction === "internal" || msg.isPrivateNote;
                  return (
                    <div key={msg.id} className={cn("flex", isInternal ? "justify-center" : isOutbound ? "justify-start" : "justify-end")}>
                      {isInternal ? (
                        <div className="max-w-[85%] break-words rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm italic text-yellow-800 [overflow-wrap:anywhere]">
                          <div className="flex items-center gap-1 mb-1 not-italic font-medium text-yellow-700">
                            <span>🔒</span><span>ملاحظة داخلية</span>
                            {msg.senderName && <span className="text-yellow-600">— {msg.senderName}</span>}
                          </div>
                          <div>{msg.content}</div>
                          <div className="text-xs mt-1 opacity-60">{formatDateTime(msg.sentAt)}</div>
                        </div>
                      ) : (
                        <div className={cn("max-w-[80%] break-words rounded-xl px-3 py-2 text-base [overflow-wrap:anywhere]",
                          isOutbound
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : "bg-muted text-foreground rounded-bl-sm")}>
                          {msg.source === "paste" && (
                            <div className="text-xs opacity-70 mb-1">📋 مستورد بالنسخ</div>
                          )}
                          {selectedConvId && (
                            <MessageAttachments conversationId={selectedConvId} messageId={msg.id} attachments={msg.attachments} />
                          )}
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                          <div className={cn("text-xs mt-1 opacity-60 flex items-center gap-1 justify-end")}>
                            {msg.senderName && <span>{msg.senderName}</span>}
                            <span>·</span>
                            <span>{formatDateTime(msg.sentAt)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {canUseAI && selectedConvId && (
                <div className="shrink-0 border-t border-border px-3 py-2 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    المساعد يقترح فقط، والموظف يقرر الإرسال.
                  </p>
                  <div className="flex gap-1.5 flex-wrap">
                    <button onClick={runAISummarize} disabled={aiLoading}
                      className="px-2.5 py-1 text-xs font-medium rounded-md bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 disabled:opacity-50 transition-colors">
                      🤖 لخص المحادثة
                    </button>
                    <button onClick={runAIDraft} disabled={aiLoading}
                      className="px-2.5 py-1 text-xs font-medium rounded-md bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 disabled:opacity-50 transition-colors">
                      ✍️ اقترح رد
                    </button>
                    <button onClick={runAIClassify} disabled={aiLoading}
                      className="px-2.5 py-1 text-xs font-medium rounded-md bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 disabled:opacity-50 transition-colors">
                      🏷️ صنّف الطلب
                    </button>
                    <button onClick={runAISuggest} disabled={aiLoading}
                      className="px-2.5 py-1 text-xs font-medium rounded-md bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 disabled:opacity-50 transition-colors">
                      💡 اقترح الخطوة التالية
                    </button>
                    {aiPanel && (
                      <button onClick={() => { setAiPanel(null); setAiSummary(null); setAiDraft(null); setAiClassify(null); setAiSuggestions([]); setAiError(null); }}
                        className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded-md bg-muted border border-border me-auto">
                        ✕ إغلاق
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {aiLoading && (
                      <div className="text-xs text-purple-600 animate-pulse">الذكاء الاصطناعي يعمل...</div>
                    )}
                    {providerStatus && (
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded font-medium ms-auto",
                        isProviderLive(providerStatus)
                          ? "bg-green-100 text-green-700"
                          : providerStatus.fallbackMode
                            ? "bg-orange-100 text-orange-700"
                            : "bg-yellow-100 text-yellow-700"
                      )}>
                        {isProviderLive(providerStatus)
                          ? `🟢 ${providerLiveLabel(providerStatus)}`
                          : "🟡 المساعد غير متاح مؤقتاً"}
                      </span>
                    )}
                  </div>
                  {aiError && (
                    <div className="text-xs text-destructive bg-red-50 border border-red-200 rounded-lg px-3 py-2">{aiError}</div>
                  )}
                  {aiPanel === "summary" && aiSummary && (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 space-y-1">
                      <div className="text-xs font-semibold text-purple-700">ملخص المحادثة</div>
                      <p className="text-xs text-purple-900 whitespace-pre-wrap leading-relaxed">{aiSummary}</p>
                    </div>
                  )}
                  {aiPanel === "draft" && aiDraft && (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 space-y-2">
                      <div className="text-xs font-semibold text-purple-700">مسودة الرد (للمراجعة فقط — لن تُرسل تلقائياً)</div>
                      <p className="text-xs text-purple-900 whitespace-pre-wrap leading-relaxed">{aiDraft}</p>
                      <button
                        onClick={() => { setMessageText(aiDraft); setMessageMode("reply"); setAiPanel(null); setAiDraft(null); }}
                        className="px-3 py-1 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                      >
                        استخدام الرد في صندوق الكتابة
                      </button>
                    </div>
                  )}
                  {aiPanel === "classify" && aiClassify && (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 space-y-1">
                      <div className="text-xs font-semibold text-purple-700">تصنيف المحادثة</div>
                      <div className="flex gap-2 flex-wrap mt-1">
                        {aiClassify.category != null && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">{formatAiCategory(aiClassify.category)}</span>}
                        {aiClassify.priority != null && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{formatAiPriority(aiClassify.priority)}</span>}
                        {aiClassify.sentiment != null && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">{formatAiSentiment(aiClassify.sentiment)}</span>}
                        {Array.isArray(aiClassify.tags) && aiClassify.tags.map((t: unknown, i: number) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{formatAiTag(t)}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {aiPanel === "suggest" && aiSuggestions.length > 0 && (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 space-y-2">
                      <div className="text-xs font-semibold text-purple-700">اقتراحات (تحتاج اعتماداً بشرياً)</div>
                      {aiSuggestions.map((s: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-purple-900">
                          <span className="text-purple-400 mt-0.5">•</span>
                          <div>
                            <span className="font-medium">{formatAiSuggestionLabel(s)}</span>
                            {s.reason && <span className="text-purple-600 ms-1">— {s.reason}</span>}
                          </div>
                        </div>
                      ))}
                      <p className="text-xs text-purple-500">راجع طلبات الاعتماد في صفحة وكلاء الذكاء الاصطناعي</p>
                    </div>
                  )}
                  {aiPanel === "suggest" && !aiLoading && aiSuggestions.length === 0 && !aiError && (
                    <div className="text-xs text-muted-foreground">لا توجد اقتراحات لهذه المحادثة</div>
                  )}
                </div>
              )}

              {canReply ? (
                <div className="shrink-0 px-3 py-2 border-t border-border space-y-2">
                  <div className="flex gap-1">
                    <button
                      onClick={() => setMessageMode("reply")}
                      className={cn("px-3 py-1 rounded-md text-xs font-medium transition-colors",
                        messageMode === "reply" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                      رد
                    </button>
                    <button
                      onClick={() => setMessageMode("note")}
                      className={cn("px-3 py-1 rounded-md text-xs font-medium transition-colors",
                        messageMode === "note" ? "bg-yellow-500 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                      🔒 ملاحظة داخلية
                    </button>
                    <div className="ms-auto">
                      <button
                        onClick={() => setShowImport(true)}
                        className="px-3 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 border border-border">
                        📋 لصق محادثة
                      </button>
                    </div>
                  </div>
                  {messageMode === "reply" && (
                    <div className="flex items-center gap-1.5 flex-wrap text-xs">
                      <button
                        type="button"
                        onClick={attachImageByUrl}
                        className="px-2.5 py-1 rounded-md bg-muted text-foreground border border-border hover:bg-muted/80"
                      >
                        إرفاق صورة (رابط)
                      </button>
                      <button disabled title="إدراج القوالب يحتاج قناة واتساب مربوطة"
                        className="px-2.5 py-1 rounded-md bg-muted/60 text-muted-foreground border border-dashed border-border cursor-not-allowed">
                        إدراج قالب
                      </button>
                      <span className="text-muted-foreground">رابط HTTPS عام · واتساب/إنستغرام/ماسنجر</span>
                      <span className="text-muted-foreground/70">· رفع ملف مباشر قريباً</span>
                    </div>
                  )}
                  {mediaUrl && messageMode === "reply" && (
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2 py-1.5 text-xs">
                      <img src={mediaUrl} alt="معاينة" className="h-10 w-10 rounded object-cover border border-border" />
                      <span className="flex-1 truncate" dir="ltr">{mediaUrl}</span>
                      <button type="button" onClick={() => setMediaUrl("")} className="text-destructive hover:underline">إزالة</button>
                    </div>
                  )}
                  {filteredQuickReplies.length > 0 && (
                    <div className="rounded-lg border border-border bg-background p-2 shadow-sm space-y-1">
                      {filteredQuickReplies.map((reply) => (
                        <button
                          key={reply.id}
                          type="button"
                          onClick={() => insertQuickReply(reply)}
                          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs text-start hover:bg-muted"
                        >
                          <span className="font-semibold">{reply.shortcut}</span>
                          <span className="flex-1 truncate text-muted-foreground">{reply.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <textarea
                      ref={desktopComposerRef}
                      id="inbox-message-text"
                      name="messageText"
                      aria-label={messageMode === "note" ? "ملاحظة داخلية" : "رد على المحادثة"}
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      rows={2}
                      placeholder={messageMode === "note" ? "اكتب ملاحظة داخلية (لا يراها العميل)..." : "اكتب ردك... (Enter للإرسال)"}
                      className={cn(
                        "flex-1 px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 resize-none max-h-40 overflow-y-auto",
                        messageMode === "note"
                          ? "border-yellow-300 bg-yellow-50 focus:ring-yellow-300/30"
                          : "border-input bg-background focus:ring-primary/30"
                      )}
                    />
                    <button
                      onClick={() => (messageText.trim() || mediaUrl.trim()) && sendMessage.mutate({
                        content: messageText,
                        isNote: messageMode === "note",
                        outboundMediaUrl: messageMode === "note" ? undefined : mediaUrl.trim() || undefined,
                      })}
                      disabled={(!messageText.trim() && !mediaUrl.trim()) || sendMessage.isPending}
                      className={cn(
                        "inline-flex items-center gap-1.5 self-end rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50",
                        messageMode === "note"
                          ? "bg-yellow-500 text-white hover:bg-yellow-600"
                          : "bg-primary text-primary-foreground hover:bg-primary/90"
                      )}>
                      <Send size={15} />
                      {sendMessage.isPending ? "..." : "إرسال"}
                    </button>
                  </div>
                  {sendMessage.isError && (
                    <p className="text-xs text-destructive">{(sendMessage.error as Error)?.message}</p>
                  )}
                </div>
              ) : (
                <div className="shrink-0 px-4 py-3 border-t border-border text-center text-xs text-yellow-700 bg-yellow-50">
                  ليس لديك صلاحية الرد على المحادثات
                </div>
              )}
            </>
          )}
        </div>
      </div>
      </div>
      {/* ═══════════ END DESKTOP LAYOUT ═══════════ */}

      <Modal open={showNewConv} onClose={() => setShowNewConv(false)} title="محادثة جديدة" size="sm">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">العميل</label>
            <select value={newConvForm.contactId} onChange={(e) => setNewConvForm({ ...newConvForm, contactId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="">اختر عميلاً (اختياري)</option>
              {contactsData?.contacts?.map((c: any) => <option key={c.id} value={c.id}>{c.name} {c.phone ? `— ${c.phone}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">القناة</label>
            <select value={newConvForm.channel} onChange={(e) => setNewConvForm({ ...newConvForm, channel: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {CHANNEL_CATALOG.map((c) => (
                <option key={c.type} value={c.type} disabled={c.status !== "active"}>
                  {c.label} {c.status !== "active" ? `(${channelStatusLabels[c.status] ?? c.status})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">الموضوع</label>
            <input value={newConvForm.subject} onChange={(e) => setNewConvForm({ ...newConvForm, subject: e.target.value })}
              placeholder="موضوع المحادثة (اختياري)"
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">الأولوية</label>
            <select value={newConvForm.priority} onChange={(e) => setNewConvForm({ ...newConvForm, priority: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {Object.entries(priorityLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {createConv.isError && (
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">
              {(createConv.error as Error)?.message ?? "حدث خطأ"}
            </div>
          )}
          <button onClick={() => createConv.mutate(newConvForm)} disabled={createConv.isPending}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {createConv.isPending ? "جارٍ الإنشاء..." : "إنشاء المحادثة"}
          </button>
        </div>
      </Modal>

      <Modal open={!!quickCreate} onClose={() => { setQuickCreate(null); setQuickForm({ title: "", priority: "normal", type: "manual", dueAt: "", notes: "" }); }}
        title={quickCreate === "ticket" ? "تذكرة جديدة" : quickCreate === "task" ? "مهمة جديدة" : quickCreate === "followup" ? "متابعة جديدة" : quickCreate === "opportunity" ? "فرصة جديدة" : "طلب جديد"}>
        <div className="space-y-3">
          {quickCreate === "order" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">القناة</label>
                  <select value={orderForm.channel} onChange={(e) => setOrderForm({ ...orderForm, channel: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                    {[["manual","يدوي"],["whatsapp","واتساب"],["phone","هاتف"],["website","موقع"],["walk_in","حضوري"]].map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">العملة</label>
                  <select value={orderForm.currency} onChange={(e) => setOrderForm({ ...orderForm, currency: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                    <option value="YER">ريال يمني</option>
                    <option value="SAR">ريال سعودي</option>
                    <option value="USD">دولار</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">ملاحظات</label>
                <textarea value={orderForm.notes} onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  rows={2} placeholder="تفاصيل الطلب..." />
              </div>
              <p className="text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">يمكن إضافة البنود بعد الإنشاء من صفحة الطلبات</p>
            </>
          ) : quickCreate === "opportunity" ? (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">عنوان الفرصة *</label>
                <input value={quickForm.title} onChange={(e) => setQuickForm({ ...quickForm, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="اسم الصفقة أو الفرصة..." />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">ملاحظات</label>
                <textarea value={quickForm.notes} onChange={(e) => setQuickForm({ ...quickForm, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  rows={2} placeholder="تفاصيل الفرصة..." />
              </div>
            </>
          ) : quickCreate === "followup" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">نوع المتابعة</label>
                  <select value={quickForm.type} onChange={(e) => setQuickForm({ ...quickForm, type: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                    {[["manual","يدوي"],["sales","مبيعات"],["support","دعم"],["collection","تحصيل"],["reminder","تذكير"]].map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">تاريخ المتابعة *</label>
                  <input type="datetime-local" value={quickForm.dueAt} onChange={(e) => setQuickForm({ ...quickForm, dueAt: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">ملاحظات</label>
                <textarea value={quickForm.notes} onChange={(e) => setQuickForm({ ...quickForm, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  rows={2} placeholder="ملاحظات المتابعة..." />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">{quickCreate === "ticket" ? "موضوع التذكرة *" : "عنوان المهمة *"}</label>
                <input value={quickForm.title} onChange={(e) => setQuickForm({ ...quickForm, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder={quickCreate === "ticket" ? "وصف المشكلة..." : "ماذا يجب فعله؟"} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">الأولوية</label>
                  <select value={quickForm.priority} onChange={(e) => setQuickForm({ ...quickForm, priority: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                    {[["low","منخفض"],["normal","عادي"],["high","عالي"],["urgent","عاجل"]].map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">الموعد النهائي</label>
                  <input type="date" value={quickForm.dueAt} onChange={(e) => setQuickForm({ ...quickForm, dueAt: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
                </div>
              </div>
            </>
          )}
          {conv && (
            <p className="text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
              مرتبطة بالمحادثة الحالية{conv.contactName ? ` — العميل: ${conv.contactName}` : ""}
            </p>
          )}
          {quickCreateMutation.isError && (
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">
              {(quickCreateMutation.error as Error)?.message}
            </div>
          )}
          <button
            onClick={() => {
              if (!quickCreate) return;
              const base = {
                contactId: conv?.contactId || undefined,
                conversationId: conv?.id || undefined,
              };
              if (quickCreate === "ticket") {
                quickCreateMutation.mutate({ type: "ticket", body: { ...base, title: quickForm.title, priority: quickForm.priority, dueAt: quickForm.dueAt ? new Date(quickForm.dueAt).toISOString() : undefined } });
              } else if (quickCreate === "task") {
                quickCreateMutation.mutate({ type: "task", body: { ...base, title: quickForm.title, priority: quickForm.priority, dueAt: quickForm.dueAt ? new Date(quickForm.dueAt).toISOString() : undefined } });
              } else if (quickCreate === "followup") {
                quickCreateMutation.mutate({ type: "followup", body: { ...base, type: quickForm.type, dueAt: quickForm.dueAt ? new Date(quickForm.dueAt).toISOString() : undefined, notes: quickForm.notes || undefined } });
              } else if (quickCreate === "opportunity") {
                quickCreateMutation.mutate({ type: "opportunity", body: { ...base, title: quickForm.title, notes: quickForm.notes || undefined } });
              } else {
                quickCreateMutation.mutate({ type: "order", body: { contactId: conv?.contactId || undefined, conversationId: conv?.id || undefined, channel: orderForm.channel, currency: orderForm.currency, notes: orderForm.notes || undefined } });
              }
            }}
            disabled={quickCreateMutation.isPending || (quickCreate === "opportunity" && !quickForm.title) || (quickCreate === "ticket" && !quickForm.title) || (quickCreate === "task" && !quickForm.title) || (quickCreate === "followup" && !quickForm.dueAt)}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {quickCreateMutation.isPending ? "جار الإنشاء..." : "إنشاء"}
          </button>
        </div>
      </Modal>

      <Modal open={showImport} onClose={() => setShowImport(false)} title="لصق محادثة" size="sm">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">الصق نص المحادثة من واتساب أو أي مصدر آخر. يمكنك فصل الرسائل بسطر فارغ.</p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={8}
            placeholder="الصق المحادثة هنا..."
            className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
          />
          {importConv.isError && (
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">
              {(importConv.error as Error)?.message ?? "حدث خطأ"}
            </div>
          )}
          <button
            onClick={() => selectedConvId && importText.trim() && importConv.mutate({ convId: selectedConvId, text: importText })}
            disabled={!importText.trim() || importConv.isPending}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {importConv.isPending ? "جارٍ الاستيراد..." : "استيراد المحادثة"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
