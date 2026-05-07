import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
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

const REPORT_TYPES = [
  { value: "overview", label: "نظرة عامة" },
  { value: "operations", label: "العمليات" },
  { value: "sales", label: "المبيعات" },
  { value: "finance", label: "الماليات" },
  { value: "ai", label: "الذكاء الاصطناعي" },
  { value: "team", label: "الفريق" },
  { value: "channel", label: "القنوات" },
];

const STATUS_LABELS: Record<string, string> = { generated: "مولَّد", failed: "فشل" };
const TYPE_LABELS: Record<string, string> = { overview: "نظرة عامة", operations: "العمليات", sales: "المبيعات", finance: "الماليات", ai: "الذكاء الاصطناعي", team: "الفريق", channel: "القنوات" };

function GeneratedReportView({ data, type }: { data: Record<string, unknown>; type: string }) {
  const entries = Object.entries(data);
  if (!entries.length) return <div className="text-sm text-muted-foreground">لا توجد بيانات</div>;

  return (
    <div className="space-y-3">
      {entries.map(([key, val]) => {
        if (Array.isArray(val)) {
          return (
            <div key={key}>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">{key}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      {val[0] && Object.keys(val[0]).map((k) => <th key={k} className="text-right py-1.5 pr-2 font-medium">{k}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {val.map((row: Record<string, unknown>, i) => (
                      <tr key={i} className="border-b border-border/50">
                        {Object.values(row).map((v, j) => <td key={j} className="py-1.5 pr-2 text-foreground">{String(v ?? "—")}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }
        return (
          <div key={key} className="flex items-center justify-between py-1.5 border-b border-border/30">
            <span className="text-sm text-muted-foreground">{key}</span>
            <span className="text-sm font-medium text-foreground">{typeof val === "number" ? Number(val).toLocaleString("ar-SA") : String(val ?? "—")}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function ReportsPage() {
  const { hasPermission } = useAuth();
  const qc = useQueryClient();

  const canRead = hasPermission("reports:read");
  const canCreate = hasPermission("reports:create");
  const canGenerate = hasPermission("reports:generate");
  const canDelete = hasPermission("reports:delete");

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedReport, setSelectedReport] = useState<Record<string, unknown> | null>(null);
  const [activeTab, setActiveTab] = useState<"definitions" | "generated">("definitions");

  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [createForm, setCreateForm] = useState({ name: "", type: "overview", description: "" });
  const [generateForm, setGenerateForm] = useState({ type: "overview", title: "", dateFrom: thirtyDaysAgo.toISOString().split("T")[0], dateTo: today, reportDefinitionId: "" });

  const definitions = useQuery({ queryKey: ["report-definitions"], queryFn: () => apiFetch("reports/definitions"), enabled: canRead });
  const generated = useQuery({ queryKey: ["generated-reports"], queryFn: () => apiFetch("reports/generated"), enabled: canRead });

  const createDef = useMutation({
    mutationFn: (data: typeof createForm) => apiFetch("reports/definitions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["report-definitions"] }); setShowCreateModal(false); setCreateForm({ name: "", type: "overview", description: "" }); },
  });

  const deleteDef = useMutation({
    mutationFn: (id: string) => apiFetch(`reports/definitions/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["report-definitions"] }),
  });

  const generate = useMutation({
    mutationFn: (data: typeof generateForm) => apiFetch("reports/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, reportDefinitionId: data.reportDefinitionId || undefined }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["generated-reports"] }); setShowGenerateModal(false); setActiveTab("generated"); },
  });

  if (!canRead) {
    return (
      <div className="flex items-center justify-center min-h-[300px]" dir="rtl">
        <div className="text-center">
          <div className="text-4xl mb-3">🔒</div>
          <p className="text-muted-foreground">ليس لديك صلاحية عرض التقارير</p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl">
      <PageHeader
        title="التقارير"
        subtitle="إدارة وتوليد تقارير الأداء"
        actions={
          <div className="flex gap-2">
            {canGenerate && (
              <button onClick={() => setShowGenerateModal(true)} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                توليد تقرير
              </button>
            )}
            {canCreate && (
              <button onClick={() => setShowCreateModal(true)} className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted">
                تعريف جديد
              </button>
            )}
          </div>
        }
      />

      <div className="flex gap-1 mb-5 border-b border-border">
        {[{ key: "definitions", label: "تعريفات التقارير" }, { key: "generated", label: "التقارير المولّدة" }].map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key as "definitions" | "generated")}
            className={cn("px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              activeTab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── DEFINITIONS ─── */}
      {activeTab === "definitions" && (
        <div className="space-y-3">
          {definitions.isLoading && <div className="text-sm text-muted-foreground py-8 text-center">جار التحميل...</div>}
          {definitions.isError && <div className="text-sm text-destructive py-4">{(definitions.error as Error).message}</div>}
          {definitions.data?.definitions?.length === 0 && (
            <div className="text-sm text-muted-foreground py-12 text-center">
              <div className="text-3xl mb-2">📋</div>
              لا توجد تعريفات تقارير بعد. {canCreate && "أنشئ تعريفاً جديداً للبدء."}
            </div>
          )}
          {(definitions.data?.definitions ?? []).map((def: { id: string; name: string; type: string; description?: string; createdAt: string }) => (
            <div key={def.id} className="bg-card border border-border rounded-xl p-4 flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-foreground">{def.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{TYPE_LABELS[def.type] ?? def.type}</div>
                {def.description && <div className="text-xs text-muted-foreground mt-1">{def.description}</div>}
                <div className="text-xs text-muted-foreground/60 mt-1">{new Date(def.createdAt).toLocaleDateString("ar-SA")}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                {canGenerate && (
                  <button onClick={() => { setGenerateForm((f) => ({ ...f, type: def.type, reportDefinitionId: def.id })); setShowGenerateModal(true); }}
                    className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
                    توليد
                  </button>
                )}
                {canDelete && (
                  <button onClick={() => deleteDef.mutate(def.id)} disabled={deleteDef.isPending}
                    className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50">
                    أرشفة
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── GENERATED ─── */}
      {activeTab === "generated" && (
        <div className="space-y-3">
          {generated.isLoading && <div className="text-sm text-muted-foreground py-8 text-center">جار التحميل...</div>}
          {generated.isError && <div className="text-sm text-destructive py-4">{(generated.error as Error).message}</div>}
          {generated.data?.reports?.length === 0 && (
            <div className="text-sm text-muted-foreground py-12 text-center">
              <div className="text-3xl mb-2">📊</div>
              لا توجد تقارير مولّدة بعد. {canGenerate && "ولّد أول تقرير الآن."}
            </div>
          )}
          {(generated.data?.reports ?? []).map((r: { id: string; title: string; type: string; status: string; dateFrom: string; dateTo: string; createdAt: string; data: Record<string, unknown> }) => (
            <div key={r.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="font-medium text-foreground">{r.title}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">{TYPE_LABELS[r.type] ?? r.type}</span>
                    <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium", r.status === "generated" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600")}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    من {r.dateFrom} إلى {r.dateTo} · تم التوليد {new Date(r.createdAt).toLocaleDateString("ar-SA")}
                  </div>
                </div>
                <button onClick={() => setSelectedReport(selectedReport?.id === r.id ? null : { ...r.data as Record<string, unknown>, id: r.id })}
                  className="px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-muted shrink-0">
                  {selectedReport?.id === r.id ? "إخفاء" : "عرض البيانات"}
                </button>
              </div>
              {selectedReport?.id === r.id && (
                <div className="mt-3 pt-3 border-t border-border">
                  <GeneratedReportView data={r.data} type={r.type} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── Create Definition Modal ─── */}
      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="إنشاء تعريف تقرير" size="sm">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">اسم التقرير *</label>
            <input value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="مثال: تقرير المبيعات الشهري"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">نوع التقرير</label>
            <select value={createForm.type} onChange={(e) => setCreateForm((f) => ({ ...f, type: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20">
              {REPORT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">الوصف (اختياري)</label>
            <textarea value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              rows={2} className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          {createDef.isError && <div className="text-xs text-destructive">{(createDef.error as Error).message}</div>}
          <div className="flex gap-2 justify-end pt-1">
            <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted">إلغاء</button>
            <button onClick={() => createDef.mutate(createForm)} disabled={!createForm.name.trim() || createDef.isPending}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
              {createDef.isPending ? "جار الحفظ..." : "حفظ"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ─── Generate Modal ─── */}
      <Modal open={showGenerateModal} onClose={() => setShowGenerateModal(false)} title="توليد تقرير" size="sm">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">نوع التقرير</label>
            <select value={generateForm.type} onChange={(e) => setGenerateForm((f) => ({ ...f, type: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20">
              {REPORT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">عنوان التقرير (اختياري)</label>
            <input value={generateForm.title} onChange={(e) => setGenerateForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="يُنشأ تلقائياً إذا تُرك فارغاً"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium mb-1">من تاريخ</label>
              <input type="date" value={generateForm.dateFrom} onChange={(e) => setGenerateForm((f) => ({ ...f, dateFrom: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">إلى تاريخ</label>
              <input type="date" value={generateForm.dateTo} onChange={(e) => setGenerateForm((f) => ({ ...f, dateTo: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>
          {generate.isError && <div className="text-xs text-destructive">{(generate.error as Error).message}</div>}
          <div className="flex gap-2 justify-end pt-1">
            <button onClick={() => setShowGenerateModal(false)} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted">إلغاء</button>
            <button onClick={() => generate.mutate(generateForm)} disabled={generate.isPending}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
              {generate.isPending ? "جار التوليد..." : "توليد التقرير"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
