import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Play, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import { formatDateTime } from "@/lib/utils";

const BASE = `${import.meta.env.BASE_URL}api`;
const tabs = ["settings", "instructions", "knowledge", "channels", "runs", "playground"] as const;

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
  const [playgroundQuestion, setPlaygroundQuestion] = useState("");
  const [playgroundResult, setPlaygroundResult] = useState<any>(null);
  const canRead = hasPermission("ai:read");
  const canUse = hasPermission("ai:use");
  const canConfigure = hasPermission("ai:configure");

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

  const runPlayground = useMutation({
    mutationFn: () => apiFetch("ai/runs/draft-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, message: playgroundQuestion, model: settings.defaultModel }),
    }),
    onSuccess: (data) => setPlaygroundResult(data),
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

  if (!canRead) {
    return <div dir="rtl" className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-800">{t("agents.permissionDenied")}</div>;
  }

  const agent = detailQuery.data?.agent;
  const bases = basesQuery.data?.bases ?? [];
  const channels = detailQuery.data?.channels ?? [];
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
            {t(`agents.detail.tabs.${tab}`)}
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
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("agents.fields.model")}</span>
              <select value={settings.defaultModel} onChange={(event) => setSettings({ ...settings, defaultModel: event.target.value })} disabled={!canConfigure} className="w-full rounded-lg border border-input bg-background px-3 py-2 disabled:opacity-60">
                {["mock", "gemini_flash_lite", "gemini_flash", "gemini_pro"].map((model) => <option key={model} value={model}>{t(`agents.models.${model}`)}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("agents.fields.temperature")}</span>
              <input type="number" min="0" max="2" step="0.1" value={settings.temperature} onChange={(event) => setSettings({ ...settings, temperature: event.target.value })} disabled={!canConfigure} className="w-full rounded-lg border border-input bg-background px-3 py-2 disabled:opacity-60" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("agents.fields.maxTokens")}</span>
              <input type="number" min="128" max="8192" value={settings.maxOutputTokens} onChange={(event) => setSettings({ ...settings, maxOutputTokens: event.target.value })} disabled={!canConfigure} className="w-full rounded-lg border border-input bg-background px-3 py-2 disabled:opacity-60" />
            </label>
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
                <textarea value={instructions[field]} onChange={(event) => setInstructions({ ...instructions, [field]: event.target.value })} disabled={!canConfigure} rows={field === "rolePrompt" ? 8 : 4} className="w-full rounded-lg border border-input bg-background px-3 py-2 disabled:opacity-60" />
                <span className="text-xs text-muted-foreground">{instructions[field].length.toLocaleString("ar-YE")}</span>
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

        {activeTab === "channels" && (
          <div className="space-y-3">
            {channels.length === 0 && <p className="text-sm text-muted-foreground">{t("agents.detail.noChannels")}</p>}
            {channels.map((channel: any) => (
              <div key={channel.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                <div>
                  <div className="font-medium">{channel.displayName ?? channel.channelType ?? t("agents.detail.channel")}</div>
                  <div className="text-muted-foreground">{channel.channelType ?? ""}</div>
                </div>
                <StatusBadge status={channel.mode ?? "disabled"} />
              </div>
            ))}
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
                    <div className="text-muted-foreground">{run.provider} · {run.model}</div>
                  </div>
                  <div className="text-left text-xs text-muted-foreground">{formatDateTime(run.createdAt)}</div>
                </div>
              </div>
            ))}
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
                <div className="mb-2 font-semibold">{t("agents.detail.suggestedReply")}</div>
                <p className="whitespace-pre-wrap leading-relaxed">{playgroundResult.draft}</p>
                {playgroundResult.sources?.length > 0 && (
                  <div className="mt-4 border-t border-border pt-3">
                    <div className="mb-2 text-xs font-semibold text-muted-foreground">{t("agents.detail.sources")}</div>
                    <div className="space-y-1">
                      {playgroundResult.sources.map((source: any) => <div key={`${source.type}:${source.id}`} className="text-xs text-muted-foreground">{source.title}</div>)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
