import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import { formatDateTime } from "@/lib/utils";

const BASE = `${import.meta.env.BASE_URL}api`;

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

interface AutomationRow {
  id: string;
  name: string;
  status: string;
  trigger?: { type?: string };
  runCount?: number;
  lastRunAt?: string | null;
  updatedAt?: string | null;
}

export default function AutomationsPage() {
  const { t } = useTranslation("pages");
  const { hasPermission } = useAuth();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const canRead = hasPermission("automations:read");
  const canWrite = hasPermission("automations:write");
  const canActivate = hasPermission("automations:activate");
  const canDelete = hasPermission("automations:delete");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["automations", status],
    queryFn: () => apiFetch(`automations${status ? `?status=${status}` : ""}`),
    enabled: canRead,
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "activate" | "pause" | "delete" }) => {
      const method = action === "delete" ? "DELETE" : "POST";
      const path = action === "delete" ? `automations/${id}` : `automations/${id}/${action}`;
      return apiFetch(path, { method });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }),
  });

  const automations: AutomationRow[] = data?.automations ?? [];
  const columns = [
    { key: "name", label: t("automations.table.name"), render: (row: AutomationRow) => <span className="font-medium">{row.name}</span> },
    { key: "trigger", label: t("automations.table.trigger"), render: (row: AutomationRow) => t(`automations.triggers.${row.trigger?.type ?? "unknown"}`, { defaultValue: row.trigger?.type ?? "—" }) },
    { key: "status", label: t("automations.table.status"), render: (row: AutomationRow) => <StatusBadge status={row.status} /> },
    { key: "runCount", label: t("automations.table.runCount"), render: (row: AutomationRow) => Number(row.runCount ?? 0).toLocaleString("ar-YE") },
    { key: "lastRunAt", label: t("automations.table.lastRunAt"), render: (row: AutomationRow) => formatDateTime(row.lastRunAt) },
    {
      key: "actions",
      label: t("automations.table.actions"),
      render: (row: AutomationRow) => (
        <details className="relative">
          <summary className="inline-flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-border bg-background hover:bg-muted">
            <MoreHorizontal className="h-4 w-4" />
          </summary>
          <div className="absolute end-0 z-10 mt-1 w-44 rounded-lg border border-border bg-popover p-1 shadow-lg">
            <button className="block w-full rounded px-3 py-2 text-start text-sm hover:bg-muted" onClick={() => setLocation(`/automations/${row.id}`)}>
              {t("common.edit")}
            </button>
            {canActivate && row.status !== "active" && (
              <button className="block w-full rounded px-3 py-2 text-start text-sm hover:bg-muted" onClick={() => actionMutation.mutate({ id: row.id, action: "activate" })}>
                {t("common.activate")}
              </button>
            )}
            {canActivate && row.status === "active" && (
              <button className="block w-full rounded px-3 py-2 text-start text-sm hover:bg-muted" onClick={() => actionMutation.mutate({ id: row.id, action: "pause" })}>
                {t("common.pause")}
              </button>
            )}
            {canDelete && (
              <button className="block w-full rounded px-3 py-2 text-start text-sm text-destructive hover:bg-destructive/10" onClick={() => actionMutation.mutate({ id: row.id, action: "delete" })}>
                {t("common.delete")}
              </button>
            )}
          </div>
        </details>
      ),
    },
  ];

  return (
    <div dir="rtl">
      <PageHeader
        title={t("automations.title")}
        subtitle={t("automations.subtitle")}
        actions={
          canWrite && (
            <button onClick={() => setLocation("/automations/new")} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4" />
              {t("automations.newAutomation")}
            </button>
          )
        }
      />

      {!canRead ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-800">{t("automations.permissionDenied")}</div>
      ) : (
        <>
          <div className="mb-4 max-w-xs">
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option value="">{t("automations.filters.allStatuses")}</option>
              {["draft", "active", "paused"].map((item) => (
                <option key={item} value={item}>{t(`automations.statuses.${item}`)}</option>
              ))}
            </select>
          </div>
          {isError && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              <span>{t("automations.loadError")}</span>
              <button onClick={() => refetch()} className="underline">{t("common.retry")}</button>
            </div>
          )}
          <DataTable columns={columns} data={automations} keyExtractor={(row) => row.id} isLoading={isLoading} emptyMessage={t("automations.empty")} />
        </>
      )}
    </div>
  );
}
