import { useState } from "react";
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

export default function AgentsPage() {
  const { t } = useTranslation("pages");
  const { hasPermission } = useAuth();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const canRead = hasPermission("ai:read");
  const canConfigure = hasPermission("ai:configure");

  const providerQuery = useQuery({
    queryKey: ["ai-provider-status"],
    queryFn: () => apiFetch("ai/provider-status"),
    enabled: canRead,
  });

  const agentsQuery = useQuery({
    queryKey: ["ai-agents"],
    queryFn: () => apiFetch("ai/agents"),
    enabled: canRead,
  });

  const createAgent = useMutation({
    mutationFn: () => apiFetch("ai/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: createName, type: "support", defaultModel: "mock", dialect: "standard_arabic" }),
    }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["ai-agents"] });
      setShowCreate(false);
      setCreateName("");
      setLocation(`/agents/${data.agent.id}`);
    },
    onError: (err) => setMessage((err as Error).message),
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
  const provider = providerQuery.data;
  const providerStatusLabel = provider?.provider === "vertex" && !provider?.fallbackMode
    ? t("agents.provider.vertex")
    : provider?.provider === "gemini" && !provider?.fallbackMode
      ? t("agents.provider.gemini")
      : provider?.fallbackMode
        ? t("agents.provider.fallback")
        : t("agents.provider.mock");
  const providerStatusDotClass = provider?.provider === "vertex" && !provider?.fallbackMode
    ? "bg-emerald-500"
    : provider?.provider === "gemini" && !provider?.fallbackMode
      ? "bg-sky-500"
      : provider?.fallbackMode
        ? "bg-amber-500"
        : "bg-muted-foreground";

  const columns = [
    { key: "name", label: t("agents.table.name"), render: (row: AgentRow) => <button className="font-medium text-primary hover:underline" onClick={() => setLocation(`/agents/${row.id}`)}>{row.name}</button> },
    { key: "model", label: t("agents.table.model"), render: (row: AgentRow) => t(`agents.models.${row.defaultModel}`, { defaultValue: row.defaultModel }) },
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

      <div className="mb-3 flex justify-start">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs shadow-sm">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${providerStatusDotClass}`} />
          <span className="font-semibold text-foreground">{t("agents.providerStatus")}</span>
          <span className="text-muted-foreground">{providerStatusLabel}</span>
        </div>
      </div>

      {message && <div className="mb-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{message}</div>}

      <DataTable
        columns={columns}
        data={agents}
        keyExtractor={(row) => row.id}
        isLoading={agentsQuery.isLoading}
        emptyMessage="لا يوجد وكلاء بعد. أنشئ وكيلًا أولًا، اربطه بقاعدة معرفة، واجعله في وضع الاقتراح قبل التشغيل."
      />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("agents.create.title")}</h2>
              <button onClick={() => setShowCreate(false)} className="rounded-lg px-3 py-2 text-sm hover:bg-muted">{t("common.cancel")}</button>
            </div>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("agents.fields.name")}</span>
              <input value={createName} onChange={(event) => setCreateName(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2" />
            </label>
            <button onClick={() => createAgent.mutate()} disabled={!createName.trim() || createAgent.isPending} className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {t("common.create")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
