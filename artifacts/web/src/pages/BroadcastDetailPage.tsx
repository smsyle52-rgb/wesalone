import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable } from "@/components/ui/DataTable";
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

export default function BroadcastDetailPage({ broadcastId }: { broadcastId: string }) {
  const { t } = useTranslation("pages");
  const qc = useQueryClient();
  const detailQuery = useQuery({ queryKey: ["broadcast", broadcastId], queryFn: () => apiFetch(`broadcasts/${broadcastId}`) });
  const statsQuery = useQuery({ queryKey: ["broadcast-stats", broadcastId], queryFn: () => apiFetch(`broadcasts/${broadcastId}/stats`) });
  const recipientsQuery = useQuery({ queryKey: ["broadcast-recipients", broadcastId], queryFn: () => apiFetch(`broadcasts/${broadcastId}/recipients`) });

  const startMutation = useMutation({
    mutationFn: () => apiFetch(`broadcasts/${broadcastId}/start`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcast", broadcastId] });
      qc.invalidateQueries({ queryKey: ["broadcast-stats", broadcastId] });
      qc.invalidateQueries({ queryKey: ["broadcast-recipients", broadcastId] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => apiFetch(`broadcasts/${broadcastId}/cancel`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["broadcast", broadcastId] }),
  });

  const broadcast = detailQuery.data?.broadcast;
  const stats = statsQuery.data?.stats ?? {};
  const recipients = recipientsQuery.data?.recipients ?? [];
  const cards = ["sent", "delivered", "read", "replied", "failed"] as const;

  const columns = [
    { key: "contactName", label: t("broadcasts.detail.contact"), render: (row: any) => row.contactName ?? "—" },
    { key: "status", label: t("broadcasts.table.status"), render: (row: any) => <StatusBadge status={row.status} /> },
    { key: "sentAt", label: t("broadcasts.detail.sentAt"), render: (row: any) => formatDateTime(row.sentAt) },
    { key: "errorMessage", label: t("broadcasts.detail.error"), render: (row: any) => row.errorMessage ?? "—" },
  ];

  return (
    <div dir="rtl">
      <PageHeader
        title={broadcast?.name ?? t("broadcasts.detail.title")}
        subtitle={t("broadcasts.detail.subtitle")}
        actions={
          broadcast && (
            <div className="flex gap-2">
              {broadcast.status === "draft" && (
                <button onClick={() => startMutation.mutate()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                  {t("common.sendNow")}
                </button>
              )}
              {["scheduled", "sending"].includes(broadcast.status) && (
                <button onClick={() => cancelMutation.mutate()} className="rounded-lg border border-destructive/30 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10">
                  {t("common.cancel")}
                </button>
              )}
            </div>
          )
        }
      />

      {broadcast && (
        <div className="mb-4 flex items-center gap-3 text-sm text-muted-foreground">
          <StatusBadge status={broadcast.status} />
          <span>{t("broadcasts.detail.audienceCount", { count: detailQuery.data?.audienceCount ?? 0 })}</span>
        </div>
      )}

      <div className="mb-6 grid gap-3 md:grid-cols-5">
        {cards.map((key) => (
          <div key={key} className="rounded-xl border border-border bg-card p-4">
            <div className="text-sm text-muted-foreground">{t(`broadcasts.stats.${key}`)}</div>
            <div className="mt-2 text-2xl font-bold">{Number(stats[key] ?? 0).toLocaleString("ar-YE-u-nu-latn")}</div>
          </div>
        ))}
      </div>

      <DataTable columns={columns} data={recipients} keyExtractor={(row: any) => row.id} isLoading={recipientsQuery.isLoading} emptyMessage={t("broadcasts.detail.noRecipients")} />
    </div>
  );
}
