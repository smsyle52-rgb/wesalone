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

const AGENT_TYPE_LABELS: Record<string, string> = {
  support: "دعم العملاء",
  sales: "المبيعات",
  followup: "المتابعات",
  summarizer: "التلخيص",
  classifier: "التصنيف",
  reports: "التقارير",
  collections: "التحصيل",
};

const MODEL_LABELS: Record<string, string> = {
  mock: "وضع تجريبي",
  gemini_flash: "Gemini Flash",
  gemini_flash_lite: "Gemini Flash Lite",
  gemini_pro: "Gemini Pro",
};

const DIALECT_LABELS: Record<string, string> = {
  standard_arabic: "فصحى",
  yemeni_light: "يمني خفيف",
  yemeni_business: "يمني تجاري",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700 border-green-200",
  disabled: "bg-gray-100 text-gray-600 border-gray-200",
};

const STATUS_LABELS: Record<string, string> = {
  active: "نشط",
  disabled: "معطل",
};

const SAFETY_SEVERITY_COLORS: Record<string, string> = {
  low: "bg-blue-50 text-blue-700",
  medium: "bg-yellow-50 text-yellow-700",
  high: "bg-orange-50 text-orange-700",
  critical: "bg-red-50 text-red-700",
};

const APPROVAL_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-gray-50 text-gray-600 border-gray-200",
};

const APPROVAL_STATUS_LABELS: Record<string, string> = {
  pending: "بانتظار الاعتماد",
  approved: "معتمد",
  rejected: "مرفوض",
  cancelled: "ملغي",
};

type Tab = "agents" | "runs" | "usage" | "safety" | "approvals";

