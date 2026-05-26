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

interface BroadcastRow {
  id: string;
  name: string;
  templateName?: string;
  status: string;
  scheduledAt?: string | null;
  stats?: { total?: number; sent?: number };
}

export default function BroadcastsPage() {
  const { t } = useTranslation("pages");
  const { hasPermission } = useAuth();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const canRead = hasPermission("broadcasts:read");
  const canWrite = hasPermission("broadcasts:write");
  const canCancel = hasPermission("broadcasts:cancel");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["broadcasts", status],
    queryFn: () => apiFetch(`broadcasts${status ? `?status=${status}` : ""}`),
    enabled: canRead,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`broadcasts/${id}/cancel`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["broadcasts"] }),
  });

  const broadcasts: BroadcastRow[] = data?.broadcasts ?? [];

  const columns = [
    { key: "name", label: t("broadcasts.table.name"), render: (row: BroadcastRow) => <span className="font-medium">{row.name}</span> },
    { key: "templateName", label: t("broadcasts.table.template"), render: (row: BroadcastRow) => row.templateName ?? "—" },
    { key: "status", label: t("broadcasts.table.status"), render: (row: BroadcastRow) => <StatusBadge status={row.status} /> },
    { key: "audience", label: t("broadcasts.table.audience"), render: (row: BroadcastRow) => Number(row.stats?.total ?? 0).toLocaleString("ar-YE-u-nu-latn") },
    { key: "sent", label: t("broadcasts.table.sent"), render: (row: BroadcastRow) => Number(row.stats?.sent ?? 0).toLocaleString("ar-YE-u-nu-latn") },
    { key: "scheduledAt", label: t("broadcasts.table.scheduledAt"), render: (row: BroadcastRow) => formatDateTime(row.scheduledAt) },
    {
      key: "actions",
      label: t("broadcasts.table.actions"),
      render: (row: BroadcastRow) => (
        <details className="relative">
          <summary className="inline-flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-border bg-background hover:bg-muted">
            <MoreHorizontal className="h-4 w-4" />
          </summary>
          <div className="absolute end-0 z-10 mt-1 w-44 rounded-lg border border-border bg-popover p-1 shadow-lg">
            <button className="block w-full rounded px-3 py-2 text-start text-sm hover:bg-muted" onClick={() => setLocation(`/broadcasts/${row.id}`)}>
              {t("broadcasts.actions.viewDetails")}
            </button>
            {canCancel && ["scheduled", "sending"].includes(row.status) && (
              <button className="block w-full rounded px-3 py-2 text-start text-sm text-destructive hover:bg-destructive/10" onClick={() => cancelMutation.mutate(row.id)}>
                {t("common.cancel")}
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
        title={t("broadcasts.title")}
        subtitle={t("broadcasts.subtitle")}
        actions={
          canWrite && (
            <button onClick={() => setLocation("/broadcasts/new")} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4" />
              {t("broadcasts.newBroadcast")}
            </button>
          )
        }
      />

      {!canRead ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-800">{t("broadcasts.permissionDenied")}</div>
      ) : (
        <>
          <div className="mb-4 max-w-xs">
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option value="">{t("broadcasts.filters.allStatuses")}</option>
              {["draft", "scheduled", "sending", "completed", "cancelled", "failed"].map((item) => (
                <option key={item} value={item}>{t(`broadcasts.statuses.${item}`)}</option>
              ))}
            </select>
          </div>
          {isError && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              <span>{t("broadcasts.loadError")}</span>
              <button onClick={() => refetch()} className="underline">{t("common.retry")}</button>
            </div>
          )}
          <DataTable columns={columns} data={broadcasts} keyExtractor={(row) => row.id} isLoading={isLoading} emptyMessage={t("broadcasts.empty")} />
        </>
      )}
    </div>
  );
}
