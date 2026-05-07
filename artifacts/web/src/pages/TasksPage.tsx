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

const STATUSES = ["", "pending", "in_progress", "done", "cancelled"];
const PRIORITIES = ["low", "normal", "high", "urgent"];

const TASK_STATUS_ACTIONS: Record<string, { label: string; next: string }[]> = {
  pending: [{ label: "بدء التنفيذ", next: "in_progress" }, { label: "إنجاز", next: "done" }, { label: "إلغاء", next: "cancelled" }],
  in_progress: [{ label: "إنجاز", next: "done" }, { label: "إلغاء", next: "cancelled" }],
  done: [],
  cancelled: [],
};

function PermissionDenied() {
  return <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm text-center">🔒 ليس لديك صلاحية لتنفيذ هذا الإجراء</div>;
}

export default function TasksPage({ prefill }: { prefill?: { contactId?: string; conversationId?: string } }) {
  const { hasPermission } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(!!prefill);
  const [statusTask, setStatusTask] = useState<any>(null);
  const [form, setForm] = useState({
    title: "", description: "", priority: "normal", dueAt: "",
    contactId: prefill?.contactId ?? "",
    conversationId: prefill?.conversationId ?? "",
  });

  const canRead = hasPermission("tasks:read");
  const canCreate = hasPermission("tasks:create");
  const canUpdate = hasPermission("tasks:update");
  const canDelete = hasPermission("tasks:delete");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["tasks", statusFilter, search],
    queryFn: () => apiFetch(`tasks?status=${statusFilter}&search=${search}&limit=50`),
    enabled: canRead,
  });

  const { data: contacts } = useQuery({
    queryKey: ["contacts-mini"],
    queryFn: () => apiFetch("contacts?limit=200"),
    enabled: canRead,
  });

  const createTask = useMutation({
    mutationFn: (body: any) => apiFetch("tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); setShowNew(false); resetForm(); },
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiFetch(`tasks/${id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); setStatusTask(null); },
  });

  const deleteTask = useMutation({
    mutationFn: (id: string) => apiFetch(`tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); },
  });

  function resetForm() {
    setForm({ title: "", description: "", priority: "normal", dueAt: "", contactId: prefill?.contactId ?? "", conversationId: prefill?.conversationId ?? "" });
  }

  const tasks: any[] = data?.tasks ?? [];
  const counts: Record<string, number> = data?.counts ?? {};

  const columns = [
    { key: "check", label: "", className: "w-8", render: (r: any) => (
      <input type="checkbox" checked={r.status === "done"} disabled={!canUpdate || r.status === "cancelled"}
        onChange={() => canUpdate && r.status !== "done" && changeStatus.mutate({ id: r.id, status: "done" })}
        className="w-4 h-4 accent-primary cursor-pointer disabled:cursor-not-allowed" />
    )},
    { key: "title", label: "المهمة", render: (r: any) => (
      <span className={`font-medium text-sm ${r.status === "done" ? "line-through text-muted-foreground" : r.status === "cancelled" ? "text-muted-foreground" : "text-foreground"}`}>{r.title}</span>
    )},
    { key: "contactName", label: "العميل", render: (r: any) => <span className="text-muted-foreground text-sm">{r.contactName ?? "—"}</span> },
    { key: "priority", label: "الأولوية", render: (r: any) => <StatusBadge status={r.priority} type="priority" /> },
    { key: "status", label: "الحالة", render: (r: any) => <StatusBadge status={r.status} /> },
    { key: "dueAt", label: "الموعد", render: (r: any) => {
      const isOverdue = r.dueAt && new Date(r.dueAt) < new Date() && r.status === "pending";
      return <span className={`text-xs ${isOverdue ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{formatDate(r.dueAt)}</span>;
    }},
    { key: "actions", label: "", render: (r: any) => (
      <div className="flex gap-1 justify-end">
        {canUpdate && TASK_STATUS_ACTIONS[r.status]?.length > 0 && (
          <button onClick={() => setStatusTask(r)} className="text-xs px-2 py-1 bg-muted hover:bg-muted/80 rounded text-muted-foreground">تغيير</button>
        )}
        {canDelete && ["pending", "in_progress"].includes(r.status) && (
          <button onClick={() => { if (confirm(`حذف "${r.title}"؟`)) deleteTask.mutate(r.id); }}
            className="text-xs px-2 py-1 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded">حذف</button>
        )}
      </div>
    )},
  ];

  return (
    <div dir="rtl">
      <PageHeader title="المهام" subtitle="تنظيم وتتبع مهام الفريق"
        actions={canCreate ? (
          <button onClick={() => setShowNew(true)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">+ مهمة جديدة</button>
        ) : (
          <button disabled title="ليس لديك صلاحية إنشاء المهام" className="px-4 py-2 rounded-lg bg-primary/40 text-primary-foreground text-sm font-semibold cursor-not-allowed opacity-50">+ مهمة جديدة</button>
        )}
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
          {isError && <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm flex items-center justify-between"><span>تعذّر تحميل المهام</span><button onClick={() => refetch()} className="text-xs underline">إعادة المحاولة</button></div>}
          <DataTable columns={columns} data={tasks} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="لا توجد مهام" />
        </>
      )}

      <Modal open={showNew} onClose={() => { setShowNew(false); resetForm(); }} title="مهمة جديدة">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">عنوان المهمة *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="ماذا يجب فعله؟" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">التفاصيل</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              rows={2} placeholder="وصف المهمة..." />
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
              <label className="block text-sm font-medium mb-1">الموعد النهائي</label>
              <input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">العميل</label>
            <select value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="">بدون عميل</option>
              {contacts?.contacts?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {createTask.isError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{(createTask.error as Error)?.message}</div>}
          <button onClick={() => createTask.mutate({ ...form, contactId: form.contactId || undefined, conversationId: form.conversationId || undefined, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined })}
            disabled={createTask.isPending || !form.title}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {createTask.isPending ? "جار الإنشاء..." : "إنشاء المهمة"}
          </button>
        </div>
      </Modal>

      <Modal open={!!statusTask} onClose={() => setStatusTask(null)} title="تغيير حالة المهمة">
        {statusTask && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">الحالة الحالية: <span className="font-medium text-foreground">{statusLabels[statusTask.status] ?? statusTask.status}</span></p>
            <div className="flex flex-col gap-2">
              {(TASK_STATUS_ACTIONS[statusTask.status] ?? []).map(({ label, next }) => (
                <button key={next} onClick={() => changeStatus.mutate({ id: statusTask.id, status: next })}
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
