import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime, timeAgo, channelLabels, statusLabels, priorityLabels, channelStatusLabels, CHANNEL_CATALOG } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

const BASE = `${import.meta.env.BASE_URL}api`;

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const text = await res.text();
    try { const j = JSON.parse(text); throw new Error(j.error ?? text); } catch { throw new Error(text); }
  }
  return res.json();
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

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cn("text-xs px-1.5 py-0.5 rounded border font-medium", PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.normal)}>
      {priorityLabels[priority] ?? priority}
    </span>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const icons: Record<string, string> = {
    whatsapp_manual: "📱", whatsapp: "📱", whatsapp_api: "📱",
    website_widget: "💬", telegram: "✈️", instagram: "📷",
    messenger: "💬", voice: "📞", manual: "✍️", email: "📧", sms: "📩",
  };
  return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
      {icons[channel] ?? "💬"} {channelLabels[channel] ?? channel}
    </span>
  );
}

function isProviderLive(providerStatus: any): boolean {
  return (providerStatus?.provider === "vertex" || providerStatus?.provider === "gemini") && !providerStatus?.fallbackMode;
}

function providerLiveLabel(providerStatus: any): string {
  if (providerStatus?.provider === "vertex" && !providerStatus?.fallbackMode) return "Vertex AI مفعّل";
  if (providerStatus?.provider === "gemini" && !providerStatus?.fallbackMode) return "Gemini مفعّل";
  if (providerStatus?.fallbackMode) return "وضع تجريبي (Fallback)";
  return "وضع تجريبي";
}

