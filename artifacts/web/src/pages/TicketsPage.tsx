import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { formatDate, priorityLabels, statusLabels } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

const BASE = `${import.meta.env.BASE_URL}api`;
const apiFetch = async (path: string, opts?: RequestInit) => {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const text = await res.text();
    try { const j = JSON.parse(text); throw new Error(j.error ?? text); } catch { throw new Error(text); }
  }
  return res.json();
};

const STATUSES = ["", "new", "open", "in_progress", "waiting_on_customer", "resolved", "closed"];
const PRIORITIES = ["low", "normal", "high", "urgent"];

const TICKET_STATUS_ACTIONS: Record<string, { label: string; next: string }[]> = {
  new: [{ label: "فتح", next: "open" }],
  open: [{ label: "بدء التنفيذ", next: "in_progress" }, { label: "حل", next: "resolved" }],
  in_progress: [{ label: "بانتظار العميل", next: "waiting_on_customer" }, { label: "حل", next: "resolved" }, { label: "إعادة فتح", next: "open" }],
  waiting_on_customer: [{ label: "استمرار التنفيذ", next: "in_progress" }, { label: "حل", next: "resolved" }],
  resolved: [{ label: "إغلاق", next: "closed" }, { label: "إعادة فتح", next: "open" }],
  closed: [],
};

function PermissionDenied() {
  return (
    <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm text-center">
      🔒 ليس لديك صلاحية لتنفيذ هذا الإجراء
    </div>
  );
}

