import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/components/ui/DataTable";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import { formatDateTime } from "@/lib/utils";

const BASE = `${import.meta.env.BASE_URL}api`;

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const json = JSON.parse(text);
      if (typeof json.error === "string" && json.error.trim()) {
        message = json.error;
      }
    } catch {
      message = text;
    }
    throw new Error(message);
  }
  return res.json();
}

type AgentRow = {
  id: string;
  name: string;
  defaultModel: string;
  status: string;
  updatedAt?: string | null;
};

const WIZARD_STEPS = [
  { n: 1, label: "الاسم" },
  { n: 2, label: "نوع النشاط" },
  { n: 3, label: "التعليمات" },
  { n: 4, label: "المعرفة" },
  { n: 5, label: "وضع الرد" },
];

const TRUST_OPTIONS = [
  { value: "suggest", title: "اقتراح فقط", desc: "يكتب الوكيل ردًا مقترحًا وأنت تراجعه وترسله. الأنسب للبداية." },
  { value: "auto", title: "رد تلقائي", desc: "يرسل الوكيل ردوده تلقائيًا ضمن الحدود التي تضبطها." },
  { value: "auto_after_hours", title: "تلقائي بعد الدوام", desc: "اقتراح أثناء الدوام، وتلقائي خارج ساعات العمل." },
];

// قائمة احتياطية لأنواع النشاط حين لا يرجع الـAPI قطاعات (مطابقة لشاشة الإعداد onboarding).
const BUSINESS_TYPES: Array<{ key: string; label: string }> = [
  { key: "retail_general", label: "تجزئة وبيع عام" },
  { key: "food_restaurant", label: "مطعم وأغذية" },
  { key: "services_general", label: "خدمات عامة" },
  { key: "beauty_wellness", label: "صالونات وعناية" },
  { key: "real_estate", label: "عقارات" },
  { key: "healthcare", label: "صحة وعيادات" },
  { key: "education", label: "تعليم وتدريب" },
  { key: "technology", label: "تقنية" },
  { key: "travel_tourism", label: "سياحة وسفر" },
  { key: "other", label: "أخرى" },
];

function CreateAgentWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    sectorKey: "",
    rolePrompt: "",
    businessRules: "",
    knowledgeBaseIds: [] as string[],
    trustMode: "suggest",
  });

  const sectorsQuery = useQuery({ queryKey: ["sector-profiles"], queryFn: () => apiFetch("sectors") });
  const basesQuery = useQuery({ queryKey: ["knowledge-bases-for-agent"], queryFn: () => apiFetch("knowledge/bases") });
  const sectors: any[] = sectorsQuery.data?.sectors ?? [];
  const bases: any[] = basesQuery.data?.bases ?? [];
  const displaySectors: Array<{ key: string; label: string }> = sectors.length > 0
    ? sectors.map((s) => ({ key: s.sectorKey, label: s.nameAr }))
    : BUSINESS_TYPES;

  useEffect(() => {
    if (!form.sectorKey && displaySectors.length > 0) {
      setForm((f) => ({ ...f, sectorKey: displaySectors[0].key }));
    }
  }, [displaySectors, form.sectorKey]);

  function toggleBase(id: string) {
    setForm((f) => ({
      ...f,
      knowledgeBaseIds: f.knowledgeBaseIds.includes(id)
        ? f.knowledgeBaseIds.filter((x) => x !== id)
        : [...f.knowledgeBaseIds, id],
    }));
  }

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiFetch("ai/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), type: "support", defaultModel: "mock", dialect: "standard_arabic" }),
      });
      const id = created.agent.id as string;
      await apiFetch(`ai/agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectorKey: form.sectorKey || undefined,
          knowledgeBaseIds: form.knowledgeBaseIds,
          trustMode: form.trustMode,
        }),
      });
      if (form.rolePrompt.trim() || form.businessRules.trim()) {
        await apiFetch(`ai/agents/${id}/instructions`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rolePrompt: form.rolePrompt, businessRules: form.businessRules, forbiddenActions: "", escalationRules: "" }),
        });
      }
      onCreated(id);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  const canNext = step !== 1 || form.name.trim().length > 0;

  return (
    <div dir="rtl" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">إنشاء وكيل جديد</h2>
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm hover:bg-muted">إلغاء</button>
        </div>

        <div className="mb-5 flex items-end gap-1.5">
          {WIZARD_STEPS.map((s) => (
            <div key={s.n} className="flex-1">
              <div className={`h-1.5 rounded-full ${s.n <= step ? "bg-primary" : "bg-muted"}`} />
              <div className={`mt-1 text-center text-[11px] ${s.n === step ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{s.label}</div>
            </div>
          ))}
        </div>

        <div className="min-h-[200px] space-y-3 text-sm">
          {step === 1 && (
            <label className="block space-y-1">
              <span className="font-medium">اسم الوكيل</span>
              <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2" placeholder="مثال: وكيل المبيعات، دعم العملاء" />
              <span className="block text-xs text-muted-foreground">اسم داخلي يساعدك على تمييز الوكيل في القائمة.</span>
            </label>
          )}

          {step === 2 && (
            <label className="block space-y-1">
              <span className="font-medium">نوع النشاط</span>
              <select value={form.sectorKey} onChange={(e) => setForm({ ...form, sectorKey: e.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2">
                {displaySectors.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <span className="block text-xs text-muted-foreground">يضبط أسلوب الوكيل ليناسب مجال عملك. يمكنك تغييره لاحقًا.</span>
            </label>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="font-medium">دور الوكيل</span>
                <textarea value={form.rolePrompt} onChange={(e) => setForm({ ...form, rolePrompt: e.target.value })} rows={3} className="w-full rounded-lg border border-input bg-background px-3 py-2" placeholder="مثال: موظف مبيعات لمتجر عطور، يرحّب بالعميل ويساعده في اختيار المنتج وإتمام الطلب." />
              </label>
              <label className="block space-y-1">
                <span className="font-medium">قواعد وحقائق نشاطك</span>
                <textarea value={form.businessRules} onChange={(e) => setForm({ ...form, businessRules: e.target.value })} rows={4} className="w-full rounded-lg border border-input bg-background px-3 py-2" placeholder="مثال: التوصيل خلال ٢٤ ساعة داخل المدينة. لا يوجد استرجاع بعد الاستخدام. الدفع عند الاستلام متاح." />
                <span className="block text-xs text-muted-foreground">كل ما يُكتب هنا يلتزم به الوكيل في ردوده. اختياري الآن — يمكن إكماله لاحقًا.</span>
              </label>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-2">
              <span className="font-medium">ربط قاعدة المعرفة</span>
              {bases.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  لا توجد قواعد معرفة بعد. يمكنك إنشاؤها من صفحة «قاعدة المعرفة» وربطها لاحقًا.
                </div>
              ) : (
                <div className="space-y-2">
                  {bases.map((b) => (
                    <label key={b.id} className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/50">
                      <input type="checkbox" checked={form.knowledgeBaseIds.includes(b.id)} onChange={() => toggleBase(b.id)} />
                      <span className="font-medium">{b.name}</span>
                      {b.description && <span className="text-xs text-muted-foreground">{b.description}</span>}
                    </label>
                  ))}
                </div>
              )}
              <span className="block text-xs text-muted-foreground">قاعدة المعرفة هي مصدر الوكيل للإجابة عن منتجاتك وسياساتك.</span>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-2">
              <span className="font-medium">وضع الرد</span>
              {TRUST_OPTIONS.map((o) => (
                <label key={o.value} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${form.trustMode === o.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}>
                  <input type="radio" name="trustMode" className="mt-1" checked={form.trustMode === o.value} onChange={() => setForm({ ...form, trustMode: o.value })} />
                  <span>
                    <span className="block font-medium">{o.title}</span>
                    <span className="block text-xs text-muted-foreground">{o.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {error && <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        <div className="mt-5 flex items-center justify-between">
          <button onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1 || submitting} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-40">السابق</button>
          {step < 5 ? (
            <button onClick={() => setStep((s) => s + 1)} disabled={!canNext} className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">التالي</button>
          ) : (
            <button onClick={handleCreate} disabled={submitting || !form.name.trim()} className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{submitting ? "جارٍ الإنشاء…" : "إنشاء الوكيل"}</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const { t } = useTranslation("pages");
  const { hasPermission } = useAuth();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canRead = hasPermission("ai:read");
  const canConfigure = hasPermission("ai:configure");

  const agentsQuery = useQuery({
    queryKey: ["ai-agents"],
    queryFn: () => apiFetch("ai/agents"),
    enabled: canRead,
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action, status }: { id: string; action: "duplicate" | "delete" | "status"; status?: string }) => {
      if (action === "duplicate") return apiFetch(`ai/agents/${id}/duplicate`, { method: "POST" });
      if (action === "delete") return apiFetch(`ai/agents/${id}`, { method: "DELETE" });
      return apiFetch(`ai/agents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-agents"] }),
    onError: (err) => setMessage((err as Error).message),
  });

  const agents: AgentRow[] = agentsQuery.data?.agents ?? [];

  const columns = [
    { key: "name", label: t("agents.table.name"), render: (row: AgentRow) => <button className="font-medium text-primary hover:underline" onClick={() => setLocation(`/agents/${row.id}`)}>{row.name}</button> },
    { key: "status", label: t("agents.table.status"), render: (row: AgentRow) => <StatusBadge status={row.status} /> },
    { key: "updatedAt", label: t("agents.table.updatedAt"), render: (row: AgentRow) => formatDateTime(row.updatedAt) },
    {
      key: "actions",
      label: t("agents.table.actions"),
      render: (row: AgentRow) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background hover:bg-muted">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="w-44">
            <DropdownMenuItem className="cursor-pointer text-start" onSelect={() => setLocation(`/agents/${row.id}`)}>
              {t("common.edit")}
            </DropdownMenuItem>
            {canConfigure && (
              <DropdownMenuItem className="cursor-pointer text-start" onSelect={() => actionMutation.mutate({ id: row.id, action: "duplicate" })}>
                {t("common.duplicate")}
              </DropdownMenuItem>
            )}
            {canConfigure && (
              <DropdownMenuItem className="cursor-pointer text-start" onSelect={() => actionMutation.mutate({ id: row.id, action: "status", status: row.status === "active" ? "disabled" : "active" })}>
                {row.status === "active" ? t("agents.actions.disable") : t("common.activate")}
              </DropdownMenuItem>
            )}
            {canConfigure && (
              <DropdownMenuItem className="cursor-pointer text-start text-destructive focus:bg-destructive/10 focus:text-destructive" onSelect={() => actionMutation.mutate({ id: row.id, action: "delete" })}>
                {t("common.delete")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  if (!canRead) {
    return <div dir="rtl" className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-800">{t("agents.permissionDenied")}</div>;
  }

  return (
    <div dir="rtl">
      <PageHeader
        title={t("agents.title")}
        subtitle={t("agents.subtitle")}
        actions={
          canConfigure && (
            <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4" />
              {t("agents.newAgent")}
            </button>
          )
        }
      />

      {message && <div className="mb-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{message}</div>}

      <DataTable
        columns={columns}
        data={agents}
        keyExtractor={(row) => row.id}
        isLoading={agentsQuery.isLoading}
        emptyMessage="لا يوجد وكلاء بعد. أنشئ وكيلًا أولًا، اربطه بقاعدة معرفة، واجعله في وضع الاقتراح قبل التشغيل."
      />

      {showCreate && (
        <CreateAgentWizard
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            qc.invalidateQueries({ queryKey: ["ai-agents"] });
            setShowCreate(false);
            setLocation(`/agents/${id}`);
          }}
        />
      )}
    </div>
  );
}
