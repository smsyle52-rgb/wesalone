import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { formatDate, formatDateTime, timeAgo, cn, formatCurrency } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";

const BASE = `${import.meta.env.BASE_URL}api`;

const apiFetch = async (path: string, opts?: RequestInit) => {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const text = await res.text();
    try { const j = JSON.parse(text); throw new Error(j.error ?? text); } catch { throw new Error(text); }
  }
  return res.json();
};

const CHANNEL_LABELS: Record<string, string> = {
  phone: "هاتف", whatsapp: "واتساب", telegram: "تيليغرام",
  instagram: "إنستغرام", email: "بريد", widget: "ويدجت",
};

const CHANNEL_ICONS: Record<string, string> = {
  phone: "📞", whatsapp: "💬", telegram: "✈️",
  instagram: "📸", email: "📧", widget: "🌐",
};

const TIMELINE_ICONS: Record<string, string> = {
  contact_created: "👤", contact_updated: "✏️", channel_added: "📡",
  channel_updated: "🔄", note_added: "📝", tag_added: "🏷️",
  tag_removed: "🏷️", conversation_created: "💬", ticket_created: "🎫",
  order_created: "📦", payment_created: "💰",
  debt_created: "📋", debt_updated: "✏️", debt_paid: "✅",
  debt_status_changed: "🔄", debt_cancelled: "❌", debt_written_off: "🗑️",
  collection_note_added: "📌",
};

type Contact = {
  id: string; name: string; phone?: string | null; email?: string | null;
  city?: string | null; company?: string | null; tags: string[];
  totalOrders: number; totalSpent: string; createdAt: string; updatedAt: string;
};
type Channel = {
  id: string; channelType: string; identifier: string; isPrimary: boolean;
  isVerified: boolean; optedIn: boolean; createdAt: string;
};
type Note = {
  id: string; body: string; isPrivate: boolean; authorId?: string | null; createdAt: string; updatedAt: string;
};
type TimelineEvent = {
  id: string; eventType: string; title: string; description?: string | null; occurredAt: string;
};

function PermissionDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <span className="text-4xl">🔒</span>
      <p className="text-muted-foreground text-sm">ليس لديك صلاحية لعرض هذا العميل</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 bg-muted rounded" />
      <div className="h-4 w-64 bg-muted rounded" />
      <div className="h-32 bg-muted rounded-xl" />
      <div className="h-48 bg-muted rounded-xl" />
    </div>
  );
}

function DisabledAction({ label }: { label: string }) {
  return (
    <button
      disabled
      title="سيتم تفعيل هذا الإجراء في المرحلة التالية"
      className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted-foreground cursor-not-allowed opacity-50 flex items-center gap-1.5"
    >
      {label}
    </button>
  );
}