export default function TicketsPage({ prefill }: { prefill?: { contactId?: string; conversationId?: string; sourceMessageId?: string } }) {
  const { hasPermission } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(!!prefill);
  const [editTicket, setEditTicket] = useState<any>(null);
  const [statusTicket, setStatusTicket] = useState<any>(null);
  const [form, setForm] = useState({
    title: "", description: "", priority: "normal", category: "",
    contactId: prefill?.contactId ?? "",
    conversationId: prefill?.conversationId ?? "",
    dueAt: "",
  });

  const canRead = hasPermission("tickets:read");
  const canCreate = hasPermission("tickets:create");
  const canUpdate = hasPermission("tickets:update");
  const canDelete = hasPermission("tickets:delete");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["tickets", statusFilter, search],
    queryFn: () => apiFetch(`tickets?status=${statusFilter}&search=${search}&limit=50`),
    enabled: canRead,
  });

  const { data: contacts } = useQuery({
    queryKey: ["contacts-mini"],
    queryFn: () => apiFetch("contacts?limit=200"),
    enabled: canRead,
  });

  const createTicket = useMutation({
    mutationFn: (body: any) => apiFetch("tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tickets"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); setShowNew(false); resetForm(); },
  });

  const updateTicket = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => apiFetch(`tickets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tickets"] }); setEditTicket(null); },
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiFetch(`tickets/${id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tickets"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); setStatusTicket(null); },
  });

  const deleteTicket = useMutation({
    mutationFn: (id: string) => apiFetch(`tickets/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tickets"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); },
  });

  function resetForm() {
    setForm({ title: "", description: "", priority: "normal", category: "", contactId: prefill?.contactId ?? "", conversationId: prefill?.conversationId ?? "", dueAt: "" });
  }

  const tickets: any[] = data?.tickets ?? [];
  const counts: Record<string, number> = data?.counts ?? {};

  const columns = [
    { key: "number", label: "#", className: "w-10", render: (r: any) => <span className="text-xs text-muted-foreground">#{r.number}</span> },
    { key: "title", label: "الموضوع", render: (r: any) => (
      <div>
        <span className="font-medium text-foreground text-sm">{r.title}</span>
        {r.category && <span className="ms-2 text-xs text-muted-foreground">({r.category})</span>}
      </div>
    )},
    { key: "contactName", label: "العميل", render: (r: any) => <span className="text-muted-foreground text-sm">{r.contactName ?? "—"}</span> },
    { key: "priority", label: "الأولوية", render: (r: any) => <StatusBadge status={r.priority} type="priority" /> },
    { key: "status", label: "الحالة", render: (r: any) => <StatusBadge status={r.status} /> },
    { key: "dueAt", label: "الاستحقاق", render: (r: any) => {
      const isOverdue = r.dueAt && new Date(r.dueAt) < new Date() && !["resolved", "closed"].includes(r.status);
      return <span className={`text-xs ${isOverdue ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{formatDate(r.dueAt)}</span>;
    }},
    { key: "actions", label: "", render: (r: any) => (
      <div className="flex gap-1 justify-end">
        {canUpdate && TICKET_STATUS_ACTIONS[r.status]?.length > 0 && (
          <button onClick={() => setStatusTicket(r)} className="text-xs px-2 py-1 bg-muted hover:bg-muted/80 rounded text-muted-foreground">تغيير الحالة</button>
        )}
        {canUpdate && <button onClick={() => setEditTicket(r)} className="text-xs px-2 py-1 bg-primary/10 hover:bg-primary/20 text-primary rounded">تعديل</button>}
        {canDelete && !["resolved", "closed"].includes(r.status) && (
          <button onClick={() => { if (confirm(`حذف "${r.title}"؟`)) deleteTicket.mutate(r.id); }}
            className="text-xs px-2 py-1 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded">حذف</button>
        )}
      </div>
    )},
  ];

  return (
    <div dir="rtl">
      <PageHeader
        title="التذاكر"
        subtitle="تتبع وحل طلبات الدعم"
        actions={
          canCreate ? (
            <button onClick={() => setShowNew(true)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
              + تذكرة جديدة
            </button>
          ) : (
            <button disabled title="ليس لديك صلاحية إنشاء التذاكر"
              className="px-4 py-2 rounded-lg bg-primary/40 text-primary-foreground text-sm font-semibold cursor-not-allowed opacity-50">
              + تذكرة جديدة
            </button>
          )
        }
      />

      {!canRead ? <PermissionDenied /> : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 w-48"
              placeholder="بحث..." />
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {STATUSES.map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                  {s === "" ? "الكل" : statusLabels[s] ?? s}{s && counts[s] ? ` (${counts[s]})` : ""}
                </button>
              ))}
            </div>
          </div>

          {isError && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm flex items-center justify-between">
              <span>تعذّر تحميل التذاكر</span>
              <button onClick={() => refetch()} className="text-xs underline">إعادة المحاولة</button>
            </div>
          )}
          <DataTable columns={columns} data={tickets} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="لا توجد تذاكر" />
        </>
      )}

      <Modal open={showNew} onClose={() => { setShowNew(false); resetForm(); }} title="تذكرة جديدة">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">الموضوع *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="وصف المشكلة" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">التفاصيل</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              rows={3} placeholder="تفاصيل إضافية..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">الأولوية</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                {PRIORITIES.map((p) => <option key={p} value={p}>{priorityLabels[p]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">التصنيف</label>
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="مثل: فني، مالي..." />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">العميل</label>
              <select value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">بدون عميل</option>
                {contacts?.contacts?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">تاريخ الاستحقاق</label>
              <input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
            </div>
          </div>
          {createTicket.isError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{(createTicket.error as Error)?.message}</div>}
          <button onClick={() => createTicket.mutate({ ...form, contactId: form.contactId || undefined, conversationId: form.conversationId || undefined, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined })}
            disabled={createTicket.isPending || !form.title}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {createTicket.isPending ? "جار الإنشاء..." : "إنشاء التذكرة"}
          </button>
        </div>
      </Modal>

      <Modal open={!!editTicket} onClose={() => setEditTicket(null)} title="تعديل التذكرة">
        {editTicket && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">الموضوع</label>
              <input value={editTicket.title} onChange={(e) => setEditTicket({ ...editTicket, title: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">الأولوية</label>
                <select value={editTicket.priority} onChange={(e) => setEditTicket({ ...editTicket, priority: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  {PRIORITIES.map((p) => <option key={p} value={p}>{priorityLabels[p]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">التصنيف</label>
                <input value={editTicket.category ?? ""} onChange={(e) => setEditTicket({ ...editTicket, category: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            </div>
            {updateTicket.isError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{(updateTicket.error as Error)?.message}</div>}
            <button onClick={() => updateTicket.mutate({ id: editTicket.id, body: { title: editTicket.title, priority: editTicket.priority, category: editTicket.category } })}
              disabled={updateTicket.isPending}
              className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
              {updateTicket.isPending ? "جار الحفظ..." : "حفظ التعديلات"}
            </button>
          </div>
        )}
      </Modal>

      <Modal open={!!statusTicket} onClose={() => setStatusTicket(null)} title="تغيير حالة التذكرة">
        {statusTicket && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">الحالة الحالية: <span className="font-medium text-foreground">{statusLabels[statusTicket.status] ?? statusTicket.status}</span></p>
            <div className="flex flex-col gap-2">
              {(TICKET_STATUS_ACTIONS[statusTicket.status] ?? []).map(({ label, next }) => (
                <button key={next} onClick={() => changeStatus.mutate({ id: statusTicket.id, status: next })}
                  disabled={changeStatus.isPending}
                  className="w-full py-2 rounded-lg border border-border hover:bg-muted text-sm font-medium transition-colors disabled:opacity-50">
                  {label} ← {statusLabels[next] ?? next}
                </button>
              ))}
            </div>
            {changeStatus.isError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{(changeStatus.error as Error)?.message}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