export default function AgentsPage() {
  const { hasPermission } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("agents");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const canRead = hasPermission("ai:read");
  const canUse = hasPermission("ai:use");
  const canConfigure = hasPermission("ai:configure");
  const canViewUsage = hasPermission("ai:view_usage");
  const canViewSafety = hasPermission("ai:view_safety");
  const canApprovalsRead = hasPermission("approvals:read");
  const canApprove = hasPermission("approvals:approve");
  const canReject = hasPermission("approvals:reject");

  const [createForm, setCreateForm] = useState({
    name: "",
    type: "support",
    defaultModel: "mock",
    dialect: "standard_arabic",
    tone: "",
  });

  const [instructionsForm, setInstructionsForm] = useState({
    rolePrompt: "",
    businessRules: "",
    forbiddenActions: "",
    escalationRules: "",
  });

  const { data: providerStatus } = useQuery({
    queryKey: ["ai-provider-status"],
    queryFn: () => apiFetch("ai/provider-status"),
    enabled: canRead,
  });

  const { data: agentsData, isLoading: agentsLoading, error: agentsError } = useQuery({
    queryKey: ["ai-agents"],
    queryFn: () => apiFetch("ai/agents"),
    enabled: canRead,
  });

  const { data: agentDetail, isLoading: detailLoading } = useQuery({
    queryKey: ["ai-agent", selectedAgentId],
    queryFn: () => apiFetch(`ai/agents/${selectedAgentId}`),
    enabled: !!selectedAgentId && canRead,
  });

  const { data: runsData } = useQuery({
    queryKey: ["ai-runs"],
    queryFn: () => apiFetch("ai/runs"),
    enabled: canRead && tab === "runs",
  });

  const { data: usageData } = useQuery({
    queryKey: ["ai-usage"],
    queryFn: () => apiFetch("ai/usage"),
    enabled: canViewUsage && tab === "usage",
  });

  const { data: safetyData } = useQuery({
    queryKey: ["ai-safety-events"],
    queryFn: () => apiFetch("ai/safety-events"),
    enabled: canViewSafety && tab === "safety",
  });

  const { data: approvalsData } = useQuery({
    queryKey: ["approvals"],
    queryFn: () => apiFetch("approvals"),
    enabled: canApprovalsRead && tab === "approvals",
  });

  const createAgent = useMutation({
    mutationFn: (body: typeof createForm) =>
      apiFetch("ai/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["ai-agents"] });
      setShowCreateModal(false);
      setCreateForm({ name: "", type: "support", defaultModel: "mock", dialect: "standard_arabic", tone: "" });
      setSelectedAgentId(data.agent.id);
    },
  });

  const toggleAgentStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`ai/agents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-agents"] });
      qc.invalidateQueries({ queryKey: ["ai-agent", selectedAgentId] });
    },
  });

  const saveInstructions = useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: typeof instructionsForm }) =>
      apiFetch(`ai/agents/${agentId}/instructions`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-agent", selectedAgentId] });
      setShowInstructionsModal(false);
    },
  });

  const createVersion = useMutation({
    mutationFn: (agentId: string) =>
      apiFetch(`ai/agents/${agentId}/versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-agent", selectedAgentId] });
    },
  });

  const approveRequest = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`approvals/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["approvals"] }),
  });

  const rejectRequest = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch(`approvals/${id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["approvals"] }); setShowRejectModal(false); setRejectReason(""); setRejectTargetId(null); },
  });

  async function testAgent() {
    if (!selectedAgentId) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await apiFetch("ai/runs/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "اختبار الوكيل: هل الوكيل يعمل بشكل صحيح؟", model: "mock" }),
      });
      setTestResult(JSON.stringify(res.extracted, null, 2));
    } catch (e) {
      setTestResult(`خطأ: ${(e as Error).message}`);
    } finally {
      setTestLoading(false);
    }
  }

  const agents = agentsData?.agents ?? [];
  const selectedAgent = agentDetail?.agent;

  if (!canRead) {
    return (
      <div className="flex items-center justify-center min-h-[300px]" dir="rtl">
        <div className="text-center">
          <div className="text-4xl mb-3">🔒</div>
          <p className="text-muted-foreground">ليس لديك صلاحية عرض بيانات الذكاء الاصطناعي</p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl">
      <PageHeader
        title="المساعد الذكي"
        subtitle="اختبر الردود وجهّز أسلوب المساعد. لا يتم إرسال أي رد تلقائياً."
        actions={canConfigure ? (
          <button onClick={() => setShowCreateModal(true)} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
            وكيل جديد
          </button>
        ) : undefined}
      />

      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        لتجهيز المساعد بلغة صاحب النشاط، افتح صفحة{" "}
        <a href={`${import.meta.env.BASE_URL}start`} className="font-semibold underline">
          ابدأ تشغيل نشاطك
        </a>
        . هذه الصفحة للإعداد المتقدم فقط، ولا يوجد إرسال تلقائي للعملاء.
      </div>

      {providerStatus && (
        <div className={cn(
          "mb-4 px-4 py-2 rounded-lg text-sm border flex items-center gap-2",
          providerStatus.hasGeminiKey && !providerStatus.fallbackMode
            ? "bg-green-50 text-green-700 border-green-200"
            : providerStatus.hasGeminiKey && providerStatus.fallbackMode
              ? "bg-orange-50 text-orange-700 border-orange-200"
              : "bg-yellow-50 text-yellow-700 border-yellow-200"
        )}>
          <span>
            {providerStatus.hasGeminiKey && !providerStatus.fallbackMode ? "🟢" :
             providerStatus.hasGeminiKey && providerStatus.fallbackMode ? "🟠" : "🟡"}
          </span>
          <span>{providerStatus.message}</span>
          {providerStatus.hasGeminiKey && !providerStatus.fallbackMode && (
            <span className="mr-auto text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">Gemini مفعّل</span>
          )}
          {providerStatus.hasGeminiKey && providerStatus.fallbackMode && (
            <span className="mr-auto text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-medium">وضع تجريبي (Fallback)</span>
          )}
          {!providerStatus.hasGeminiKey && (
            <span className="mr-auto text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded font-medium">وضع تجريبي</span>
          )}
        </div>
      )}

      <div className="flex gap-1 mb-6 border-b border-border overflow-x-auto">
        {[
          { key: "agents", label: "الوكلاء", show: canRead },
          { key: "runs", label: "سجل التشغيلات", show: canRead },
          { key: "usage", label: "الاستخدام", show: canViewUsage },
          { key: "safety", label: "أحداث الأمان", show: canViewSafety },
          { key: "approvals", label: "طلبات الاعتماد", show: canApprovalsRead },
        ].filter((t) => t.show).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as Tab)}
            className={cn("px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "agents" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-3">
            {agentsLoading && <div className="text-center py-8 text-muted-foreground text-sm">جار التحميل...</div>}
            {agentsError && <div className="text-center py-8 text-destructive text-sm">حدث خطأ في تحميل الوكلاء</div>}
            {!agentsLoading && agents.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <div className="text-4xl mb-3">🤖</div>
                <p className="text-sm">لا يوجد وكلاء بعد</p>
                {canConfigure && <button onClick={() => setShowCreateModal(true)} className="mt-3 text-primary text-sm underline">أنشئ أول وكيل</button>}
              </div>
            )}
            {agents.map((agent: any) => (
              <button
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                className={cn("w-full text-right p-4 rounded-xl border transition-all",
                  selectedAgentId === agent.id
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border bg-card hover:border-primary/40"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-foreground truncate">{agent.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{AGENT_TYPE_LABELS[agent.type] ?? agent.type}</div>
                    <div className="text-xs text-muted-foreground">{MODEL_LABELS[agent.defaultModel] ?? agent.defaultModel}</div>
                  </div>
                  <span className={cn("text-xs px-2 py-0.5 rounded-full border shrink-0", STATUS_COLORS[agent.status] ?? "bg-muted text-muted-foreground border-border")}>
                    {STATUS_LABELS[agent.status] ?? agent.status}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-2">
            {!selectedAgentId && (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm rounded-xl border border-dashed border-border">
                اختر وكيلاً لعرض تفاصيله
              </div>
            )}
            {selectedAgentId && detailLoading && (
              <div className="text-center py-12 text-muted-foreground text-sm">جار التحميل...</div>
            )}
            {selectedAgent && (
              <div className="space-y-4">
                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <h2 className="text-lg font-bold text-foreground">{selectedAgent.name}</h2>
                      <div className="flex gap-2 mt-1 flex-wrap">
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">{AGENT_TYPE_LABELS[selectedAgent.type] ?? selectedAgent.type}</span>
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">{DIALECT_LABELS[selectedAgent.dialect] ?? selectedAgent.dialect}</span>
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">{MODEL_LABELS[selectedAgent.defaultModel] ?? selectedAgent.defaultModel}</span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {canUse && (
                        <button
                          onClick={() => { setTestResult(null); setShowTestModal(true); }}
                          className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                        >
                          اختبار تجريبي
                        </button>
                      )}
                      {canConfigure && (
                        <>
                          <button
                            onClick={() => {
                              setInstructionsForm({
                                rolePrompt: agentDetail.instructions?.rolePrompt ?? "",
                                businessRules: agentDetail.instructions?.businessRules ?? "",
                                forbiddenActions: agentDetail.instructions?.forbiddenActions ?? "",
                                escalationRules: agentDetail.instructions?.escalationRules ?? "",
                              });
                              setShowInstructionsModal(true);
                            }}
                            className="px-3 py-1.5 text-xs font-medium bg-muted text-muted-foreground rounded-lg hover:bg-muted/80"
                          >
                            تعليمات
                          </button>
                          <button
                            onClick={() => toggleAgentStatus.mutate({ id: selectedAgent.id, status: selectedAgent.status === "active" ? "disabled" : "active" })}
                            className={cn("px-3 py-1.5 text-xs font-medium rounded-lg",
                              selectedAgent.status === "active"
                                ? "bg-red-50 text-red-600 hover:bg-red-100"
                                : "bg-green-50 text-green-600 hover:bg-green-100"
                            )}
                          >
                            {selectedAgent.status === "active" ? "تعطيل" : "تفعيل"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {agentDetail.instructions && (
                    <div className="space-y-2 border-t border-border pt-4">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">التعليمات الأساسية</h3>
                      <p className="text-sm text-foreground bg-muted/30 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">
                        {agentDetail.instructions.rolePrompt}
                      </p>
                    </div>
                  )}

                  {agentDetail.versions && agentDetail.versions.length > 0 && (
                    <div className="border-t border-border pt-4 mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">الإصدارات</h3>
                        {canConfigure && (
                          <button
                            onClick={() => createVersion.mutate(selectedAgent.id)}
                            disabled={createVersion.isPending}
                            className="text-xs text-primary hover:underline"
                          >
                            {createVersion.isPending ? "..." : "حفظ إصدار جديد"}
                          </button>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {agentDetail.versions.slice(0, 3).map((v: any) => (
                          <div key={v.id} className="flex items-center justify-between text-xs bg-muted/30 rounded-lg px-3 py-1.5">
                            <span className="text-muted-foreground">v{v.versionNumber}</span>
                            <span className={cn("px-1.5 py-0.5 rounded text-xs", v.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
                              {v.status === "active" ? "نشط" : v.status === "draft" ? "مسودة" : "مؤرشف"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {agentDetail.versions?.length === 0 && canConfigure && (
                    <div className="border-t border-border pt-4 mt-4">
                      <button
                        onClick={() => createVersion.mutate(selectedAgent.id)}
                        disabled={createVersion.isPending}
                        className="text-xs text-primary hover:underline"
                      >
                        {createVersion.isPending ? "..." : "حفظ إصدار أول"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "runs" && (
        <div className="space-y-3">
          {!runsData && <div className="text-center py-8 text-muted-foreground text-sm">جار التحميل...</div>}
          {runsData?.runs?.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-sm">لا توجد تشغيلات بعد</p>
              <p className="text-xs mt-1">ستظهر هنا بعد استخدام الذكاء الاصطناعي في صندوق الوارد</p>
            </div>
          )}
          {runsData?.runs?.map((run: any) => (
            <div key={run.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex gap-2 flex-wrap">
                    <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded">{run.taskType}</span>
                    <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">{run.provider}</span>
                    {run.safetyStatus === "blocked" && (
                      <span className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded">محظور</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {run.inputType} {run.totalTokens ? `• ${run.totalTokens} رمز` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn("text-xs px-2 py-0.5 rounded border",
                    run.status === "succeeded" ? "bg-green-50 text-green-700 border-green-200"
                    : run.status === "failed" ? "bg-red-50 text-red-700 border-red-200"
                    : run.status === "blocked" ? "bg-orange-50 text-orange-700 border-orange-200"
                    : "bg-gray-50 text-gray-600 border-gray-200"
                  )}>
                    {run.status === "succeeded" ? "نجح" : run.status === "failed" ? "فشل" : run.status === "blocked" ? "محظور" : run.status}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(run.createdAt).toLocaleDateString("ar-YE")}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "usage" && canViewUsage && (
        <div className="space-y-6">
          {usageData ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="text-2xl font-bold text-foreground">{usageData.totalRuns}</div>
                  <div className="text-sm text-muted-foreground mt-1">تشغيلات اليوم</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="text-2xl font-bold text-foreground">{usageData.totalTokens.toLocaleString()}</div>
                  <div className="text-sm text-muted-foreground mt-1">إجمالي الرموز</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="text-2xl font-bold text-foreground capitalize">{usageData.provider?.provider ?? "mock"}</div>
                  <div className="text-sm text-muted-foreground mt-1">المزود النشط</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{usageData.provider?.message}</div>
                </div>
              </div>
              {usageData.usageRows?.length > 0 && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-border font-medium text-sm">تفاصيل الاستخدام اليومي</div>
                  <div className="divide-y divide-border">
                    {usageData.usageRows.map((row: any) => (
                      <div key={row.id} className="px-5 py-3 flex items-center justify-between text-sm">
                        <div className="flex gap-3">
                          <span className="text-muted-foreground">{row.taskType}</span>
                          <span className="text-muted-foreground">{row.provider}</span>
                        </div>
                        <div className="flex gap-4 text-muted-foreground">
                          <span>{row.totalRuns} تشغيل</span>
                          <span>{row.totalTokens.toLocaleString()} رمز</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">جار التحميل...</div>
          )}
        </div>
      )}

      {tab === "safety" && canViewSafety && (
        <div className="space-y-3">
          {!safetyData && <div className="text-center py-8 text-muted-foreground text-sm">جار التحميل...</div>}
          {safetyData?.events?.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <div className="text-4xl mb-3">🛡️</div>
              <p className="text-sm">لا توجد أحداث أمان</p>
              <p className="text-xs mt-1">تظهر هنا الإجراءات المحظورة التي حاول الذكاء الاصطناعي تنفيذها</p>
            </div>
          )}
          {safetyData?.events?.map((event: any) => (
            <div key={event.id} className={cn("border rounded-xl p-4", SAFETY_SEVERITY_COLORS[event.severity] ?? "bg-muted")}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-medium text-sm">🚫 {event.blockedAction}</div>
                  <div className="text-sm opacity-90">{event.reason}</div>
                  <div className="text-xs opacity-70">{event.eventType}</div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-medium uppercase opacity-80">{event.severity}</span>
                  <div className="text-xs opacity-60 mt-1">{new Date(event.createdAt).toLocaleDateString("ar-YE")}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "approvals" && canApprovalsRead && (
        <div className="space-y-3">
          {!approvalsData && <div className="text-center py-8 text-muted-foreground text-sm">جار التحميل...</div>}
          {approvalsData?.approvals?.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-sm">لا توجد طلبات اعتماد</p>
              <p className="text-xs mt-1">تظهر هنا اقتراحات الذكاء الاصطناعي التي تحتاج اعتماداً بشرياً</p>
            </div>
          )}
          {approvalsData?.approvals?.map((approval: any) => (
            <div key={approval.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{approval.actionType}</span>
                    <span className={cn("text-xs px-2 py-0.5 rounded border", APPROVAL_STATUS_COLORS[approval.status] ?? "bg-muted text-muted-foreground border-border")}>
                      {APPROVAL_STATUS_LABELS[approval.status] ?? approval.status}
                    </span>
                  </div>
                  {approval.payload?.suggestion?.reason && (
                    <p className="text-xs text-muted-foreground">{approval.payload.suggestion.reason}</p>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {new Date(approval.createdAt).toLocaleDateString("ar-YE", { year: "numeric", month: "short", day: "numeric" })}
                  </div>
                </div>
                {approval.status === "pending" && (
                  <div className="flex gap-2 shrink-0">
                    {canApprove && (
                      <button
                        onClick={() => approveRequest.mutate(approval.id)}
                        disabled={approveRequest.isPending}
                        className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                      >
                        {approveRequest.isPending ? "..." : "اعتماد"}
                      </button>
                    )}
                    {canReject && (
                      <button
                        onClick={() => { setRejectTargetId(approval.id); setRejectReason(""); setShowRejectModal(true); }}
                        className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100"
                      >
                        رفض
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="إنشاء وكيل جديد" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">اسم الوكيل <span className="text-destructive">*</span></label>
            <input
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              placeholder="مثال: وكيل دعم العملاء"
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">نوع الوكيل</label>
            <select
              value={createForm.type}
              onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {Object.entries(AGENT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">اللهجة</label>
            <select
              value={createForm.dialect}
              onChange={(e) => setCreateForm({ ...createForm, dialect: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {Object.entries(DIALECT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">النموذج</label>
            <select
              value={createForm.defaultModel}
              onChange={(e) => setCreateForm({ ...createForm, defaultModel: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {Object.entries(MODEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">النبرة (اختياري)</label>
            <input
              value={createForm.tone}
              onChange={(e) => setCreateForm({ ...createForm, tone: e.target.value })}
              placeholder="مثال: ودي ومهني"
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {createAgent.isError && (
            <p className="text-xs text-destructive">{(createAgent.error as Error)?.message}</p>
          )}
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => createAgent.mutate(createForm)}
              disabled={!createForm.name.trim() || createAgent.isPending}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {createAgent.isPending ? "جار الإنشاء..." : "إنشاء"}
            </button>
            <button
              onClick={() => setShowCreateModal(false)}
              className="px-4 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/80"
            >
              إلغاء
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showInstructionsModal} onClose={() => setShowInstructionsModal(false)} title="تعليمات الوكيل">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">التعليمات الأساسية <span className="text-destructive">*</span></label>
            <textarea
              value={instructionsForm.rolePrompt}
              onChange={(e) => setInstructionsForm({ ...instructionsForm, rolePrompt: e.target.value })}
              rows={4}
              placeholder="صف دور الوكيل وأسلوبه في التعامل..."
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">قواعد العمل</label>
            <textarea
              value={instructionsForm.businessRules}
              onChange={(e) => setInstructionsForm({ ...instructionsForm, businessRules: e.target.value })}
              rows={3}
              placeholder="قواعد وسياسات يجب أن يلتزم بها الوكيل..."
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">الإجراءات المحظورة</label>
            <textarea
              value={instructionsForm.forbiddenActions}
              onChange={(e) => setInstructionsForm({ ...instructionsForm, forbiddenActions: e.target.value })}
              rows={2}
              placeholder="ما الذي يجب أن يتجنبه الوكيل؟..."
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">قواعد التصعيد</label>
            <textarea
              value={instructionsForm.escalationRules}
              onChange={(e) => setInstructionsForm({ ...instructionsForm, escalationRules: e.target.value })}
              rows={2}
              placeholder="متى يصعّد الوكيل الموضوع للإنسان؟..."
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>
          {saveInstructions.isError && (
            <p className="text-xs text-destructive">{(saveInstructions.error as Error)?.message}</p>
          )}
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => selectedAgentId && saveInstructions.mutate({ agentId: selectedAgentId, data: instructionsForm })}
              disabled={!instructionsForm.rolePrompt.trim() || saveInstructions.isPending}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {saveInstructions.isPending ? "جار الحفظ..." : "حفظ"}
            </button>
            <button
              onClick={() => setShowInstructionsModal(false)}
              className="px-4 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/80"
            >
              إلغاء
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showTestModal} onClose={() => { setShowTestModal(false); setTestResult(null); }} title="اختبار تجريبي للوكيل" size="sm">
        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
            <p className="text-xs font-medium text-yellow-700">وضع mock — لا يتم إرسال أي رسالة</p>
            <p className="text-xs text-yellow-600 mt-0.5">هذا اختبار تجريبي فقط يعمل على نص وهمي. لا يتصل بـ Gemini ولا يؤثر على أي بيانات حقيقية.</p>
          </div>
          <p className="text-sm text-muted-foreground">المزود الحالي: <span className="font-medium">{providerStatus?.provider ?? "mock"}</span></p>
          <button
            onClick={testAgent}
            disabled={testLoading}
            className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {testLoading ? "جار الاختبار التجريبي..." : "تشغيل اختبار تجريبي"}
          </button>
          {testResult && (
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">نتيجة الاختبار التجريبي (mock):</div>
              <pre className="text-xs text-foreground whitespace-pre-wrap">{testResult}</pre>
            </div>
          )}
        </div>
      </Modal>

      <Modal open={showRejectModal} onClose={() => { setShowRejectModal(false); setRejectReason(""); setRejectTargetId(null); }} title="رفض طلب الاعتماد" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">يجب إدخال سبب الرفض. سيُسجَّل في سجل المراجعة.</p>
          <div>
            <label className="block text-sm font-medium mb-1">سبب الرفض *</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="أدخل سبب رفض هذا الطلب..."
              rows={3}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowRejectModal(false); setRejectReason(""); setRejectTargetId(null); }}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted"
            >
              إلغاء
            </button>
            <button
              onClick={() => { if (rejectTargetId && rejectReason.trim()) rejectRequest.mutate({ id: rejectTargetId, reason: rejectReason.trim() }); }}
              disabled={!rejectReason.trim() || rejectRequest.isPending}
              className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {rejectRequest.isPending ? "جار الرفض..." : "تأكيد الرفض"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