export default function InboxPage() {
  const { hasPermission } = useAuth();
  const qc = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
  const canReadQuickReplies = hasPermission("quick_replies:read");
  const canWriteSavedViews = hasPermission("saved_views:write");
  const canReadSavedViews = hasPermission("saved_views:read");

  const [statusFilter, setStatusFilter] = useState("");
  const [viewFilter, setViewFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [messageText, setMessageText] = useState("");
  const [messageMode, setMessageMode] = useState<"reply" | "note">("reply");
  const [detailTab, setDetailTab] = useState<"conversation" | "notes" | "customer" | "timeline">("conversation");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
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

  const params = new URLSearchParams();
  if (viewFilter) params.set("view", viewFilter);
  if (statusFilter) params.set("status", statusFilter);
  if (searchQuery) params.set("search", searchQuery);
  if (channelFilter) params.set("channel", channelFilter);
  if (assigneeFilter) params.set("assignee", assigneeFilter);
  params.set("limit", "50");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["conversations", viewFilter, statusFilter, searchQuery, channelFilter, assigneeFilter],
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

  const createSavedView = useMutation({
    mutationFn: () => apiFetch("saved-views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `عرض محفوظ ${new Date().toLocaleTimeString("ar-YE", { hour: "2-digit", minute: "2-digit" })}`,
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
    mutationFn: ({ content, isNote }: { content: string; isNote: boolean }) =>
      apiFetch(`conversations/${selectedConvId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          direction: "outbound",
          isPrivateNote: isNote,
          contentType: isNote ? "note" : "text",
        }),
      }),
    onSuccess: () => { setMessageText(""); invalidateDetail(); },
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
  const counts: Record<string, number> = data?.counts ?? {};
  const members: any[] = membersData?.members ?? membersData?.users ?? [];
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
    if (e.key === "Enter" && !e.shiftKey && messageText.trim()) {
      e.preventDefault();
      sendMessage.mutate({ content: messageText, isNote: messageMode === "note" });
    }
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
  const filteredQuickReplies = messageText.trim().startsWith("/")
    ? quickReplies.filter((reply) => reply.shortcut?.startsWith(messageText.trim()) || reply.title?.includes(messageText.trim().slice(1))).slice(0, 6)
    : [];

  const statusActions = conv ? (STATUS_ACTIONS[conv.status] ?? []) : [];

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
    <div dir="rtl" className="flex flex-col h-screen overflow-hidden">
      <div className="shrink-0 px-4 pt-4 pb-0">
        <PageHeader
          title="صندوق الوارد"
          subtitle="إدارة جميع المحادثات مع العملاء"
          actions={
            canCreate ? (
              <button onClick={() => setShowNewConv(true)}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
                + محادثة جديدة
              </button>
            ) : (
              <button disabled title="ليس لديك صلاحية إنشاء المحادثات"
                className="px-4 py-2 rounded-lg bg-primary/40 text-primary-foreground text-sm font-semibold cursor-not-allowed opacity-50">
                + محادثة جديدة
              </button>
            )
          }
        />

        <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 scrollbar-none">
          {SAVED_VIEWS.map((view) => (
            <button
              key={view.value}
              type="button"
              onClick={() => {
                setViewFilter(view.value);
                if (view.value === "closed") setStatusFilter("");
              }}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors shrink-0",
                viewFilter === view.value ? "bg-foreground text-background" : "bg-card text-muted-foreground border border-border hover:bg-muted",
              )}
            >
              {view.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 scrollbar-none">
          {CONV_STATUSES.map((s) => (
            <button key={s.value} onClick={() => setStatusFilter(s.value)}
              className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0",
                statusFilter === s.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
              {s.label}
              {s.value && counts[s.value] ? ` (${counts[s.value]})` : ""}
            </button>
          ))}
        </div>

        {isError && (
          <div className="mb-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm flex items-center justify-between">
            <span>تعذّر تحميل المحادثات</span>
            <button onClick={() => refetch()} className="text-xs underline font-medium">إعادة المحاولة</button>
          </div>
        )}
      </div>

      <div className="flex flex-1 gap-0 overflow-hidden px-4 pb-4">
        <div className="hidden xl:flex flex-col w-72 shrink-0 rounded-xl border border-border bg-card overflow-hidden ml-3">
          <div className="p-3 border-b border-border">
            <div className="text-xs font-semibold text-muted-foreground mb-2">العروض المحفوظة</div>
            <div className="space-y-1">
              {SAVED_VIEWS.map((view) => (
                <button
                  key={view.value || "all"}
                  type="button"
                  onClick={() => setViewFilter(view.value)}
                  className={cn(
                    "w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-sm text-right transition-colors",
                    viewFilter === view.value ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground",
                  )}
                >
                  <span>{view.label}</span>
                </button>
              ))}
              {savedViews.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => applySavedView(view)}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-sm text-right hover:bg-muted text-foreground transition-colors"
                >
                  <span>{view.name}</span>
                  {view.isPinned && <span className="text-xs text-primary">مثبت</span>}
                </button>
              ))}
            </div>
            {canWriteSavedViews && (
              <button
                type="button"
                onClick={() => createSavedView.mutate()}
                disabled={createSavedView.isPending}
                className="mt-3 w-full px-3 py-2 rounded-lg border border-dashed border-border text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                + عرض محفوظ جديد
              </button>
            )}
          </div>

          <div className="p-3 space-y-3 overflow-y-auto">
            <button
              type="button"
              onClick={() => setShowAdvancedFilters((value) => !value)}
              className="w-full flex items-center justify-between text-sm font-medium"
            >
              <span>فلاتر متقدمة</span>
              <span>{showAdvancedFilters ? "−" : "+"}</span>
            </button>
            {showAdvancedFilters && (
              <div className="space-y-2">
                <label htmlFor="advanced-channel" className="block text-xs text-muted-foreground">القناة</label>
                <select id="advanced-channel" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}
                  className="w-full px-2 py-2 rounded-lg border border-input bg-background text-xs">
                  <option value="">كل القنوات</option>
                  {Object.entries(channelLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <label htmlFor="advanced-assignee" className="block text-xs text-muted-foreground">المسؤول</label>
                <select id="advanced-assignee" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}
                  className="w-full px-2 py-2 rounded-lg border border-input bg-background text-xs">
                  <option value="">كل الموظفين</option>
                  <option value="unassigned">بدون مسؤول</option>
                  {members.map((m: any) => <option key={m.membershipId ?? m.id} value={m.membershipId ?? m.id}>{m.name}</option>)}
                </select>
              </div>
            )}
            <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground leading-relaxed">
              المساعد يقترح فقط، والموظف يقرر الإرسال. الملاحظات الداخلية لا تظهر للعميل.
            </div>
          </div>
        </div>
        <div className={cn(
          "flex flex-col shrink-0 rounded-xl border border-border bg-card overflow-hidden",
          "w-full lg:w-96",
          mobileView === "detail" ? "hidden lg:flex" : "flex"
        )}>
          <div className="p-2 border-b border-border space-y-2">
            <input
              id="inbox-search"
              name="inboxSearch"
              aria-label="بحث في المحادثات"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث في المحادثات..."
              className="w-full px-3 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <div className="flex gap-1.5">
              <select id="inbox-channel-filter" name="inboxChannelFilter" aria-label="تصفية المحادثات حسب القناة" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}
                className="flex-1 px-2 py-1 rounded-lg border border-input bg-background text-xs focus:outline-none">
                <option value="">كل القنوات</option>
                {Object.entries(channelLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select id="inbox-assignee-filter" name="inboxAssigneeFilter" aria-label="تصفية المحادثات حسب الموظف" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}
                className="flex-1 px-2 py-1 rounded-lg border border-input bg-background text-xs focus:outline-none">
                <option value="">كل الموظفين</option>
                <option value="unassigned">غير مُعيَّن</option>
                {members.map((m: any) => <option key={m.membershipId ?? m.id} value={m.membershipId ?? m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <select value={sortMode} onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
                className="flex-1 px-2 py-1 rounded-lg border border-input bg-background text-xs focus:outline-none">
                <option value="newest">الأحدث</option>
                <option value="oldest">الأقدم</option>
                <option value="priority">الأعلى أولوية</option>
                <option value="sla">SLA منتهي</option>
              </select>
              <button
                type="button"
                onClick={() => { setBulkMode((value) => !value); setSelectedBulk([]); }}
                className={cn("px-2.5 py-1 rounded-lg border text-xs", bulkMode ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground")}
              >
                تحديد
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
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
                  "w-full flex flex-col gap-1 px-3 py-3 border-b border-border/50 transition-colors text-right",
                  selectedConvId === c.id ? "bg-primary/10 border-r-2 border-r-primary" : "hover:bg-muted/40",
                  selectedBulk.includes(c.id) && "bg-primary/10"
                )}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm text-foreground truncate">
                      {bulkMode && <span className="inline-flex w-4 h-4 rounded border border-border ml-1 align-middle items-center justify-center text-[10px]">{selectedBulk.includes(c.id) ? "✓" : ""}</span>}
                      {c.contactName ?? "عميل غير معروف"}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {c.unreadCount > 0 && (
                        <span className="text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 font-bold">{c.unreadCount}</span>
                      )}
                      <StatusBadge status={c.status} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground truncate max-w-[60%]">
                      {c.lastMessage ?? c.subject ?? "—"}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">{timeAgo(c.lastMessageAt ?? c.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ChannelBadge channel={c.channel} />
                    {c.priority && c.priority !== "normal" && <PriorityBadge priority={c.priority} />}
                    {c.ticketNumber && (
                      <span className="text-xs px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700 font-medium">
                        تذكرة #{c.ticketNumber}
                      </span>
                    )}
                    {c.unreadCount > 0 && c.lastMessageAt && (
                      <span className="text-xs px-1.5 py-0.5 rounded border border-red-200 bg-red-50 text-red-700">
                        {new Date(c.lastMessageAt).getTime() < Date.now() - defaultSlaMinutes * 60 * 1000 ? "SLA متجاوز" : "مهلة الرد"}
                      </span>
                    )}
                    {c.contactCompany && (
                      <span className="text-xs text-muted-foreground truncate">{c.contactCompany}</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className={cn(
          "flex flex-col flex-1 overflow-hidden rounded-xl border border-border bg-card mr-0 lg:mr-3",
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
              <div className="shrink-0 px-4 py-3 border-b border-border space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => setMobileView("list")} className="lg:hidden text-xs text-muted-foreground hover:text-foreground">
                    ← رجوع
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-foreground truncate">{conv.contactName ?? "عميل غير معروف"}</div>
                    {conv.contactPhone && <div className="text-xs text-muted-foreground">{conv.contactPhone}</div>}
                    {conv.contactCompany && <div className="text-xs text-muted-foreground">{conv.contactCompany}</div>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                    <ChannelBadge channel={conv.channel} />
                    <PriorityBadge priority={conv.priority} />
                    <StatusBadge status={conv.status} />
                    {ticket && (
                      <a
                        href={`/tickets?id=${ticket.id}`}
                        className="px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold hover:bg-amber-100"
                      >
                        تذكرة #{ticket.number}
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {canResolve && statusActions.map((action) => (
                    <button key={action.next}
                      onClick={() => changeStatus.mutate({ convId: conv.id, status: action.next })}
                      disabled={changeStatus.isPending}
                      className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted hover:bg-muted/80 border border-border transition-colors disabled:opacity-50">
                      {action.label}
                    </button>
                  ))}

                  {canAssign && (
                    <select
                      id="inbox-conversation-assignee"
                      name="conversationAssignee"
                      aria-label="تعيين المحادثة إلى موظف"
                      value={conv.assignedMembershipId ?? ""}
                      onChange={(e) => assignConv.mutate({ convId: conv.id, membershipId: e.target.value || null })}
                      className="px-2 py-1 rounded-md text-xs border border-input bg-background focus:outline-none">
                      <option value="">غير مُعيَّن</option>
                      {members.map((m: any) => (
                        <option key={m.membershipId ?? m.id} value={m.membershipId ?? m.id}>{m.name}</option>
                      ))}
                    </select>
                  )}

                  {waLink ? (
                    <a href={waLink} target="_blank" rel="noopener noreferrer"
                      className="px-2.5 py-1 rounded-md text-xs font-medium bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors">
                      📱 فتح واتساب يدوياً
                    </a>
                  ) : (
                    <button disabled title="لا يوجد رقم واتساب لهذا العميل"
                      className="px-2.5 py-1 rounded-md text-xs bg-muted text-muted-foreground border border-border cursor-not-allowed opacity-50">
                      📱 فتح واتساب يدوياً
                    </button>
                  )}

                  <div className="flex gap-1 mr-auto">
                    {canCreateTicket ? (
                      <button onClick={() => setQuickCreate("ticket")}
                        className="px-2 py-1 rounded-md text-xs bg-muted hover:bg-muted/70 text-foreground border border-border transition-colors">
                        🎫 تذكرة
                      </button>
                    ) : (
                      <button disabled title="ليس لديك صلاحية إنشاء تذاكر"
                        className="px-2 py-1 rounded-md text-xs bg-muted/50 text-muted-foreground border border-dashed border-border cursor-not-allowed opacity-60">
                        🎫 تذكرة
                      </button>
                    )}
                    {canCreateTask ? (
                      <button onClick={() => setQuickCreate("task")}
                        className="px-2 py-1 rounded-md text-xs bg-muted hover:bg-muted/70 text-foreground border border-border transition-colors">
                        ✅ مهمة
                      </button>
                    ) : (
                      <button disabled title="ليس لديك صلاحية إنشاء مهام"
                        className="px-2 py-1 rounded-md text-xs bg-muted/50 text-muted-foreground border border-dashed border-border cursor-not-allowed opacity-60">
                        ✅ مهمة
                      </button>
                    )}
                    {canCreateFollowup && conv.contactId ? (
                      <button onClick={() => setQuickCreate("followup")}
                        className="px-2 py-1 rounded-md text-xs bg-muted hover:bg-muted/70 text-foreground border border-border transition-colors">
                        🔔 متابعة
                      </button>
                    ) : (
                      <button
                        disabled
                        title={!conv.contactId ? "يجب ربط المحادثة بعميل قبل إنشاء متابعة" : "ليس لديك صلاحية إنشاء متابعات"}
                        className="px-2 py-1 rounded-md text-xs bg-muted/50 text-muted-foreground border border-dashed border-border cursor-not-allowed opacity-60">
                        🔔 متابعة
                      </button>
                    )}
                    {canCreateOpportunity ? (
                      <button onClick={() => setQuickCreate("opportunity")}
                        className="px-2 py-1 rounded-md text-xs bg-muted hover:bg-muted/70 text-foreground border border-border transition-colors">
                        💡 فرصة
                      </button>
                    ) : (
                      <button disabled title="ليس لديك صلاحية إنشاء الفرص"
                        className="px-2 py-1 rounded-md text-xs bg-muted/50 text-muted-foreground border border-dashed border-border cursor-not-allowed opacity-60">
                        💡 فرصة
                      </button>
                    )}
                    {canCreateOrder && conv.contactId ? (
                      <button onClick={() => setQuickCreate("order")}
                        className="px-2 py-1 rounded-md text-xs bg-muted hover:bg-muted/70 text-foreground border border-border transition-colors">
                        📦 طلب
                      </button>
                    ) : (
                      <button disabled
                        title={!conv.contactId ? "يجب ربط المحادثة بعميل قبل إنشاء طلب" : "ليس لديك صلاحية إنشاء الطلبات"}
                        className="px-2 py-1 rounded-md text-xs bg-muted/50 text-muted-foreground border border-dashed border-border cursor-not-allowed opacity-60">
                        📦 طلب
                      </button>
                    )}
                    <button disabled title="سيتم تفعيل هذا الإجراء في مرحلة لاحقة"
                      className="px-2 py-1 rounded-md text-xs bg-muted/50 text-muted-foreground border border-dashed border-border cursor-not-allowed opacity-60">
                      💰 دفعة
                    </button>
                  </div>
                </div>

                {conv.subject && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium">الموضوع: </span>{conv.subject}
                  </div>
                )}
                <div className="flex gap-1 pt-1 border-t border-border/60">
                  {[
                    ["conversation", "المحادثة"],
                    ["notes", "ملاحظات داخلية"],
                    ["customer", "معلومات العميل"],
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
                        "px-2.5 py-1 rounded-md text-xs font-medium",
                        detailTab === key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
                        <div className="text-xs text-muted-foreground mb-1">{formatDateTime(msg.sentAt)} · {msg.senderName ?? msg.senderType}</div>
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
                        <div className="max-w-[85%] px-3 py-2 rounded-xl text-xs bg-yellow-50 border border-yellow-200 text-yellow-800 italic">
                          <div className="flex items-center gap-1 mb-1 not-italic font-medium text-yellow-700">
                            <span>🔒</span><span>ملاحظة داخلية</span>
                            {msg.senderName && <span className="text-yellow-600">— {msg.senderName}</span>}
                          </div>
                          <div>{msg.content}</div>
                          <div className="text-xs mt-1 opacity-60">{formatDateTime(msg.sentAt)}</div>
                        </div>
                      ) : (
                        <div className={cn("max-w-[75%] px-3 py-2 rounded-xl text-sm",
                          isOutbound
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : "bg-muted text-foreground rounded-bl-sm")}>
                          {msg.source === "paste" && (
                            <div className="text-xs opacity-70 mb-1">📋 مستورد بالنسخ</div>
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
                        className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded-md bg-muted border border-border ml-auto">
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
                        "text-xs px-2 py-0.5 rounded font-medium mr-auto",
                        isProviderLive(providerStatus)
                          ? "bg-green-100 text-green-700"
                          : providerStatus.fallbackMode
                            ? "bg-orange-100 text-orange-700"
                            : "bg-yellow-100 text-yellow-700"
                      )}>
                        {isProviderLive(providerStatus)
                          ? `🟢 ${providerLiveLabel(providerStatus)}`
                          : providerStatus.fallbackMode
                            ? "🟠 وضع تجريبي (Fallback)"
                            : "🟡 وضع تجريبي"}
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
                        {aiClassify.category != null && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">{String(aiClassify.category)}</span>}
                        {aiClassify.priority != null && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{String(aiClassify.priority)}</span>}
                        {aiClassify.sentiment != null && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">{String(aiClassify.sentiment)}</span>}
                        {Array.isArray(aiClassify.tags) && aiClassify.tags.map((t: unknown, i: number) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{String(t)}</span>
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
                            <span className="font-medium">{s.label ?? s.action_type}</span>
                            {s.reason && <span className="text-purple-600 mr-1">— {s.reason}</span>}
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
                    <div className="mr-auto">
                      <button
                        onClick={() => setShowImport(true)}
                        className="px-3 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 border border-border">
                        📋 لصق محادثة
                      </button>
                    </div>
                  </div>
                  {messageMode === "reply" && (
                    <div className="flex items-center gap-1.5 flex-wrap text-xs">
                      <button disabled title="سيتم تفعيل رفع الملفات لاحقاً"
                        className="px-2.5 py-1 rounded-md bg-muted/60 text-muted-foreground border border-dashed border-border cursor-not-allowed">
                        إرفاق ملف
                      </button>
                      <button disabled title="إدراج القوالب يحتاج قناة واتساب مربوطة"
                        className="px-2.5 py-1 rounded-md bg-muted/60 text-muted-foreground border border-dashed border-border cursor-not-allowed">
                        إدراج قالب
                      </button>
                      <span className="text-muted-foreground">اكتب / لاختيار رد سريع</span>
                    </div>
                  )}
                  {filteredQuickReplies.length > 0 && (
                    <div className="rounded-lg border border-border bg-background p-2 shadow-sm space-y-1">
                      {filteredQuickReplies.map((reply) => (
                        <button
                          key={reply.id}
                          type="button"
                          onClick={() => insertQuickReply(reply)}
                          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs text-right hover:bg-muted"
                        >
                          <span className="font-semibold">{reply.shortcut}</span>
                          <span className="flex-1 truncate text-muted-foreground">{reply.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <textarea
                      id="inbox-message-text"
                      name="messageText"
                      aria-label={messageMode === "note" ? "ملاحظة داخلية" : "رد على المحادثة"}
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      rows={2}
                      placeholder={messageMode === "note" ? "اكتب ملاحظة داخلية (لا يراها العميل)..." : "اكتب ردك... (Enter للإرسال)"}
                      className={cn(
                        "flex-1 px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 resize-none",
                        messageMode === "note"
                          ? "border-yellow-300 bg-yellow-50 focus:ring-yellow-300/30"
                          : "border-input bg-background focus:ring-primary/30"
                      )}
                    />
                    <button
                      onClick={() => messageText.trim() && sendMessage.mutate({ content: messageText, isNote: messageMode === "note" })}
                      disabled={!messageText.trim() || sendMessage.isPending}
                      className={cn(
                        "px-4 rounded-lg text-sm font-medium transition-colors disabled:opacity-50",
                        messageMode === "note"
                          ? "bg-yellow-500 text-white hover:bg-yellow-600"
                          : "bg-primary text-primary-foreground hover:bg-primary/90"
                      )}>
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