export default function ContactProfilePage({ contactId }: { contactId: string }) {
  const { hasPermission, user } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const canRead = hasPermission("contacts:read");
  const canUpdate = hasPermission("contacts:update");
  const canDelete = hasPermission("contacts:delete");
  const canManageChannels = hasPermission("contacts:manage_channels");
  const canManageNotes = hasPermission("contacts:manage_notes");
  const canCreateTicket = hasPermission("tickets:create");
  const canCreateTask = hasPermission("tasks:create");
  const canCreateFollowup = hasPermission("followups:create");
  const canCreateOpportunity = hasPermission("opportunities:create");
  const canCreateOrder = hasPermission("orders:create");
  const canCreatePayment = hasPermission("payments:create");
  const canReadPayments = hasPermission("payments:read");
  const canReadDebts = hasPermission("debts:read");
  const canCreateDebt = hasPermission("debts:create");
  const canUpdateDebt = hasPermission("debts:update");
  const canReadCollectionNotes = hasPermission("collection_notes:read");
  const canCreateCollectionNote = hasPermission("collection_notes:create");

  const [tab, setTab] = useState<"info" | "channels" | "notes" | "timeline" | "payments" | "debts">("info");
  const [showPayModal, setShowPayModal] = useState(false);
  const [payForm, setPayForm] = useState({ amount: "", currency: "YER", paymentMethodId: "", reference: "", notes: "" });
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Contact>>({});
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [channelForm, setChannelForm] = useState({ channelType: "phone", identifier: "", isPrimary: false });
  const [channelError, setChannelError] = useState("");
  const [noteText, setNoteText] = useState("");
  const [notePrivate, setNotePrivate] = useState(false);
  const [quickCreate, setQuickCreate] = useState<null | "ticket" | "task" | "followup" | "opportunity" | "order">(null);
  const [quickForm, setQuickForm] = useState({ title: "", priority: "normal", type: "manual", dueAt: "", notes: "" });
  const [orderForm, setOrderForm] = useState({ channel: "manual", currency: "YER", notes: "" });

  const { data: contactData, isLoading, isError, refetch } = useQuery<{ contact: Contact }>({
    queryKey: ["contact", contactId],
    queryFn: () => apiFetch(`contacts/${contactId}`),
    enabled: canRead,
  });

  const { data: channelsData } = useQuery<{ channels: Channel[] }>({
    queryKey: ["contact-channels", contactId],
    queryFn: () => apiFetch(`contacts/${contactId}/channels`),
    enabled: canRead && tab === "channels",
  });

  const { data: notesData } = useQuery<{ notes: Note[] }>({
    queryKey: ["contact-notes", contactId],
    queryFn: () => apiFetch(`contacts/${contactId}/notes`),
    enabled: canRead && tab === "notes",
  });

  const { data: timelineData } = useQuery<{ timeline: TimelineEvent[] }>({
    queryKey: ["contact-timeline", contactId],
    queryFn: () => apiFetch(`contacts/${contactId}/timeline`),
    enabled: canRead && tab === "timeline",
  });

  const { data: contactPaymentsData } = useQuery({
    queryKey: ["contact-payments", contactId],
    queryFn: () => apiFetch(`payments?contactId=${contactId}&limit=30`),
    enabled: canRead && canReadPayments && tab === "payments",
  });

  const { data: payMethodsData } = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => apiFetch("payment-methods"),
    enabled: showPayModal,
  });

  const { data: contactDebtsData, refetch: refetchDebts } = useQuery({
    queryKey: ["contact-debts", contactId],
    queryFn: () => apiFetch(`debts?contactId=${contactId}&limit=50`),
    enabled: canRead && canReadDebts && tab === "debts",
  });

  const [showDebtModal, setShowDebtModal] = useState(false);
  const [debtForm, setDebtForm] = useState({ amount: "", currency: "YER", dueAt: "", description: "" });
  const [debtError, setDebtError] = useState("");
  const [selectedDebtId, setSelectedDebtId] = useState<string | null>(null);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteForDebtId, setNoteForDebtId] = useState<string | null>(null);
  const [collectionNoteText, setCollectionNoteText] = useState("");
  const [collectionNoteError, setCollectionNoteError] = useState("");

  const { data: selectedDebtNotes } = useQuery({
    queryKey: ["debt-notes-contact", noteForDebtId],
    queryFn: () => apiFetch(`debts/${noteForDebtId}/notes`),
    enabled: !!noteForDebtId && canReadCollectionNotes,
  });

  const updateContact = useMutation({
    mutationFn: (body: Partial<Contact>) =>
      apiFetch(`contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact", contactId] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      setEditMode(false);
    },
  });

  const deleteContact = useMutation({
    mutationFn: () => apiFetch(`contacts/${contactId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      navigate("/contacts");
    },
  });

  const quickCreateMutation = useMutation({
    mutationFn: ({ type, body }: { type: "ticket" | "task" | "followup" | "opportunity" | "order"; body: Record<string, unknown> }) =>
      apiFetch(type === "ticket" ? "tickets" : type === "task" ? "tasks" : type === "followup" ? "followups" : type === "opportunity" ? "opportunities" : "orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-timeline", contactId] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setQuickCreate(null);
      setQuickForm({ title: "", priority: "normal", type: "manual", dueAt: "", notes: "" });
      setOrderForm({ channel: "manual", currency: "YER", notes: "" });
    },
  });

  const addChannel = useMutation({
    mutationFn: (body: typeof channelForm) =>
      apiFetch(`contacts/${contactId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-channels", contactId] });
      qc.invalidateQueries({ queryKey: ["contact-timeline", contactId] });
      setShowAddChannel(false);
      setChannelForm({ channelType: "phone", identifier: "", isPrimary: false });
      setChannelError("");
    },
    onError: (e: Error) => setChannelError(e.message),
  });

  const deleteChannel = useMutation({
    mutationFn: (channelId: string) =>
      apiFetch(`contacts/${contactId}/channels/${channelId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-channels", contactId] });
      qc.invalidateQueries({ queryKey: ["contact-timeline", contactId] });
    },
  });

  const addNote = useMutation({
    mutationFn: (body: { body: string; isPrivate: boolean }) =>
      apiFetch(`contacts/${contactId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-notes", contactId] });
      qc.invalidateQueries({ queryKey: ["contact-timeline", contactId] });
      setNoteText("");
      setNotePrivate(false);
    },
  });

  const deleteNote = useMutation({
    mutationFn: (noteId: string) =>
      apiFetch(`contacts/${contactId}/notes/${noteId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-notes", contactId] });
    },
  });

  const createDebtMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch("debts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-debts", contactId] });
      qc.invalidateQueries({ queryKey: ["contact-timeline", contactId] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      setShowDebtModal(false);
      setDebtForm({ amount: "", currency: "YER", dueAt: "", description: "" });
      setDebtError("");
    },
    onError: (e: Error) => setDebtError(e.message),
  });

  const addCollectionNote = useMutation({
    mutationFn: ({ debtId, note }: { debtId: string; note: string }) =>
      apiFetch(`debts/${debtId}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["debt-notes-contact", noteForDebtId] });
      qc.invalidateQueries({ queryKey: ["contact-timeline", contactId] });
      setShowNoteModal(false);
      setCollectionNoteText("");
      setCollectionNoteError("");
    },
    onError: (e: Error) => setCollectionNoteError(e.message),
  });

  const createPaymentForContact = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch("payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-payments", contactId] });
      qc.invalidateQueries({ queryKey: ["contact-timeline", contactId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setShowPayModal(false);
      setPayForm({ amount: "", currency: "YER", paymentMethodId: "", reference: "", notes: "" });
    },
  });

  if (!canRead) return (
    <div dir="rtl">
      <button onClick={() => navigate("/contacts")} className="text-sm text-muted-foreground hover:text-foreground mb-4 flex items-center gap-1">
        ← العودة للعملاء
      </button>
      <PermissionDenied />
    </div>
  );

  if (isLoading) return <div dir="rtl"><LoadingSkeleton /></div>;

  if (isError) return (
    <div dir="rtl">
      <button onClick={() => navigate("/contacts")} className="text-sm text-muted-foreground hover:text-foreground mb-4 flex items-center gap-1">
        ← العودة للعملاء
      </button>
      <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center space-y-3">
        <p className="text-red-800 text-sm">تعذّر تحميل بيانات العميل</p>
        <button onClick={() => refetch()} className="text-sm px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg transition-colors">
          إعادة المحاولة
        </button>
      </div>
    </div>
  );

  const contact = contactData!.contact;

  const tabs: { key: "info" | "channels" | "notes" | "timeline" | "payments" | "debts"; label: string }[] = [
    { key: "info", label: "المعلومات" },
    { key: "channels", label: "قنوات التواصل" },
    { key: "notes", label: "الملاحظات" },
    { key: "timeline", label: "السجل الزمني" },
    ...(canReadPayments ? [{ key: "payments" as const, label: "المدفوعات" }] : []),
    ...(canReadDebts ? [{ key: "debts" as const, label: "الديون والتحصيل" }] : []),
  ];

  return (
    <div dir="rtl" className="space-y-4 max-w-3xl">
      {/* Back */}
      <button
        onClick={() => navigate("/contacts")}
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
      >
        ← العودة للعملاء
      </button>

      {/* Header */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-2xl shrink-0">
              {contact.name?.[0] ?? "؟"}
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{contact.name}</h1>
              {contact.company && <p className="text-sm text-muted-foreground">{contact.company}</p>}
              <p className="text-xs text-muted-foreground mt-0.5">أُضيف {formatDate(contact.createdAt)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canUpdate && (
              <button
                onClick={() => { setEditForm(contact); setEditMode(true); }}
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                تعديل
              </button>
            )}
            <DisabledAction label="💬 محادثة" />
            {canCreateTicket ? (
              <button onClick={() => setQuickCreate("ticket")}
                className="px-3 py-1.5 text-xs border border-border rounded-lg text-foreground hover:bg-muted transition-colors flex items-center gap-1.5">
                🎫 تذكرة
              </button>
            ) : (
              <button disabled title="ليس لديك صلاحية إنشاء تذاكر"
                className="px-3 py-1.5 text-xs border border-dashed border-border rounded-lg text-muted-foreground cursor-not-allowed opacity-60 flex items-center gap-1.5">
                🎫 تذكرة
              </button>
            )}
            {canCreateTask ? (
              <button onClick={() => setQuickCreate("task")}
                className="px-3 py-1.5 text-xs border border-border rounded-lg text-foreground hover:bg-muted transition-colors flex items-center gap-1.5">
                ✅ مهمة
              </button>
            ) : (
              <button disabled title="ليس لديك صلاحية إنشاء مهام"
                className="px-3 py-1.5 text-xs border border-dashed border-border rounded-lg text-muted-foreground cursor-not-allowed opacity-60 flex items-center gap-1.5">
                ✅ مهمة
              </button>
            )}
            {canCreateFollowup ? (
              <button onClick={() => setQuickCreate("followup")}
                className="px-3 py-1.5 text-xs border border-border rounded-lg text-foreground hover:bg-muted transition-colors flex items-center gap-1.5">
                🔔 متابعة
              </button>
            ) : (
              <button disabled title="ليس لديك صلاحية إنشاء متابعات"
                className="px-3 py-1.5 text-xs border border-dashed border-border rounded-lg text-muted-foreground cursor-not-allowed opacity-60 flex items-center gap-1.5">
                🔔 متابعة
              </button>
            )}
            {canCreateOpportunity ? (
              <button onClick={() => setQuickCreate("opportunity")}
                className="px-3 py-1.5 text-xs border border-border rounded-lg text-foreground hover:bg-muted transition-colors flex items-center gap-1.5">
                💡 فرصة
              </button>
            ) : (
              <button disabled title="ليس لديك صلاحية إنشاء الفرص"
                className="px-3 py-1.5 text-xs border border-dashed border-border rounded-lg text-muted-foreground cursor-not-allowed opacity-60 flex items-center gap-1.5">
                💡 فرصة
              </button>
            )}
            {canCreateOrder ? (
              <button onClick={() => setQuickCreate("order")}
                className="px-3 py-1.5 text-xs border border-border rounded-lg text-foreground hover:bg-muted transition-colors flex items-center gap-1.5">
                📦 طلب
              </button>
            ) : (
              <button disabled title="ليس لديك صلاحية إنشاء الطلبات"
                className="px-3 py-1.5 text-xs border border-dashed border-border rounded-lg text-muted-foreground cursor-not-allowed opacity-60 flex items-center gap-1.5">
                📦 طلب
              </button>
            )}
            {canCreatePayment ? (
              <button onClick={() => setShowPayModal(true)}
                className="px-3 py-1.5 text-xs border border-border rounded-lg text-foreground hover:bg-muted transition-colors flex items-center gap-1.5">
                💰 دفعة
              </button>
            ) : (
              <button disabled title="ليس لديك صلاحية تسجيل الدفعات"
                className="px-3 py-1.5 text-xs border border-dashed border-border rounded-lg text-muted-foreground cursor-not-allowed opacity-60 flex items-center gap-1.5">
                💰 دفعة
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => { if (confirm(`هل تريد حذف "${contact.name}"؟`)) deleteContact.mutate(); }}
                disabled={deleteContact.isPending}
                className="px-3 py-1.5 text-xs bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20 transition-colors"
              >
                حذف
              </button>
            )}
          </div>
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-border">
          {[
            { label: "الهاتف", value: contact.phone, dir: "ltr" },
            { label: "البريد", value: contact.email, dir: "ltr" },
            { label: "المدينة", value: contact.city },
          ].map(({ label, value, dir }) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
              <p className="text-sm text-foreground font-medium" dir={(dir as "ltr" | "rtl") ?? "rtl"}>{value ?? "—"}</p>
            </div>
          ))}
        </div>

        {contact.tags && contact.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {contact.tags.map((tag: string) => (
              <span key={tag} className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full">{tag}</span>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Channels ── */}
      {tab === "channels" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">قنوات التواصل</h3>
            {canManageChannels ? (
              <button
                onClick={() => { setShowAddChannel(true); setChannelError(""); }}
                className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                + إضافة قناة
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">🔒 لا تملك صلاحية إدارة القنوات</span>
            )}
          </div>

          {!channelsData?.channels?.length ? (
            <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground">
              <div className="text-3xl mb-2">📡</div>
              <p className="text-sm">لا توجد قنوات تواصل مضافة</p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl divide-y divide-border">
              {channelsData.channels.map((ch) => (
                <div key={ch.id} className="flex items-center justify-between px-4 py-3 gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{CHANNEL_ICONS[ch.channelType] ?? "📡"}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{CHANNEL_LABELS[ch.channelType] ?? ch.channelType}</span>
                        {ch.isPrimary && <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">رئيسي</span>}
                        {ch.isVerified && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">موثّق</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5" dir="ltr">{ch.identifier}</p>
                    </div>
                  </div>
                  {canManageChannels && (
                    <button
                      onClick={() => deleteChannel.mutate(ch.id)}
                      className="text-xs text-destructive hover:text-destructive/80 transition-colors px-2"
                    >
                      حذف
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Notes ── */}
      {tab === "notes" && (
        <div className="space-y-3">
          {canManageNotes && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-2">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={3}
                placeholder="أضف ملاحظة حول هذا العميل..."
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notePrivate}
                    onChange={(e) => setNotePrivate(e.target.checked)}
                    className="rounded"
                  />
                  ملاحظة خاصة
                </label>
                <button
                  onClick={() => addNote.mutate({ body: noteText, isPrivate: notePrivate })}
                  disabled={addNote.isPending || !noteText.trim()}
                  className="px-4 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {addNote.isPending ? "جار الحفظ..." : "حفظ الملاحظة"}
                </button>
              </div>
              {addNote.isError && (
                <p className="text-xs text-destructive">{(addNote.error as Error)?.message}</p>
              )}
            </div>
          )}

          {!notesData?.notes?.length ? (
            <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground">
              <div className="text-3xl mb-2">📝</div>
              <p className="text-sm">لا توجد ملاحظات بعد</p>
            </div>
          ) : (
            <div className="space-y-2">
              {notesData.notes.map((note) => (
                <div key={note.id} className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-foreground leading-relaxed flex-1 whitespace-pre-wrap">{note.body}</p>
                    {canManageNotes && (note.authorId === user?.id || hasPermission("contacts:delete")) && (
                      <button
                        onClick={() => deleteNote.mutate(note.id)}
                        className="text-xs text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      >
                        حذف
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    {note.isPrivate && (
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">خاصة</span>
                    )}
                    <span className="text-xs text-muted-foreground">{timeAgo(note.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Timeline ── */}
      {tab === "timeline" && (
        <div className="space-y-2">
          {!timelineData?.timeline?.length ? (
            <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground">
              <div className="text-3xl mb-2">📋</div>
              <p className="text-sm">لا يوجد سجل أحداث بعد</p>
            </div>
          ) : (
            <div className="relative">
              <div className="absolute right-5 top-0 bottom-0 w-0.5 bg-border" />
              <div className="space-y-3">
                {timelineData.timeline.map((event) => (
                  <div key={event.id} className="flex items-start gap-3 pr-10 relative">
                    <div className="absolute right-3 top-1.5 w-4 h-4 rounded-full bg-primary/20 border-2 border-primary/40 flex items-center justify-center text-[10px]">
                      {TIMELINE_ICONS[event.eventType] ?? "•"}
                    </div>
                    <div className="bg-card border border-border rounded-lg px-3 py-2 flex-1">
                      <p className="text-sm font-medium text-foreground">{event.title}</p>
                      {event.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">{formatDateTime(event.occurredAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Payments tab ── */}
      {tab === "payments" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              مدفوعات العميل ({contactPaymentsData?.payments?.length ?? 0})
            </h3>
            {canCreatePayment && (
              <button onClick={() => setShowPayModal(true)}
                className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
                + تسجيل دفعة
              </button>
            )}
          </div>
          {!contactPaymentsData?.payments?.length ? (
            <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground">
              <div className="text-3xl mb-2">💰</div>
              <p className="text-sm">لا توجد مدفوعات مسجلة</p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl divide-y divide-border">
              {contactPaymentsData.payments.map((p: any) => {
                const label = (p.methodSnapshot as any)?.labelAr ?? p.method;
                const statusCfg: Record<string, string> = {
                  pending: "bg-amber-50 text-amber-700 border-amber-200",
                  confirmed: "bg-green-50 text-green-700 border-green-200",
                  rejected: "bg-red-50 text-red-600 border-red-200",
                };
                const statusLabel: Record<string, string> = { pending: "قيد الانتظار", confirmed: "مؤكد", rejected: "مرفوض" };
                return (
                  <div key={p.id} className="flex items-center justify-between px-4 py-3 gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-foreground">{formatCurrency(p.amount, p.currency)}</span>
                        <span className="text-xs text-muted-foreground">{label}</span>
                        {p.reference && <span className="text-xs text-muted-foreground font-mono" dir="ltr">#{p.reference}</span>}
                      </div>
                      {p.orderNumber && <p className="text-xs text-muted-foreground mt-0.5">طلب: {p.orderNumber}</p>}
                      <p className="text-xs text-muted-foreground mt-0.5">{formatDate(p.paidAt ?? p.createdAt)}</p>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusCfg[p.status] ?? "bg-muted text-muted-foreground"}`}>
                      {statusLabel[p.status] ?? p.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {contactPaymentsData && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-2.5">
                <p className="text-xs text-green-600">إجمالي المؤكد</p>
                <p className="font-bold text-green-800 text-sm mt-0.5">{formatCurrency(contactPaymentsData.totalConfirmed ?? 0, "YER")}</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                <p className="text-xs text-amber-600">قيد الانتظار</p>
                <p className="font-bold text-amber-800 text-sm mt-0.5">{formatCurrency(contactPaymentsData.totalPending ?? 0, "YER")}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Info tab ── */}
      {tab === "info" && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">إحصائيات العميل</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">إجمالي الطلبات</p>
              <p className="text-2xl font-bold text-foreground mt-1">{contact.totalOrders}</p>
            </div>
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">إجمالي الإنفاق</p>
              <p className="text-2xl font-bold text-foreground mt-1">
                {Number(contact.totalSpent).toLocaleString("ar-YE")} <span className="text-sm font-normal">ر.ي</span>
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">آخر تحديث: {formatDateTime(contact.updatedAt)}</p>
        </div>
      )}

      {/* ── Debts tab ── */}
      {tab === "debts" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              ديون العميل ({contactDebtsData?.debts?.length ?? 0})
            </h3>
            {canCreateDebt && (
              <button onClick={() => { setDebtError(""); setDebtForm({ amount: "", currency: "YER", dueAt: "", description: "" }); setShowDebtModal(true); }}
                className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
                + تسجيل دين
              </button>
            )}
          </div>
          {!contactDebtsData?.debts?.length ? (
            <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground">
              <div className="text-3xl mb-2">📋</div>
              <p className="text-sm">لا توجد ديون مسجلة</p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl divide-y divide-border">
              {(contactDebtsData.debts as any[]).map((d: any) => {
                const statusCls: Record<string, string> = {
                  open: "bg-blue-50 text-blue-700 border-blue-200",
                  partial: "bg-amber-50 text-amber-700 border-amber-200",
                  paid: "bg-green-50 text-green-700 border-green-200",
                  overdue: "bg-red-50 text-red-700 border-red-200",
                  written_off: "bg-gray-100 text-gray-600 border-gray-300",
                  cancelled: "bg-gray-50 text-gray-500 border-gray-200",
                };
                const statusLabel: Record<string, string> = {
                  open: "مفتوح", partial: "جزئي", paid: "مدفوع",
                  overdue: "متأخر", written_off: "مشطوب", cancelled: "ملغي",
                };
                return (
                  <div key={d.id} className="flex items-center justify-between px-4 py-3 gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-foreground">{formatCurrency(d.amount, d.currency)}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusCls[d.status] ?? "bg-muted text-muted-foreground border-border"}`}>
                          {statusLabel[d.status] ?? d.status}
                        </span>
                      </div>
                      {d.description && <p className="text-xs text-muted-foreground mt-0.5">{d.description}</p>}
                      {d.dueAt && <p className="text-xs text-muted-foreground mt-0.5">الاستحقاق: {formatDate(d.dueAt)}</p>}
                      <p className="text-xs text-muted-foreground mt-0.5">المتبقي: {formatCurrency(d.remainingAmount, d.currency)}</p>
                    </div>
                    {canReadCollectionNotes && (
                      <button onClick={() => { setNoteForDebtId(d.id); setShowNoteModal(true); setCollectionNoteText(""); setCollectionNoteError(""); }}
                        className="text-xs px-2 py-1 bg-muted hover:bg-muted/70 rounded text-muted-foreground transition-colors shrink-0">
                        ملاحظات
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      <Modal open={editMode} onClose={() => setEditMode(false)} title="تعديل بيانات العميل" size="lg">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">الاسم *</label>
            <input
              value={editForm.name ?? ""}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">الهاتف</label>
              <input
                value={editForm.phone ?? ""}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">البريد الإلكتروني</label>
              <input
                type="email"
                value={editForm.email ?? ""}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                dir="ltr"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">الشركة</label>
              <input
                value={editForm.company ?? ""}
                onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">المدينة</label>
              <input
                value={editForm.city ?? ""}
                onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
          {updateContact.isError && (
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">
              {(updateContact.error as Error)?.message ?? "حدث خطأ"}
            </div>
          )}
          <button
            onClick={() => updateContact.mutate(editForm)}
            disabled={updateContact.isPending || !editForm.name?.trim()}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {updateContact.isPending ? "جار الحفظ..." : "حفظ التعديلات"}
          </button>
        </div>
      </Modal>

      {/* Add Channel Modal */}
      <Modal open={showAddChannel} onClose={() => { setShowAddChannel(false); setChannelError(""); }} title="إضافة قناة تواصل">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">نوع القناة</label>
            <select
              value={channelForm.channelType}
              onChange={(e) => setChannelForm({ ...channelForm, channelType: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {Object.entries(CHANNEL_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{CHANNEL_ICONS[key]} {label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              {channelForm.channelType === "email" ? "البريد الإلكتروني" :
               channelForm.channelType === "instagram" ? "اسم المستخدم" : "رقم الهاتف"}
            </label>
            <input
              value={channelForm.identifier}
              onChange={(e) => setChannelForm({ ...channelForm, identifier: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              dir="ltr"
              placeholder={
                channelForm.channelType === "email" ? "example@domain.com" :
                channelForm.channelType === "instagram" ? "@username" : "7XX XXX XXX"
              }
            />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={channelForm.isPrimary}
              onChange={(e) => setChannelForm({ ...channelForm, isPrimary: e.target.checked })}
              className="rounded"
            />
            تعيين كقناة رئيسية
          </label>
          {channelError && (
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">
              {channelError}
            </div>
          )}
          <button
            onClick={() => addChannel.mutate(channelForm)}
            disabled={addChannel.isPending || !channelForm.identifier.trim()}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {addChannel.isPending ? "جار الإضافة..." : "إضافة القناة"}
          </button>
        </div>
      </Modal>

      <Modal open={!!quickCreate} onClose={() => { setQuickCreate(null); setQuickForm({ title: "", priority: "normal", type: "manual", dueAt: "", notes: "" }); setOrderForm({ channel: "manual", currency: "YER", notes: "" }); }}
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
          <p className="text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
            مرتبطة بالعميل: <span className="font-medium text-foreground">{contact.name}</span>
          </p>
          {quickCreateMutation.isError && (
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">
              {(quickCreateMutation.error as Error)?.message}
            </div>
          )}
          <button
            onClick={() => {
              if (!quickCreate) return;
              if (quickCreate === "ticket") {
                quickCreateMutation.mutate({ type: "ticket", body: { contactId, title: quickForm.title, priority: quickForm.priority, dueAt: quickForm.dueAt ? new Date(quickForm.dueAt).toISOString() : undefined } });
              } else if (quickCreate === "task") {
                quickCreateMutation.mutate({ type: "task", body: { contactId, title: quickForm.title, priority: quickForm.priority, dueAt: quickForm.dueAt ? new Date(quickForm.dueAt).toISOString() : undefined } });
              } else if (quickCreate === "followup") {
                quickCreateMutation.mutate({ type: "followup", body: { contactId, type: quickForm.type, dueAt: quickForm.dueAt ? new Date(quickForm.dueAt).toISOString() : undefined, notes: quickForm.notes || undefined } });
              } else if (quickCreate === "opportunity") {
                quickCreateMutation.mutate({ type: "opportunity", body: { contactId, title: quickForm.title, notes: quickForm.notes || undefined } });
              } else {
                quickCreateMutation.mutate({ type: "order", body: { contactId, channel: orderForm.channel, currency: orderForm.currency, notes: orderForm.notes || undefined } });
              }
            }}
            disabled={quickCreateMutation.isPending || (quickCreate === "opportunity" && !quickForm.title) || (quickCreate === "ticket" && !quickForm.title) || (quickCreate === "task" && !quickForm.title) || (quickCreate === "followup" && !quickForm.dueAt)}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {quickCreateMutation.isPending ? "جار الإنشاء..." : "إنشاء"}
          </button>
        </div>
      </Modal>

      {/* ── Debt Create Modal ────────────────────────────────── */}
      <Modal open={showDebtModal} onClose={() => setShowDebtModal(false)} title="تسجيل دين جديد" size="sm">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">المبلغ *</label>
              <input type="number" value={debtForm.amount} onChange={(e) => setDebtForm({ ...debtForm, amount: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="0" dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">العملة</label>
              <select value={debtForm.currency} onChange={(e) => setDebtForm({ ...debtForm, currency: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="YER">ريال يمني</option>
                <option value="SAR">ريال سعودي</option>
                <option value="USD">دولار</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">تاريخ الاستحقاق</label>
            <input type="date" value={debtForm.dueAt} onChange={(e) => setDebtForm({ ...debtForm, dueAt: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">الوصف</label>
            <input value={debtForm.description} onChange={(e) => setDebtForm({ ...debtForm, description: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="وصف الدين..." />
          </div>
          {debtError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{debtError}</div>}
          <button
            onClick={() => {
              if (!debtForm.amount) { setDebtError("المبلغ مطلوب"); return; }
              const body: Record<string, unknown> = { contactId, amount: Number(debtForm.amount), currency: debtForm.currency };
              if (debtForm.dueAt) body.dueAt = debtForm.dueAt;
              if (debtForm.description) body.description = debtForm.description;
              createDebtMutation.mutate(body);
            }}
            disabled={createDebtMutation.isPending || !debtForm.amount}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {createDebtMutation.isPending ? "جار التسجيل..." : "تسجيل الدين"}
          </button>
        </div>
      </Modal>

      {/* ── Collection Note Modal ─────────────────────────────── */}
      <Modal open={showNoteModal && !!noteForDebtId} onClose={() => { setShowNoteModal(false); setNoteForDebtId(null); }} title="ملاحظات التحصيل" size="sm">
        <div className="space-y-3">
          {canReadCollectionNotes && (selectedDebtNotes?.notes ?? []).length > 0 && (
            <div className="space-y-1.5 max-h-36 overflow-y-auto mb-3">
              {(selectedDebtNotes.notes as any[]).map((n: any) => (
                <div key={n.id} className="p-2 bg-muted/30 border border-border rounded-lg text-xs">
                  <p className="text-foreground">{n.note}</p>
                  <p className="text-muted-foreground mt-0.5">{formatDate(n.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
          {canCreateCollectionNote && (
            <>
              <div>
                <label className="block text-xs font-medium mb-1">ملاحظة جديدة *</label>
                <textarea value={collectionNoteText} onChange={(e) => setCollectionNoteText(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  rows={3} placeholder="أدخل ملاحظة التحصيل..." />
              </div>
              {collectionNoteError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{collectionNoteError}</div>}
              <button
                onClick={() => { if (!noteForDebtId) return; addCollectionNote.mutate({ debtId: noteForDebtId, note: collectionNoteText }); }}
                disabled={addCollectionNote.isPending || !collectionNoteText}
                className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
                {addCollectionNote.isPending ? "جار الحفظ..." : "إضافة الملاحظة"}
              </button>
            </>
          )}
        </div>
      </Modal>

      {/* ── Payment Modal ─────────────────────────────────────── */}
      <Modal open={showPayModal} onClose={() => { setShowPayModal(false); setPayForm({ amount: "", currency: "YER", paymentMethodId: "", reference: "", notes: "" }); }} title={`تسجيل دفعة — ${contact.name}`} size="sm">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">المبلغ *</label>
              <input type="number" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="0" dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">العملة</label>
              <select value={payForm.currency} onChange={(e) => setPayForm({ ...payForm, currency: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="YER">ريال يمني</option>
                <option value="SAR">ريال سعودي</option>
                <option value="USD">دولار</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">طريقة الدفع *</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(payMethodsData?.methods ?? []).map((m: any) => (
                <button key={m.id} onClick={() => setPayForm({ ...payForm, paymentMethodId: m.id })}
                  className={`py-2 rounded-lg text-xs font-medium border transition-colors ${payForm.paymentMethodId === m.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
                  {m.labelAr}
                </button>
              ))}
            </div>
            {!payMethodsData?.methods?.length && (
              <p className="text-xs text-muted-foreground mt-1">جار تحميل طرق الدفع...</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">رقم الحوالة / المرجع</label>
            <input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="اختياري..." dir="ltr" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">ملاحظات</label>
            <textarea value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              rows={2} placeholder="اختياري..." />
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-700">
            ⏳ الدفعة ستُسجَّل بحالة "قيد الانتظار" وتحتاج تأكيداً من المدير أو المحاسب
          </div>
          {createPaymentForContact.isError && (
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">
              {(createPaymentForContact.error as Error)?.message ?? "حدث خطأ"}
            </div>
          )}
          <button
            onClick={() => createPaymentForContact.mutate({
              contactId,
              amount: Number(payForm.amount),
              currency: payForm.currency,
              paymentMethodId: payForm.paymentMethodId,
              reference: payForm.reference || undefined,
              notes: payForm.notes || undefined,
            })}
            disabled={createPaymentForContact.isPending || !payForm.amount || !payForm.paymentMethodId}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {createPaymentForContact.isPending ? "جار التسجيل..." : "تسجيل الدفعة"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
