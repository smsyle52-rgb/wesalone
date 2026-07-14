import { useState } from "react";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { formatDate, statusLabels, followupTypeLabels } from "@/lib/utils";
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

const STATUSES = ["", "pending", "overdue", "done", "skipped"];
const FOLLOWUP_TYPES = ["manual", "sales", "support", "collection", "reminder"];

function PermissionDenied() {
  return <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm text-center">🔒 ليس لديك صلاحية لتنفيذ هذا الإجراء</div>;
}

export default function FollowupsPage({ prefill }: { prefill?: { contactId?: string; conversationId?: string } }) {
  const { hasPermission } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [showNew, setShowNew] = useState(!!prefill);
  const [completeFollowup, setCompleteFollowup] = useState<any>(null);
  const [skipReason, setSkipReason] = useState("");
  const [form, setForm] = useState({
    type: "manual", dueAt: "", notes: "",
    contactId: prefill?.contactId ?? "",
    conversationId: prefill?.conversationId ?? "",
  });

  const canRead = hasPermission("followups:read");
  const canCreate = hasPermission("followups:create");
  const canUpdate = hasPermission("followups:update");
  const canDelete = hasPermission("followups:delete");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["followups", statusFilter],
    queryFn: () => apiFetch(`followups?status=${statusFilter}&limit=50`),
    enabled: canRead,
  });

  const { data: contacts } = useQuery({
    queryKey: ["contacts-mini"],
    queryFn: () => apiFetch("contacts?limit=200"),
    enabled: canRead,
  });

  const createFollowup = useMutation({
    mutationFn: (body: any) => apiFetch("followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["followups"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); setShowNew(false); resetForm(); },
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status, skippedReason }: { id: string; status: string; skippedReason?: string }) =>
      apiFetch(`followups/${id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, skippedReason }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["followups"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); setCompleteFollowup(null); setSkipReason(""); },
  });

  const deleteFollowup = useMutation({
    mutationFn: (id: string) => apiFetch(`followups/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["followups"] }); },
  });

  function resetForm() {
    setForm({ type: "manual", dueAt: "", notes: "", contactId: prefill?.contactId ?? "", conversationId: prefill?.conversationId ?? "" });
  }

  const followups: any[] = data?.followups ?? [];
  const counts: Record<string, number> = data?.counts ?? {};

  const columns = [
    { key: "type", label: "النوع", render: (r: any) => <span className="text-sm font-medium">{followupTypeLabels[r.type] ?? r.type}</span> },
    { key: "contactName", label: "العميل", render: (r: any) => <span className="text-muted-foreground text-sm">{r.contactName ?? "—"}</span> },
    { key: "dueAt", label: "الموعد", render: (r: any) => {
      const isOverdue = r.dueAt && new Date(r.dueAt) < new Date() && r.status === "pending";
      return <span className={`text-xs ${isOverdue ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{formatDate(r.dueAt)}</span>;
    }},
    { key: "notes", label: "الملاحظات", render: (r: any) => <span className="text-muted-foreground text-xs">{r.notes ? r.notes.slice(0, 40) + (r.notes.length > 40 ? "..." : "") : "—"}</span> },
    { key: "status", label: "الحالة", render: (r: any) => <StatusBadge status={r.status} /> },
    { key: "actions", label: "", render: (r: any) => (
      <div className="flex gap-1 justify-end">
        {canUpdate && ["pending", "overdue"].includes(r.status) && (
          <button onClick={() => setCompleteFollowup(r)} className="text-xs px-2 py-1 bg-muted hover:bg-muted/80 rounded text-muted-foreground">إجراء</button>
        )}
        {canDelete && ["pending", "overdue"].includes(r.status) && (
          <button onClick={async () => { if (await confirmDialog("حذف هذه المتابعة؟")) deleteFollowup.mutate(r.id); }}
            className="text-xs px-2 py-1 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded">حذف</button>
        )}
      </div>
    )},
  ];

  return (
    <div dir="rtl">
      <PageHeader title="المتابعات" subtitle="تذكيرات ومتابعات العملاء"
        actions={canCreate ? (
          <button onClick={() => setShowNew(true)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">+ متابعة جديدة</button>
        ) : (
          <button disabled title="ليس لديك صلاحية إنشاء المتابعات" className="px-4 py-2 rounded-lg bg-primary/40 text-primary-foreground text-sm font-semibold cursor-not-allowed opacity-50">+ متابعة جديدة</button>
        )}
      />

      {!canRead ? <PermissionDenied /> : (
        <>
          <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
            {STATUSES.map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                {s === "" ? "الكل" : statusLabels[s] ?? s}{s && counts[s] ? ` (${counts[s]})` : ""}
              </button>
            ))}
          </div>
          {isError && <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm flex items-center justify-between"><span>تعذّر تحميل المتابعات</span><button onClick={() => refetch()} className="text-xs underline">إعادة المحاولة</button></div>}
          <DataTable columns={columns} data={followups} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="لا توجد متابعات" />
        </>
      )}

      <Modal open={showNew} onClose={() => { setShowNew(false); resetForm(); }} title="متابعة جديدة">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">نوع المتابعة</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                {FOLLOWUP_TYPES.map((t) => <option key={t} value={t}>{followupTypeLabels[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">تاريخ المتابعة *</label>
              <input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">العميل *</label>
            <select value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="">اختر عميلاً</option>
              {contacts?.contacts?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">ملاحظات</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              rows={2} placeholder="ملاحظات إضافية..." />
          </div>
          {createFollowup.isError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{(createFollowup.error as Error)?.message}</div>}
          <button onClick={() => createFollowup.mutate({ ...form, contactId: form.contactId || undefined, conversationId: form.conversationId || undefined, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined })}
            disabled={createFollowup.isPending || !form.dueAt || !form.contactId}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {createFollowup.isPending ? "جار الإنشاء..." : "إنشاء المتابعة"}
          </button>
        </div>
      </Modal>

      <Modal open={!!completeFollowup} onClose={() => { setCompleteFollowup(null); setSkipReason(""); }} title="إجراء على المتابعة">
        {completeFollowup && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">الحالة الحالية: <span className="font-medium text-foreground">{statusLabels[completeFollowup.status] ?? completeFollowup.status}</span></p>
            <button onClick={() => changeStatus.mutate({ id: completeFollowup.id, status: "done" })}
              disabled={changeStatus.isPending}
              className="w-full py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              ✓ تم الإنجاز
            </button>
            <div className="space-y-2">
              <textarea value={skipReason} onChange={(e) => setSkipReason(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                rows={2} placeholder="سبب التخطي (مطلوب للتخطي)..." />
              <button onClick={() => changeStatus.mutate({ id: completeFollowup.id, status: "skipped", skippedReason: skipReason })}
                disabled={changeStatus.isPending || !skipReason.trim()}
                className="w-full py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50">
                تخطي المتابعة
              </button>
            </div>
            {changeStatus.isError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{(changeStatus.error as Error)?.message}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
