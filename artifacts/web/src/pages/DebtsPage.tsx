import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatCurrency, cn } from "@/lib/utils";
import { useLocation } from "wouter";

const BASE = `${import.meta.env.BASE_URL}api`;
const apiFetch = async (path: string, opts?: RequestInit) => {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const text = await res.text();
    try { const j = JSON.parse(text); throw new Error(j.error ?? text); } catch { throw new Error(text); }
  }
  return res.json();
};

const DEBT_STATUS_CFG: Record<string, { label: string; cls: string }> = {
  open:        { label: "مفتوح",   cls: "bg-blue-50 text-blue-700 border-blue-200" },
  partial:     { label: "جزئي",   cls: "bg-amber-50 text-amber-700 border-amber-200" },
  paid:        { label: "مدفوع",   cls: "bg-green-50 text-green-700 border-green-200" },
  overdue:     { label: "متأخر",   cls: "bg-red-50 text-red-700 border-red-200" },
  written_off: { label: "مشطوب",  cls: "bg-gray-100 text-gray-600 border-gray-300" },
  cancelled:   { label: "ملغي",   cls: "bg-gray-50 text-gray-500 border-gray-200" },
};

function DebtBadge({ status }: { status: string }) {
  const cfg = DEBT_STATUS_CFG[status] ?? { label: status, cls: "bg-muted text-muted-foreground border-border" };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.cls}`}>{cfg.label}</span>;
}

type Transition = { to: string; label: string; danger?: boolean };
const ALLOWED_TRANSITIONS: Record<string, Transition[]> = {
  open:    [{ to: "partial", label: "جزئي الدفع" }, { to: "paid", label: "مدفوع بالكامل" }, { to: "overdue", label: "تأخير" }, { to: "written_off", label: "شطب", danger: true }, { to: "cancelled", label: "إلغاء", danger: true }],
  partial: [{ to: "paid", label: "مدفوع بالكامل" }, { to: "overdue", label: "تأخير" }, { to: "written_off", label: "شطب", danger: true }, { to: "cancelled", label: "إلغاء", danger: true }],
  overdue: [{ to: "partial", label: "جزئي الدفع" }, { to: "paid", label: "مدفوع بالكامل" }, { to: "written_off", label: "شطب", danger: true }, { to: "cancelled", label: "إلغاء", danger: true }],
  paid: [],
  written_off: [],
  cancelled: [],
};

const CURRENCY_LABELS: Record<string, string> = { YER: "ريال يمني", SAR: "ريال سعودي", USD: "دولار" };

const emptyCreate = { contactId: "", orderId: "", amount: "", currency: "YER", remainingAmount: "", dueAt: "", description: "", notes: "" };

export default function DebtsPage() {
  const { hasPermission } = useAuth();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const canRead = hasPermission("debts:read");
  const canCreate = hasPermission("debts:create");
  const canUpdate = hasPermission("debts:update");
  const canCancel = hasPermission("debts:cancel");
  const canWriteOff = hasPermission("debts:write_off");
  const canDelete = hasPermission("debts:delete");
  const canReadNotes = hasPermission("collection_notes:read");
  const canCreateNote = hasPermission("collection_notes:create");

  const [statusFilter, setStatusFilter] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [createError, setCreateError] = useState("");

  const [selectedDebtId, setSelectedDebtId] = useState<string | null>(null);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<Transition | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [newRemaining, setNewRemaining] = useState("");
  const [statusError, setStatusError] = useState("");

  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [notePromisedDate, setNotePromisedDate] = useState("");
  const [notePromisedAmount, setNotePromisedAmount] = useState("");
  const [noteError, setNoteError] = useState("");

  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ remainingAmount: "", dueAt: "", description: "", notes: "" });
  const [editError, setEditError] = useState("");

  const params = new URLSearchParams();
  if (statusFilter) params.set("status", statusFilter);
  if (overdueOnly) params.set("overdue", "true");
  params.set("limit", "50");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["debts", statusFilter, overdueOnly],
    queryFn: () => apiFetch(`debts?${params}`),
    enabled: canRead,
  });

  const { data: contactsData } = useQuery({
    queryKey: ["contacts-mini"],
    queryFn: () => apiFetch("contacts?limit=200"),
    enabled: showCreate,
  });

  const { data: detailData, refetch: refetchDetail } = useQuery({
    queryKey: ["debt-detail", selectedDebtId],
    queryFn: () => apiFetch(`debts/${selectedDebtId}`),
    enabled: !!selectedDebtId,
  });

  const { data: notesData, refetch: refetchNotes } = useQuery({
    queryKey: ["debt-notes", selectedDebtId],
    queryFn: () => apiFetch(`debts/${selectedDebtId}/notes`),
    enabled: !!selectedDebtId && canReadNotes,
  });

  const debts: any[] = data?.debts ?? [];
  const contacts: any[] = contactsData?.contacts ?? [];
  const selectedDebt = detailData?.debt ?? null;
  const notes: any[] = notesData?.notes ?? [];

  const filteredDebts = search
    ? debts.filter((d) => d.contactName?.toLowerCase().includes(search.toLowerCase()))
    : debts;

  const createDebt = useMutation({
    mutationFn: (body: any) => apiFetch("debts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["debts"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      setShowCreate(false);
      setCreateForm(emptyCreate);
      setCreateError("");
    },
    onError: (e: Error) => setCreateError(e.message),
  });

  const changeStatus = useMutation({
    mutationFn: (body: any) => apiFetch(`debts/${selectedDebtId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["debts"] });
      qc.invalidateQueries({ queryKey: ["debt-detail", selectedDebtId] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      setShowStatusModal(false);
      setPendingStatus(null);
      setStatusReason("");
      setNewRemaining("");
      setStatusError("");
      refetchDetail();
    },
    onError: (e: Error) => setStatusError(e.message),
  });

  const editDebt = useMutation({
    mutationFn: (body: any) => apiFetch(`debts/${selectedDebtId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["debts"] });
      qc.invalidateQueries({ queryKey: ["debt-detail", selectedDebtId] });
      setShowEditModal(false);
      setEditError("");
      refetchDetail();
    },
    onError: (e: Error) => setEditError(e.message),
  });

  const addNote = useMutation({
    mutationFn: (body: any) => apiFetch(`debts/${selectedDebtId}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      refetchNotes();
      qc.invalidateQueries({ queryKey: ["debt-notes", selectedDebtId] });
      setShowNoteModal(false);
      setNoteText("");
      setNotePromisedDate("");
      setNotePromisedAmount("");
      setNoteError("");
    },
    onError: (e: Error) => setNoteError(e.message),
  });

  const deleteDebt = useMutation({
    mutationFn: () => apiFetch(`debts/${selectedDebtId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["debts"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      setSelectedDebtId(null);
    },
  });

  function handleCreateSubmit() {
    if (!createForm.contactId || !createForm.amount) {
      setCreateError("العميل والمبلغ مطلوبان");
      return;
    }
    const body: any = {
      contactId: createForm.contactId,
      amount: Number(createForm.amount),
      currency: createForm.currency,
    };
    if (createForm.orderId) body.orderId = createForm.orderId;
    if (createForm.remainingAmount) body.remainingAmount = Number(createForm.remainingAmount);
    if (createForm.dueAt) body.dueAt = createForm.dueAt;
    if (createForm.description) body.description = createForm.description;
    if (createForm.notes) body.notes = createForm.notes;
    setCreateError("");
    createDebt.mutate(body);
  }

  function handleStatusChange() {
    if (!pendingStatus) return;
    const body: any = { status: pendingStatus.to };
    if (["written_off", "cancelled"].includes(pendingStatus.to) && !statusReason) {
      setStatusError(pendingStatus.to === "written_off" ? "يجب إدخال سبب الشطب" : "يجب إدخال سبب الإلغاء");
      return;
    }
    if (pendingStatus.to === "written_off") body.writeOffReason = statusReason;
    if (pendingStatus.to === "cancelled") body.cancelReason = statusReason;
    if (newRemaining) body.remainingAmount = Number(newRemaining);
    setStatusError("");
    changeStatus.mutate(body);
  }

  function openEditModal(debt: any) {
    setEditForm({
      remainingAmount: String(debt.remainingAmount ?? ""),
      dueAt: debt.dueAt ? debt.dueAt.slice(0, 10) : "",
      description: debt.description ?? "",
      notes: debt.notes ?? "",
    });
    setEditError("");
    setShowEditModal(true);
  }

  function handleEditSubmit() {
    const body: any = {};
    if (editForm.remainingAmount !== "") body.remainingAmount = Number(editForm.remainingAmount);
    if (editForm.dueAt !== "") body.dueAt = editForm.dueAt;
    if (editForm.description !== "") body.description = editForm.description;
    if (editForm.notes !== "") body.notes = editForm.notes;
    setEditError("");
    editDebt.mutate(body);
  }

  function handleNoteSubmit() {
    if (!noteText) { setNoteError("الملاحظة مطلوبة"); return; }
    const body: any = { note: noteText };
    if (notePromisedDate) body.promisedPaymentDate = notePromisedDate;
    if (notePromisedAmount) body.promisedAmount = Number(notePromisedAmount);
    setNoteError("");
    addNote.mutate(body);
  }

  const isTerminal = selectedDebt && ["paid", "written_off", "cancelled"].includes(selectedDebt.status);

  if (!canRead) {
    return (
      <div dir="rtl">
        <PageHeader title="الديون والتحصيل" subtitle="إدارة ذمم العملاء وعمليات التحصيل" />
        <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm text-center">
          🔒 ليس لديك صلاحية لعرض الديون
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl">
      <PageHeader title="الديون والتحصيل" subtitle="إدارة ذمم العملاء وعمليات التحصيل" />

      {/* ── Filters ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex-1 min-w-40">
          <div className="flex gap-2">
            <input
              id="debt-search"
              name="debtSearch"
              aria-label="بحث باسم العميل"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") setSearch(searchInput); }}
              placeholder="بحث باسم العميل..."
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button onClick={() => setSearch(searchInput)}
              className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90">
              بحث
            </button>
          </div>
        </div>
        <select id="debt-status-filter" name="debtStatusFilter" aria-label="تصفية الديون حسب الحالة" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setOverdueOnly(false); }}
          className="px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
          <option value="">كل الحالات</option>
          <option value="open">مفتوح</option>
          <option value="partial">جزئي</option>
          <option value="overdue">متأخر</option>
          <option value="paid">مدفوع</option>
          <option value="written_off">مشطوب</option>
          <option value="cancelled">ملغي</option>
        </select>
        <button
          onClick={() => { setOverdueOnly(!overdueOnly); setStatusFilter(""); }}
          className={cn("px-3 py-2 rounded-lg border text-sm transition-colors", overdueOnly ? "bg-red-50 border-red-300 text-red-700" : "border-input bg-background text-muted-foreground hover:text-foreground")}>
          ⚠️ متأخرة فقط
        </button>
        {canCreate && (
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
            + دين جديد
          </button>
        )}
      </div>

      {isError && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm flex items-center justify-between">
          <span>تعذّر تحميل البيانات.</span>
          <button onClick={() => refetch()} className="text-xs underline">إعادة المحاولة</button>
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : filteredDebts.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-16 text-center text-muted-foreground">
          <div className="text-4xl mb-3">📋</div>
          <p className="font-medium">لا توجد ديون</p>
          <p className="text-sm mt-1">
            {canCreate ? "أضف أول دين بالنقر على 'دين جديد'" : "لا توجد ديون مسجّلة حتى الآن"}
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-start px-4 py-3 text-xs font-semibold text-muted-foreground">العميل</th>
                <th className="text-start px-4 py-3 text-xs font-semibold text-muted-foreground">المبلغ</th>
                <th className="text-start px-4 py-3 text-xs font-semibold text-muted-foreground">المتبقي</th>
                <th className="text-start px-4 py-3 text-xs font-semibold text-muted-foreground">الحالة</th>
                <th className="text-start px-4 py-3 text-xs font-semibold text-muted-foreground">الاستحقاق</th>
                <th className="text-start px-4 py-3 text-xs font-semibold text-muted-foreground">التقادم</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filteredDebts.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <button onClick={() => navigate(`/contacts/${d.contactId}`)}
                      className="font-medium text-foreground hover:text-primary hover:underline transition-colors text-start">
                      {d.contactName ?? "—"}
                    </button>
                  </td>
                  <td className="px-4 py-3 font-semibold text-foreground">{formatCurrency(d.amount, d.currency)}</td>
                  <td className="px-4 py-3">
                    <span className={cn("font-medium", Number(d.remainingAmount) > 0 ? "text-destructive" : "text-green-600")}>
                      {formatCurrency(d.remainingAmount, d.currency)}
                    </span>
                  </td>
                  <td className="px-4 py-3"><DebtBadge status={d.status} /></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{d.dueAt ? formatDate(d.dueAt) : "—"}</td>
                  <td className="px-4 py-3">
                    {d.dueAt ? (
                      <span className={cn("text-xs px-2 py-0.5 rounded-full border", {
                        "bg-muted text-muted-foreground border-border": d.agingBucket === "غير مستحق",
                        "bg-amber-50 text-amber-700 border-amber-200": d.agingBucket === "1-7 أيام",
                        "bg-orange-50 text-orange-700 border-orange-200": d.agingBucket === "8-30 يوم",
                        "bg-red-50 text-red-700 border-red-200": d.agingBucket === "أكثر من 30 يوم",
                      })}>
                        {d.agingBucket}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setSelectedDebtId(d.id)}
                      className="text-xs px-2 py-1 bg-muted hover:bg-muted/70 rounded text-muted-foreground transition-colors">
                      تفاصيل
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create Debt Modal ───────────────────────────────────────── */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); setCreateForm(emptyCreate); setCreateError(""); }} title="إنشاء دين جديد" size="sm">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">العميل *</label>
            <select value={createForm.contactId} onChange={(e) => setCreateForm({ ...createForm, contactId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="">اختر العميل</option>
              {contacts.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">المبلغ *</label>
              <input type="number" value={createForm.amount} onChange={(e) => setCreateForm({ ...createForm, amount: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="0" dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">العملة</label>
              <select value={createForm.currency} onChange={(e) => setCreateForm({ ...createForm, currency: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="YER">ريال يمني</option>
                <option value="SAR">ريال سعودي</option>
                <option value="USD">دولار</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">المبلغ المتبقي</label>
              <input type="number" value={createForm.remainingAmount} onChange={(e) => setCreateForm({ ...createForm, remainingAmount: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="مثل المبلغ الكلي" dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">تاريخ الاستحقاق</label>
              <input type="date" value={createForm.dueAt} onChange={(e) => setCreateForm({ ...createForm, dueAt: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">الوصف</label>
            <input value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="وصف الدين..." />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">ملاحظات</label>
            <textarea value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              rows={2} placeholder="ملاحظات اختيارية..." />
          </div>
          {createError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{createError}</div>}
          <button onClick={handleCreateSubmit} disabled={createDebt.isPending || !createForm.contactId || !createForm.amount}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {createDebt.isPending ? "جار الحفظ..." : "إنشاء الدين"}
          </button>
        </div>
      </Modal>

      {/* ── Debt Detail Modal ───────────────────────────────────────── */}
      <Modal open={!!selectedDebtId} onClose={() => setSelectedDebtId(null)} title="تفاصيل الدين" size="md">
        {!selectedDebt ? (
          <div className="py-10 text-center text-muted-foreground animate-pulse">جار التحميل...</div>
        ) : (
          <div className="space-y-4">
            {/* Header info */}
            <div className="grid grid-cols-2 gap-3 p-3 bg-muted/30 rounded-lg">
              <div>
                <p className="text-xs text-muted-foreground">العميل</p>
                <p className="font-semibold text-foreground">{selectedDebt.contactName ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">الحالة</p>
                <DebtBadge status={selectedDebt.status} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">المبلغ الأصلي</p>
                <p className="font-bold text-foreground">{formatCurrency(selectedDebt.amount, selectedDebt.currency)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">المتبقي</p>
                <p className={cn("font-bold", selectedDebt.remainingAmount > 0 ? "text-destructive" : "text-green-600")}>
                  {formatCurrency(selectedDebt.remainingAmount, selectedDebt.currency)}
                </p>
              </div>
              {selectedDebt.dueAt && (
                <div>
                  <p className="text-xs text-muted-foreground">الاستحقاق</p>
                  <p className="text-sm text-foreground">{formatDate(selectedDebt.dueAt)}</p>
                </div>
              )}
              {selectedDebt.description && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">الوصف</p>
                  <p className="text-sm text-foreground">{selectedDebt.description}</p>
                </div>
              )}
            </div>

            {/* Cancel/WriteOff reason if terminal */}
            {selectedDebt.cancelReason && (
              <div className="p-2.5 bg-muted rounded-lg text-xs text-muted-foreground">
                <span className="font-medium text-foreground">سبب الإلغاء: </span>{selectedDebt.cancelReason}
              </div>
            )}
            {selectedDebt.writeOffReason && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                <span className="font-medium">سبب الشطب: </span>{selectedDebt.writeOffReason}
              </div>
            )}

            {/* Debt notes */}
            {canReadNotes && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-foreground">ملاحظات التحصيل</p>
                  {canCreateNote && !isTerminal && (
                    <button onClick={() => { setNoteText(""); setNotePromisedDate(""); setNotePromisedAmount(""); setNoteError(""); setShowNoteModal(true); }}
                      className="text-xs px-2.5 py-1 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
                      + إضافة ملاحظة
                    </button>
                  )}
                </div>
                {notes.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3 border border-dashed border-border rounded-lg">
                    لا توجد ملاحظات تحصيل بعد
                  </p>
                ) : (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {notes.map((n: any) => (
                      <div key={n.id} className="p-2.5 bg-muted/30 border border-border rounded-lg">
                        <p className="text-sm text-foreground">{n.note}</p>
                        {n.promisedPaymentDate && (
                          <p className="text-xs text-muted-foreground mt-1">
                            وعد بالدفع: <span className="font-medium text-foreground">{formatDate(n.promisedPaymentDate)}</span>
                            {n.promisedAmount && <span> — مبلغ: {formatCurrency(n.promisedAmount, selectedDebt.currency)}</span>}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">{formatDate(n.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            {!isTerminal && (
              <div className="border-t border-border pt-3 space-y-2">
                {canUpdate && (
                  <button onClick={() => openEditModal(selectedDebt)}
                    className="w-full py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors text-foreground">
                    ✏️ تعديل بيانات الدين
                  </button>
                )}
                {(ALLOWED_TRANSITIONS[selectedDebt.status] ?? []).length > 0 && (canUpdate || canCancel || canWriteOff) && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">تغيير الحالة:</p>
                    <div className="flex flex-wrap gap-2">
                      {(ALLOWED_TRANSITIONS[selectedDebt.status] ?? []).map((t) => {
                        const canDo = t.to === "written_off" ? canWriteOff
                          : t.to === "cancelled" ? canCancel
                          : canUpdate;
                        return (
                          <button key={t.to}
                            onClick={() => { setPendingStatus(t); setStatusReason(""); setNewRemaining(""); setStatusError(""); setShowStatusModal(true); }}
                            disabled={!canDo}
                            title={!canDo ? "ليس لديك صلاحية هذا الإجراء" : undefined}
                            className={cn("text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                              t.danger ? "border-destructive/50 text-destructive hover:bg-destructive/10 bg-destructive/5"
                                : "border-border text-foreground hover:bg-muted")}>
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {canDelete && isTerminal && (
              <div className="border-t border-border pt-3">
                <button onClick={() => { if (confirm("حذف هذا الدين نهائياً؟")) deleteDebt.mutate(); }}
                  disabled={deleteDebt.isPending}
                  className="w-full py-2 rounded-lg bg-destructive/10 text-destructive text-sm hover:bg-destructive/20 transition-colors disabled:opacity-50">
                  {deleteDebt.isPending ? "جار الحذف..." : "حذف الدين"}
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Status Change Modal ─────────────────────────────────────── */}
      <Modal open={showStatusModal} onClose={() => { setShowStatusModal(false); setPendingStatus(null); setStatusReason(""); }}
        title={`تغيير الحالة إلى "${pendingStatus?.label ?? ""}"`} size="sm">
        <div className="space-y-3">
          {selectedDebt && (["partial", "overdue"].includes(pendingStatus?.to ?? "")) && (
            <div>
              <label className="block text-xs font-medium mb-1">المبلغ المتبقي الجديد (اختياري)</label>
              <input type="number" value={newRemaining} onChange={(e) => setNewRemaining(e.target.value)}
                max={selectedDebt.amount}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="المبلغ المتبقي..." dir="ltr" />
            </div>
          )}
          {["written_off", "cancelled"].includes(pendingStatus?.to ?? "") && (
            <div>
              <label className="block text-xs font-medium mb-1">
                {pendingStatus?.to === "written_off" ? "سبب الشطب *" : "سبب الإلغاء *"}
              </label>
              <textarea value={statusReason} onChange={(e) => setStatusReason(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                rows={3} placeholder="أدخل السبب..." />
            </div>
          )}
          {statusError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{statusError}</div>}
          <button onClick={handleStatusChange} disabled={changeStatus.isPending}
            className={cn("w-full py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50 transition-colors",
              pendingStatus?.danger ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90")}>
            {changeStatus.isPending ? "جار التحديث..." : `تأكيد: ${pendingStatus?.label ?? ""}`}
          </button>
        </div>
      </Modal>

      {/* ── Edit Debt Modal ─────────────────────────────────────────── */}
      <Modal open={showEditModal} onClose={() => setShowEditModal(false)} title="تعديل الدين" size="sm">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">المبلغ المتبقي</label>
              <input type="number" value={editForm.remainingAmount} onChange={(e) => setEditForm({ ...editForm, remainingAmount: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">تاريخ الاستحقاق</label>
              <input type="date" value={editForm.dueAt} onChange={(e) => setEditForm({ ...editForm, dueAt: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">الوصف</label>
            <input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="وصف الدين..." />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">ملاحظات</label>
            <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              rows={2} placeholder="ملاحظات..." />
          </div>
          {editError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{editError}</div>}
          <button onClick={handleEditSubmit} disabled={editDebt.isPending}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {editDebt.isPending ? "جار الحفظ..." : "حفظ التعديلات"}
          </button>
        </div>
      </Modal>

      {/* ── Add Note Modal ──────────────────────────────────────────── */}
      <Modal open={showNoteModal} onClose={() => setShowNoteModal(false)} title="إضافة ملاحظة تحصيل" size="sm">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">الملاحظة *</label>
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              rows={4} placeholder="أدخل ملاحظة التحصيل..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">وعد بالدفع (تاريخ)</label>
              <input type="date" value={notePromisedDate} onChange={(e) => setNotePromisedDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">مبلغ الوعد</label>
              <input type="number" value={notePromisedAmount} onChange={(e) => setNotePromisedAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="0" dir="ltr" />
            </div>
          </div>
          {noteError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{noteError}</div>}
          <button onClick={handleNoteSubmit} disabled={addNote.isPending || !noteText}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {addNote.isPending ? "جار الحفظ..." : "إضافة الملاحظة"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
