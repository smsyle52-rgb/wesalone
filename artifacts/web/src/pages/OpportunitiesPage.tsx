import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatCurrency, statusLabels, stageLabels } from "@/lib/utils";
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

const STAGES = ["", "new", "qualified", "proposal", "negotiation", "won", "lost"];
const TERMINAL_STAGES = ["won", "lost"];

const STAGE_ACTIONS: Record<string, { label: string; next: string }[]> = {
  new: [{ label: "تأهيل", next: "qualified" }, { label: "خسارة", next: "lost" }],
  qualified: [{ label: "إرسال عرض", next: "proposal" }, { label: "خسارة", next: "lost" }],
  proposal: [{ label: "دخول التفاوض", next: "negotiation" }, { label: "خسارة", next: "lost" }],
  negotiation: [{ label: "ربح", next: "won" }, { label: "خسارة", next: "lost" }],
  won: [],
  lost: [],
};

function PermissionDenied() {
  return <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm text-center">🔒 ليس لديك صلاحية لتنفيذ هذا الإجراء</div>;
}

export default function OpportunitiesPage({ prefill }: { prefill?: { contactId?: string; conversationId?: string } }) {
  const { hasPermission } = useAuth();
  const qc = useQueryClient();
  const [stageFilter, setStageFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(!!prefill);
  const [stageModal, setStageModal] = useState<any>(null);
  const [lostReason, setLostReason] = useState("");
  const [orderFromOpp, setOrderFromOpp] = useState<any>(null);
  const [orderCurrency, setOrderCurrency] = useState("YER");
  const [form, setForm] = useState({
    title: "", value: "", currency: "YER", stage: "new", probability: "", notes: "",
    contactId: prefill?.contactId ?? "",
    conversationId: prefill?.conversationId ?? "",
    expectedCloseDate: "",
  });

  const canRead = hasPermission("opportunities:read");
  const canCreate = hasPermission("opportunities:create");
  const canUpdate = hasPermission("opportunities:update");
  const canDelete = hasPermission("opportunities:delete");
  const canCreateOrder = hasPermission("orders:create");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["opportunities", stageFilter, search],
    queryFn: () => apiFetch(`opportunities?stage=${stageFilter}&search=${search}&limit=50`),
    enabled: canRead,
  });

  const { data: contacts } = useQuery({
    queryKey: ["contacts-mini"],
    queryFn: () => apiFetch("contacts?limit=200"),
    enabled: canRead,
  });

  const createOpp = useMutation({
    mutationFn: (body: any) => apiFetch("opportunities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["opportunities"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); setShowNew(false); resetForm(); },
  });

  const changeStage = useMutation({
    mutationFn: ({ id, stage, lostReason }: { id: string; stage: string; lostReason?: string }) =>
      apiFetch(`opportunities/${id}/stage`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage, lostReason }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["opportunities"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); setStageModal(null); setLostReason(""); },
  });

  const deleteOpp = useMutation({
    mutationFn: (id: string) => apiFetch(`opportunities/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["opportunities"] }); },
  });

  const createOrderFromOpp = useMutation({
    mutationFn: (body: any) => apiFetch("orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); setOrderFromOpp(null); setOrderCurrency("YER"); },
  });

  function resetForm() {
    setForm({ title: "", value: "", currency: "YER", stage: "new", probability: "", notes: "", contactId: prefill?.contactId ?? "", conversationId: prefill?.conversationId ?? "", expectedCloseDate: "" });
  }

  const opportunities: any[] = data?.opportunities ?? [];
  const stageCounts: Record<string, number> = data?.stageCounts ?? {};
  const pipelineValue: number = data?.pipelineValue ?? 0;

  const columns = [
    { key: "title", label: "الفرصة", render: (r: any) => (
      <div>
        <span className="font-medium text-foreground text-sm">{r.title}</span>
        {r.notes && <p className="text-xs text-muted-foreground mt-0.5">{r.notes.slice(0, 40)}...</p>}
      </div>
    )},
    { key: "contactName", label: "العميل", render: (r: any) => <span className="text-muted-foreground text-sm">{r.contactName ?? "—"}</span> },
    { key: "value", label: "القيمة", render: (r: any) => <span className="font-semibold text-sm">{r.value ? formatCurrency(r.value, r.currency) : "—"}</span> },
    { key: "stage", label: "المرحلة", render: (r: any) => <StatusBadge status={r.stage} /> },
    { key: "probability", label: "الاحتمال", render: (r: any) => <span className="text-muted-foreground text-sm">{r.probability != null ? `${r.probability}%` : "—"}</span> },
    { key: "expectedCloseDate", label: "إغلاق متوقع", render: (r: any) => <span className="text-xs text-muted-foreground">{formatDate(r.expectedCloseDate)}</span> },
    { key: "actions", label: "", render: (r: any) => (
      <div className="flex gap-1 justify-end">
        {canUpdate && !TERMINAL_STAGES.includes(r.stage) && (
          <button onClick={() => setStageModal(r)} className="text-xs px-2 py-1 bg-muted hover:bg-muted/80 rounded text-muted-foreground">تغيير المرحلة</button>
        )}
        {r.stage === "won" && canCreateOrder && (
          <button onClick={() => { setOrderFromOpp(r); setOrderCurrency(r.currency ?? "YER"); }}
            className="text-xs px-2 py-1 bg-primary/10 hover:bg-primary/20 text-primary rounded">إنشاء طلب</button>
        )}
        {canDelete && !TERMINAL_STAGES.includes(r.stage) && (
          <button onClick={() => { if (confirm(`حذف "${r.title}"؟`)) deleteOpp.mutate(r.id); }}
            className="text-xs px-2 py-1 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded">حذف</button>
        )}
      </div>
    )},
  ];

  return (
    <div dir="rtl">
      <PageHeader title="الفرص" subtitle={`تتبع فرص المبيعات — خط الأعمال: ${formatCurrency(pipelineValue, "YER")}`}
        actions={canCreate ? (
          <button onClick={() => setShowNew(true)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">+ فرصة جديدة</button>
        ) : (
          <button disabled title="ليس لديك صلاحية إنشاء الفرص" className="px-4 py-2 rounded-lg bg-primary/40 text-primary-foreground text-sm font-semibold cursor-not-allowed opacity-50">+ فرصة جديدة</button>
        )}
      />

      {!canRead ? <PermissionDenied /> : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 w-48"
              placeholder="بحث..." />
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {STAGES.map((s) => (
                <button key={s} onClick={() => setStageFilter(s)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${stageFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                  {s === "" ? "الكل" : stageLabels[s] ?? statusLabels[s] ?? s}{s && stageCounts[s] ? ` (${stageCounts[s]})` : ""}
                </button>
              ))}
            </div>
          </div>
          {isError && <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm flex items-center justify-between"><span>تعذّر تحميل الفرص</span><button onClick={() => refetch()} className="text-xs underline">إعادة المحاولة</button></div>}
          <DataTable columns={columns} data={opportunities} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="لا توجد فرص" />
        </>
      )}

      <Modal open={showNew} onClose={() => { setShowNew(false); resetForm(); }} title="فرصة جديدة">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">عنوان الفرصة *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="مثل: عقد توريد أجهزة" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">العميل</label>
            <select value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="">بدون عميل</option>
              {contacts?.contacts?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">القيمة</label>
              <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="0" dir="ltr" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">العملة</label>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="YER">ريال يمني</option>
                <option value="USD">دولار</option>
                <option value="SAR">ريال سعودي</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">المرحلة</label>
              <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                {STAGES.filter(Boolean).filter(s => !TERMINAL_STAGES.includes(s)).map((s) => <option key={s} value={s}>{stageLabels[s] ?? statusLabels[s] ?? s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">نسبة النجاح %</label>
              <input type="number" value={form.probability} onChange={(e) => setForm({ ...form, probability: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                min="0" max="100" placeholder="0-100" dir="ltr" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">ملاحظات</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              rows={2} placeholder="تفاصيل إضافية..." />
          </div>
          {createOpp.isError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{(createOpp.error as Error)?.message}</div>}
          <button onClick={() => createOpp.mutate({ ...form, contactId: form.contactId || undefined, conversationId: form.conversationId || undefined, value: form.value ? Number(form.value) : undefined, probability: form.probability ? Number(form.probability) : undefined })}
            disabled={createOpp.isPending || !form.title}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {createOpp.isPending ? "جار الإنشاء..." : "إنشاء الفرصة"}
          </button>
        </div>
      </Modal>

      <Modal open={!!orderFromOpp} onClose={() => { setOrderFromOpp(null); setOrderCurrency("YER"); }} title="إنشاء طلب من الفرصة">
        {orderFromOpp && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">إنشاء طلب مرتبط بالفرصة: <span className="font-medium text-foreground">{orderFromOpp.title}</span></p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">القناة</label>
                <select className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" id="opp-order-channel">
                  {[["manual","يدوي"],["whatsapp","واتساب"],["phone","هاتف"],["website","موقع"],["walk_in","حضوري"]].map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">العملة</label>
                <select value={orderCurrency} onChange={(e) => setOrderCurrency(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="YER">ريال يمني</option>
                  <option value="SAR">ريال سعودي</option>
                  <option value="USD">دولار</option>
                </select>
              </div>
            </div>
            {createOrderFromOpp.isError && (
              <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{(createOrderFromOpp.error as Error)?.message}</div>
            )}
            <button
              onClick={() => {
                const channelEl = document.getElementById("opp-order-channel") as HTMLSelectElement;
                createOrderFromOpp.mutate({ contactId: orderFromOpp.contactId || undefined, opportunityId: orderFromOpp.id, channel: channelEl?.value ?? "manual", currency: orderCurrency });
              }}
              disabled={createOrderFromOpp.isPending}
              className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
              {createOrderFromOpp.isPending ? "جار الإنشاء..." : "إنشاء الطلب"}
            </button>
          </div>
        )}
      </Modal>

      <Modal open={!!stageModal} onClose={() => { setStageModal(null); setLostReason(""); }} title="تغيير مرحلة الفرصة">
        {stageModal && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">المرحلة الحالية: <span className="font-medium text-foreground">{stageLabels[stageModal.stage] ?? stageModal.stage}</span></p>
            <div className="flex flex-col gap-2">
              {(STAGE_ACTIONS[stageModal.stage] ?? []).filter(a => a.next !== "lost").map(({ label, next }) => (
                <button key={next} onClick={() => changeStage.mutate({ id: stageModal.id, stage: next })}
                  disabled={changeStage.isPending}
                  className="w-full py-2 rounded-lg border border-border hover:bg-muted text-sm font-medium transition-colors disabled:opacity-50">
                  {label} ← {stageLabels[next] ?? next}
                </button>
              ))}
            </div>
            {(STAGE_ACTIONS[stageModal.stage] ?? []).some(a => a.next === "lost") && (
              <div className="space-y-2 border-t border-border pt-3">
                <label className="block text-xs font-medium text-destructive">وضع علامة خسارة (مطلوب: سبب الخسارة)</label>
                <textarea value={lostReason} onChange={(e) => setLostReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-destructive/30 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-destructive/30 resize-none"
                  rows={2} placeholder="سبب الخسارة..." />
                <button onClick={() => changeStage.mutate({ id: stageModal.id, stage: "lost", lostReason })}
                  disabled={changeStage.isPending || !lostReason.trim()}
                  className="w-full py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50">
                  تأكيد الخسارة
                </button>
              </div>
            )}
            {changeStage.isError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{(changeStage.error as Error)?.message}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
