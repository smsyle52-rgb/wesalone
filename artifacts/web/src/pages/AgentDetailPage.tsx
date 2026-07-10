import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bot, Check, Link2, Play, Save, Unlink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import { formatDateTime } from "@/lib/utils";

const BASE = `${import.meta.env.BASE_URL}api`;
const tabs = ["settings", "instructions", "knowledge", "serviceStyle", "learned", "channels", "runs", "trust", "playground"] as const;

interface AgentSimulationResult {
  reply: string;
  knowledgeSources: string[];
  sourcesDetailed?: { title: string; score: number | null }[];
  toolCalls: { name: string; args: Record<string, unknown> }[];
  wouldEscalate: boolean;
  escalationReasons?: string[];
  provider: string;
  aiUnavailable: boolean;
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json.error ?? text);
    } catch {
      throw new Error(text);
    }
  }
  return res.json();
}

export default function AgentDetailPage({ agentId }: { agentId: string }) {
  const { t } = useTranslation("pages");
  const { hasPermission } = useAuth();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("settings");
  const [message, setMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState({ name: "", defaultModel: "mock", temperature: "0.30", maxOutputTokens: "1024", knowledgeBaseIds: [] as string[] });
  const [instructions, setInstructions] = useState({ rolePrompt: "", businessRules: "", forbiddenActions: "", escalationRules: "" });
  const [serviceStyle, setServiceStyle] = useState({ sectorKey: "services_general", notes: "" });
  const [trustSettings, setTrustSettings] = useState({
    trustMode: "suggest",
    trustConfidenceThreshold: "0.80",
    trustTopics: [] as string[],
    trustBlocklist: [] as string[],
    maxAutoRepliesPerConversation: "3",
    escalateAfterFailedAuto: "1",
    dailyAutoSendQuota: "200",
  });
  const [topicInput, setTopicInput] = useState("");
  const [blockInput, setBlockInput] = useState("");
  const [playgroundQuestion, setPlaygroundQuestion] = useState("");
  const [playgroundResult, setPlaygroundResult] = useState<AgentSimulationResult | null>(null);
  const canRead = hasPermission("ai:read");
  const canUse = hasPermission("ai:use");
  const canConfigure = hasPermission("ai:configure");
  const canManageChannels = hasPermission("channels:manage");

  const detailQuery = useQuery({
    queryKey: ["ai-agent", agentId],
    queryFn: () => apiFetch(`ai/agents/${agentId}`),
    enabled: canRead,
  });

  const basesQuery = useQuery({
    queryKey: ["knowledge-bases-for-agent"],
    queryFn: () => apiFetch("knowledge/bases"),
    enabled: canRead,
  });

  const sectorsQuery = useQuery({
    queryKey: ["sector-profiles"],
    queryFn: () => apiFetch("sectors"),
    enabled: canRead,
  });

  const learnedQuery = useQuery({
    queryKey: ["agent-learned-answers", agentId],
    queryFn: () => apiFetch(`ai/agents/${agentId}/learned-answers`),
    enabled: canRead,
  });

  const channelAccountsQuery = useQuery({
    queryKey: ["agent-channel-accounts"],
    queryFn: () => apiFetch("channels/accounts"),
    enabled: canRead,
  });

  useEffect(() => {
    const agent = detailQuery.data?.agent;
    if (!agent) return;
    setSettings({
      name: agent.name ?? "",
      defaultModel: agent.defaultModel ?? "mock",
      temperature: String(agent.temperature ?? "0.30"),
      maxOutputTokens: String(agent.maxOutputTokens ?? 1024),
      knowledgeBaseIds: Array.isArray(agent.knowledgeBaseIds) ? agent.knowledgeBaseIds : [],
    });
    setInstructions({
      rolePrompt: detailQuery.data?.instructions?.rolePrompt ?? "",
      businessRules: detailQuery.data?.instructions?.businessRules ?? "",
      forbiddenActions: detailQuery.data?.instructions?.forbiddenActions ?? "",
      escalationRules: detailQuery.data?.instructions?.escalationRules ?? "",
    });
    const overrides = agent.sectorBehaviorOverrides && typeof agent.sectorBehaviorOverrides === "object" ? agent.sectorBehaviorOverrides : {};
    setServiceStyle({
      sectorKey: agent.sectorKey ?? "services_general",
      notes: typeof overrides.notes === "string" ? overrides.notes : "",
    });
    setTrustSettings({
      trustMode: agent.trustMode ?? "suggest",
      trustConfidenceThreshold: String(agent.trustConfidenceThreshold ?? "0.80"),
      trustTopics: Array.isArray(agent.trustTopics) ? agent.trustTopics : [],
      trustBlocklist: Array.isArray(agent.trustBlocklist) ? agent.trustBlocklist : [],
      maxAutoRepliesPerConversation: String(agent.maxAutoRepliesPerConversation ?? 3),
      escalateAfterFailedAuto: String(agent.escalateAfterFailedAuto ?? 1),
      dailyAutoSendQuota: String(agent.dailyAutoSendQuota ?? 200),
    });
  }, [detailQuery.data]);

  const saveSettings = useMutation({
    mutationFn: () => apiFetch(`ai/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: settings.name,
        defaultModel: settings.defaultModel,
        temperature: Number(settings.temperature),
        maxOutputTokens: Number(settings.maxOutputTokens),
        knowledgeBaseIds: settings.knowledgeBaseIds,
        sectorKey: serviceStyle.sectorKey,
        sectorBehaviorOverrides: { notes: serviceStyle.notes },
      }),
    }),
    onSuccess: () => {
      setMessage(t("agents.detail.saved"));
      qc.invalidateQueries({ queryKey: ["ai-agent", agentId] });
    },
    onError: (err) => setMessage((err as Error).message),
  });

  const saveInstructions = useMutation({
    mutationFn: () => apiFetch(`ai/agents/${agentId}/instructions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(instructions),
    }),
    onSuccess: () => {
      setMessage(t("agents.detail.saved"));
      qc.invalidateQueries({ queryKey: ["ai-agent", agentId] });
    },
    onError: (err) => setMessage((err as Error).message),
  });

  const saveTrust = useMutation({
    mutationFn: () => apiFetch(`ai/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trustMode: trustSettings.trustMode,
        trustConfidenceThreshold: Number(trustSettings.trustConfidenceThreshold),
        trustTopics: trustSettings.trustTopics,
        trustBlocklist: trustSettings.trustBlocklist,
        maxAutoRepliesPerConversation: Number(trustSettings.maxAutoRepliesPerConversation),
        escalateAfterFailedAuto: Number(trustSettings.escalateAfterFailedAuto),
        dailyAutoSendQuota: Number(trustSettings.dailyAutoSendQuota),
      }),
    }),
    onSuccess: () => {
      setMessage(t("agents.detail.saved"));
      qc.invalidateQueries({ queryKey: ["ai-agent", agentId] });
    },
    onError: (err) => setMessage((err as Error).message),
  });

  const runPlayground = useMutation({
    mutationFn: (): Promise<AgentSimulationResult> => apiFetch(`ai/agents/${agentId}/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: playgroundQuestion }),
    }),
    onSuccess: (data) => setPlaygroundResult(data),
    onError: (err) => setMessage((err as Error).message),
  });

  const updateLearnedAnswer = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiFetch(`ai/learned-answers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-learned-answers", agentId] }),
    onError: (err) => setMessage((err as Error).message),
  });

  const saveChannelBinding = useMutation({
    mutationFn: ({ accountId, defaultAgentId }: { accountId: string; defaultAgentId: string | null }) => apiFetch(`channels/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultAgentId }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-channel-accounts"] });
      qc.invalidateQueries({ queryKey: ["ai-agent", agentId] });
    },
    onError: (err) => setMessage((err as Error).message),
  });

  function toggleKnowledgeBase(id: string) {
    setSettings((current) => ({
      ...current,
      knowledgeBaseIds: current.knowledgeBaseIds.includes(id)
        ? current.knowledgeBaseIds.filter((item) => item !== id)
        : [...current.knowledgeBaseIds, id],
    }));
  }

  function addTrustChip(field: "trustTopics" | "trustBlocklist", value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setTrustSettings((current) => ({
      ...current,
      [field]: current[field].includes(trimmed) ? current[field] : [...current[field], trimmed],
    }));
  }

  function removeTrustChip(field: "trustTopics" | "trustBlocklist", value: string) {
    setTrustSettings((current) => ({ ...current, [field]: current[field].filter((item) => item !== value) }));
  }

  if (!canRead) {
    return <div dir="rtl" className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-800">{t("agents.permissionDenied")}</div>;
  }

  const agent = detailQuery.data?.agent;
  const bases = basesQuery.data?.bases ?? [];
  const sectors = sectorsQuery.data?.sectors ?? [];
  const channels = detailQuery.data?.channels ?? [];
  const channelAccounts = channelAccountsQuery.data?.accounts ?? [];
  const runs = detailQuery.data?.runs ?? [];

  return (
    <div dir="rtl">
      <PageHeader
        title={agent?.name ?? t("agents.detail.title")}
        subtitle={t("agents.detail.subtitle")}
        actions={
          <div className="flex items-center gap-2">
            {agent?.status && <StatusBadge status={agent.status} />}
            <Bot className="h-5 w-5 text-muted-foreground" />
          </div>
        }
      />

      {message && <div className="mb-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{message}</div>}

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`rounded-full px-4 py-2 text-sm font-medium ${activeTab === tab ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
            {tab === "serviceStyle" ? "أسلوب الخدمة" : tab === "learned" ? "ما تعلّمه الوكيل" : t(`agents.detail.tabs.${tab}`)}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        {activeTab === "settings" && (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("agents.fields.name")}</span>
              <input value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} disabled={!canConfigure} className="w-full rounded-lg border border-input bg-background px-3 py-2 disabled:opacity-60" />
            </label>
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-6 text-muted-foreground md:col-span-2">
              يعمل هذا الوكيل على محرّك ذكاء يُدار تلقائياً لاختيار أفضل جودة وسرعة لكل رسالة — لا حاجة لأي ضبط تقني منك.
            </div>
            {canConfigure && (
              <button onClick={() => saveSettings.mutate()} className="inline-flex w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                <Save className="h-4 w-4" />
                {t("common.save")}
              </button>
            )}
          </div>
        )}

        {activeTab === "instructions" && (
          <div className="space-y-4">
            {(["rolePrompt", "businessRules", "forbiddenActions", "escalationRules"] as const).map((field) => (
              <label key={field} className="block space-y-1 text-sm">
                <span className="font-medium">{t(`agents.fields.${field}`)}</span>
                <textarea
                  value={instructions[field]}
                  onChange={(event) => setInstructions({ ...instructions, [field]: event.target.value })}
                  disabled={!canConfigure}
                  rows={field === "rolePrompt" ? 8 : 4}
                  placeholder={field === "escalationRules" ? t("agents.fields.escalationRulesPlaceholder") : undefined}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 disabled:opacity-60"
                />
                <span className="text-xs text-muted-foreground">{instructions[field].length.toLocaleString("ar-YE-u-nu-latn")}</span>
              </label>
            ))}
            {canConfigure && (
              <button onClick={() => saveInstructions.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                <Save className="h-4 w-4" />
                {t("common.save")}
              </button>
            )}
          </div>
        )}

        {activeTab === "knowledge" && (
          <div className="space-y-3">
            {bases.length === 0 && <p className="text-sm text-muted-foreground">{t("agents.detail.noKnowledge")}</p>}
            {bases.map((base: any) => (
              <label key={base.id} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm hover:bg-muted/50">
                <input type="checkbox" checked={settings.knowledgeBaseIds.includes(base.id)} onChange={() => toggleKnowledgeBase(base.id)} disabled={!canConfigure} />
                <span className="font-medium">{base.name}</span>
                <span className="text-muted-foreground">{base.description ?? ""}</span>
              </label>
            ))}
            {canConfigure && (
              <button onClick={() => saveSettings.mutate()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">{t("common.save")}</button>
            )}
          </div>
        )}

        {activeTab === "serviceStyle" && (
          <div className="space-y-5">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm leading-7 text-blue-900">
              أسلوب الخدمة يحدد كيف يتصرف الوكيل داخل قطاعك: هل يشرح منتجًا، يقترح موعدًا، يأخذ طلبًا، أو يجمع تفاصيل الخدمة. معرفة التاجر تبقى أعلى أولوية دائمًا.
            </div>
            <label className="space-y-1 text-sm">
              <span className="font-medium">قطاع النشاط</span>
              <select
                value={serviceStyle.sectorKey}
                onChange={(event) => setServiceStyle({ ...serviceStyle, sectorKey: event.target.value })}
                disabled={!canConfigure}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 disabled:opacity-60"
              >
                {sectors.map((sector: any) => (
                  <option key={sector.sectorKey} value={sector.sectorKey}>{sector.nameAr}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">تخصيص خفيف لأسلوب الخدمة</span>
              <textarea
                value={serviceStyle.notes}
                onChange={(event) => setServiceStyle({ ...serviceStyle, notes: event.target.value })}
                disabled={!canConfigure}
                rows={5}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 disabled:opacity-60"
                placeholder="مثال: ركز على سياسة الاستبدال الرسمية، واسأل العميل عن المقاس قبل اقتراح الملابس."
              />
            </label>
            {canConfigure && (
              <button onClick={() => saveSettings.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                <Save className="h-4 w-4" />
                {t("common.save")}
              </button>
            )}
          </div>
        )}

        {activeTab === "learned" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm leading-7 text-emerald-900">
              هذه أمثلة يتم حقنها كسياق وقت الرد فقط. المواضيع الحساسة تبقى بانتظار مراجعة التاجر قبل استخدامها.
            </div>
            {(learnedQuery.data?.answers ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">لا توجد إجابات متعلمة بعد. ستظهر هنا الردود المفيدة بعد تراكم محادثات وتقييمات كافية.</p>
            )}
            {(learnedQuery.data?.answers ?? []).map((answer: any) => (
              <div key={answer.id} className="rounded-lg border border-border p-4 text-sm">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold text-foreground">{answer.questionPattern}</div>
                  <StatusBadge status={answer.status} />
                </div>
                <p className="whitespace-pre-wrap leading-7 text-muted-foreground">{answer.bestAnswer}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {answer.status !== "active" && canConfigure && (
                    <button onClick={() => updateLearnedAnswer.mutate({ id: answer.id, body: { status: "active" } })} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">
                      اعتماد
                    </button>
                  )}
                  {canConfigure && (
                    <button onClick={() => updateLearnedAnswer.mutate({ id: answer.id, body: { status: "pending_review" } })} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold">
                      إيقاف الاستخدام
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "channels" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">ربط القنوات لهذا الوكيل</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    اختر القنوات التي يرد عليها هذا الوكيل. علامة الصح تعني أن القناة مربوطة بهذا الوكيل، ويمكن فصلها بدون تعطيل القناة نفسها.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href="/integrations">
                    <span className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                      ربط القنوات
                    </span>
                  </Link>
                  <Link href="/integrations">
                    <span className="inline-flex rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted">
                      واتساب وإنستغرام وماسنجر
                    </span>
                  </Link>
                  <Link href="/inbox">
                    <span className="inline-flex rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted">
                      فتح الصندوق
                    </span>
                  </Link>
                </div>
              </div>
            </div>

            {channelAccountsQuery.isLoading && (
              <div className="rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">جاري تحميل القنوات...</div>
            )}

            {!channelAccountsQuery.isLoading && channelAccounts.length === 0 && (
              <div className="rounded-xl border border-dashed border-border bg-background p-5 text-sm leading-7 text-muted-foreground">
                لا توجد قنوات متاحة في مساحة العمل حتى الآن. اربط واتساب أو إنستغرام أو ماسنجر أولًا من التكاملات، ثم ارجع هنا لاختيار الوكيل.
              </div>
            )}

            {channelAccounts.length > 0 && (
              <div className="grid gap-3">
                {channelAccounts.map((account: any) => {
                  const isLinked = account.defaultAgentId === agentId;
                  const isLinkedToAnother = account.defaultAgentId && account.defaultAgentId !== agentId;
                  const linkedRecord = channels.find((channel: any) => channel.channelAccountId === account.id);
                  return (
                    <div key={account.id} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-sm font-black ${isLinked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}>
                          {isLinked ? <Check className="h-5 w-5" /> : account.channelType?.slice(0, 1)?.toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-bold text-foreground">{account.displayName ?? account.name ?? account.channelType}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{account.channelType}</span>
                            <StatusBadge status={account.status ?? "active"} />
                            {linkedRecord?.mode && <StatusBadge status={linkedRecord.mode} />}
                            {isLinkedToAnother && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-bold text-amber-700">مربوطة بوكيل آخر</span>}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={!canManageChannels || saveChannelBinding.isPending}
                        onClick={() => saveChannelBinding.mutate({ accountId: account.id, defaultAgentId: isLinked ? null : agentId })}
                        className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isLinked ? "border border-border bg-card text-foreground hover:bg-muted" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
                      >
                        {isLinked ? <Unlink className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                        {isLinked ? "فصل القناة" : "ربط بهذا الوكيل"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "runs" && (
          <div className="space-y-3">
            {runs.length === 0 && <p className="text-sm text-muted-foreground">{t("agents.detail.noRuns")}</p>}
            {runs.map((run: any) => (
              <div key={run.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{run.taskType}</div>
                  </div>
                  <div className="text-start text-xs text-muted-foreground">{formatDateTime(run.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "trust" && (
          <div className="space-y-5">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t("agents.detail.trust.info")}</div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t("agents.detail.trust.mode")}</span>
                <select value={trustSettings.trustMode} onChange={(event) => setTrustSettings({ ...trustSettings, trustMode: event.target.value })} disabled={!canConfigure} className="w-full rounded-lg border border-input bg-background px-3 py-2 disabled:opacity-60">
                  <option value="suggest">{t("agents.detail.trust.modes.suggest")}</option>
                  <option value="auto">{t("agents.detail.trust.modes.auto")}</option>
                  <option value="auto_after_hours">{t("agents.detail.trust.modes.autoAfterHours")}</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t("agents.detail.trust.threshold")}</span>
                <input type="range" min="0.5" max="0.95" step="0.05" value={trustSettings.trustConfidenceThreshold} onChange={(event) => setTrustSettings({ ...trustSettings, trustConfidenceThreshold: event.target.value })} disabled={!canConfigure} className="w-full" />
                <span className="text-xs text-muted-foreground">{Number(trustSettings.trustConfidenceThreshold).toFixed(2)}</span>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t("agents.detail.trust.maxPerConversation")}</span>
                <input type="number" min="0" max="50" value={trustSettings.maxAutoRepliesPerConversation} onChange={(event) => setTrustSettings({ ...trustSettings, maxAutoRepliesPerConversation: event.target.value })} disabled={!canConfigure} className="w-full rounded-lg border border-input bg-background px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t("agents.detail.trust.escalateAfter")}</span>
                <input type="number" min="0" max="20" value={trustSettings.escalateAfterFailedAuto} onChange={(event) => setTrustSettings({ ...trustSettings, escalateAfterFailedAuto: event.target.value })} disabled={!canConfigure} className="w-full rounded-lg border border-input bg-background px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t("agents.detail.trust.dailyQuota")}</span>
                <input type="number" min="0" max="10000" value={trustSettings.dailyAutoSendQuota} onChange={(event) => setTrustSettings({ ...trustSettings, dailyAutoSendQuota: event.target.value })} disabled={!canConfigure} className="w-full rounded-lg border border-input bg-background px-3 py-2 disabled:opacity-60" />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="text-sm font-medium">{t("agents.detail.trust.topics")}</div>
                <div className="flex gap-2">
                  <input value={topicInput} onChange={(event) => setTopicInput(event.target.value)} disabled={!canConfigure} className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-60" placeholder={t("agents.detail.trust.topicPlaceholder")} />
                  <button type="button" onClick={() => { addTrustChip("trustTopics", topicInput); setTopicInput(""); }} disabled={!canConfigure} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60">{t("common.create")}</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {trustSettings.trustTopics.map((topic) => (
                    <button key={topic} type="button" onClick={() => removeTrustChip("trustTopics", topic)} className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{topic}</button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">{t("agents.detail.trust.blocklist")}</div>
                <div className="flex gap-2">
                  <input value={blockInput} onChange={(event) => setBlockInput(event.target.value)} disabled={!canConfigure} className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-60" placeholder={t("agents.detail.trust.blockPlaceholder")} />
                  <button type="button" onClick={() => { addTrustChip("trustBlocklist", blockInput); setBlockInput(""); }} disabled={!canConfigure} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60">{t("common.create")}</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {trustSettings.trustBlocklist.map((keyword) => (
                    <button key={keyword} type="button" onClick={() => removeTrustChip("trustBlocklist", keyword)} className="rounded-full bg-destructive/10 px-3 py-1 text-xs text-destructive">{keyword}</button>
                  ))}
                </div>
              </div>
            </div>

            {canConfigure && (
              <button onClick={() => saveTrust.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                <Save className="h-4 w-4" />
                {t("common.save")}
              </button>
            )}
          </div>
        )}

        {activeTab === "playground" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{t("agents.detail.playgroundNotice")}</div>
            <textarea value={playgroundQuestion} onChange={(event) => setPlaygroundQuestion(event.target.value)} rows={5} className="w-full rounded-lg border border-input bg-background px-3 py-2" placeholder={t("agents.detail.playgroundPlaceholder")} />
            <button onClick={() => runPlayground.mutate()} disabled={!canUse || !playgroundQuestion.trim() || runPlayground.isPending} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              <Play className="h-4 w-4" />
              {t("common.testRun")}
            </button>
            {playgroundResult && (
              <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm">
                {playgroundResult.aiUnavailable && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {t("agents.detail.aiUnavailableNotice")}
                  </div>
                )}

                <div className="mb-2 font-semibold">{t("agents.detail.suggestedReply")}</div>
                <p className="whitespace-pre-wrap leading-relaxed">{playgroundResult.reply}</p>

                <div className="mt-4 border-t border-border pt-3">
                  <div className="mb-2 text-xs font-semibold text-muted-foreground">{t("agents.detail.willEscalateLabel")}</div>
                  {playgroundResult.wouldEscalate ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {t("agents.detail.willEscalate")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700">
                      <Check className="h-3.5 w-3.5" />
                      {t("agents.detail.willAutoReply")}
                    </span>
                  )}
                  {(playgroundResult.escalationReasons ?? []).length > 0 && (
                    <div className="mt-2 space-y-0.5">
                      {(playgroundResult.escalationReasons ?? []).map((reason) => {
                        const key = reason.startsWith("unbacked_claim") ? "unbacked_claim" : reason;
                        return (
                          <div key={reason} className="text-xs text-muted-foreground">
                            • {t(`agents.detail.escalationReason.${key}`, reason)}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="mt-4 border-t border-border pt-3">
                  <div className="mb-2 text-xs font-semibold text-muted-foreground">{t("agents.detail.toolsToUse")}</div>
                  {playgroundResult.toolCalls.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {playgroundResult.toolCalls.map((call, index) => (
                        <span key={`${call.name}:${index}`} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">{call.name}</span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">{t("agents.detail.noTools")}</div>
                  )}
                </div>

                <div className="mt-4 border-t border-border pt-3">
                  <div className="mb-2 text-xs font-semibold text-muted-foreground">{t("agents.detail.knowledgeSourcesUsed")}</div>
                  {playgroundResult.knowledgeSources.length > 0 ? (
                    <div className="space-y-1">
                      {(playgroundResult.sourcesDetailed ?? playgroundResult.knowledgeSources.map((title) => ({ title, score: null }))).map((source, index) => (
                        <div key={`${source.title}:${index}`} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span className="truncate">{source.title}</span>
                          {typeof source.score === "number" && (
                            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 tabular-nums">{Math.round(source.score * 100)}%</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">{t("agents.detail.noKnowledgeSourcesUsed")}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
