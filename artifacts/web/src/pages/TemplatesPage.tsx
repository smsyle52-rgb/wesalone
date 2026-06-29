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

interface TemplateRow {
  id: string;
  name: string;
  category: string;
  language: string;
  status: string;
  updatedAt?: string;
}

const statusOptions = ["", "draft", "submitted", "approved", "rejected", "paused", "disabled"];
const categoryOptions = ["", "marketing", "utility", "authentication"];
const languageOptions = ["", "ar", "en"];

function PermissionDenied() {
  const { t } = useTranslation("pages");
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-800">
      {t("templates.permissionDenied")}
    </div>
  );
}

export default function TemplatesPage() {
  const { t } = useTranslation("pages");
  const { hasPermission } = useAuth();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [language, setLanguage] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const canRead = hasPermission("templates:read");
  const canWrite = hasPermission("templates:write");
  const canSubmit = hasPermission("templates:submit");
  const canDelete = hasPermission("templates:delete");

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (category) params.set("category", category);
  if (language) params.set("language", language);
  params.set("page", String(page));
  params.set("limit", String(PAGE_SIZE));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["templates", status, category, language, page],
    queryFn: () => apiFetch(`templates?${params.toString()}`),
    enabled: canRead,
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`templates/${id}/duplicate`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`templates/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`templates/${id}/submit`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`templates/${id}/sync`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });

  const syncAllMutation = useMutation({
    mutationFn: () => apiFetch("templates/sync-all", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });

  const templates: TemplateRow[] = data?.templates ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns = [
    { key: "name", label: t("templates.table.name"), render: (row: TemplateRow) => <span className="font-medium">{row.name}</span> },
    { key: "category", label: t("templates.table.category"), render: (row: TemplateRow) => t(`templates.categories.${row.category}`, { defaultValue: row.category }) },
    { key: "language", label: t("templates.table.language"), render: (row: TemplateRow) => row.language },
    { key: "status", label: t("templates.table.status"), render: (row: TemplateRow) => <StatusBadge status={row.status} /> },
    { key: "updatedAt", label: t("templates.table.updatedAt"), render: (row: TemplateRow) => formatDateTime(row.updatedAt) },
    {
      key: "actions",
      label: t("templates.table.actions"),
      render: (row: TemplateRow) => (
        <details className="relative">
          <summary className="inline-flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-border bg-background hover:bg-muted">
            <MoreHorizontal className="h-4 w-4" />
          </summary>
          <div className="absolute end-0 z-10 mt-1 w-44 rounded-lg border border-border bg-popover p-1 shadow-lg">
            <button className="block w-full rounded px-3 py-2 text-start text-sm hover:bg-muted" onClick={() => setLocation(`/templates/${row.id}`)}>
              {t("common.edit")}
            </button>
            {canWrite && (
              <button className="block w-full rounded px-3 py-2 text-start text-sm hover:bg-muted" onClick={() => duplicateMutation.mutate(row.id)}>
                {t("common.duplicate")}
              </button>
            )}
            {canDelete && (
              <button className="block w-full rounded px-3 py-2 text-start text-sm text-destructive hover:bg-destructive/10" onClick={() => deleteMutation.mutate(row.id)}>
                {t("common.delete")}
              </button>
            )}
            {canSubmit && row.status === "draft" && (
              <button className="block w-full rounded px-3 py-2 text-start text-sm hover:bg-muted" onClick={() => submitMutation.mutate(row.id)}>
                {t("templates.actions.submit")}
              </button>
            )}
            <button className="block w-full rounded px-3 py-2 text-start text-sm hover:bg-muted" onClick={() => syncMutation.mutate(row.id)}>
              {t("templates.actions.sync")}
            </button>
          </div>
        </details>
      ),
    },
  ];

  return (
    <div dir="rtl">
      <PageHeader
        title={t("templates.title")}
        subtitle={t("templates.subtitle")}
        actions={
          <div className="flex gap-2">
            {canSubmit && (
              <button
                onClick={() => syncAllMutation.mutate()}
                disabled={syncAllMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50"
              >
                {t("templates.actions.syncAll")}
              </button>
            )}
            {canWrite && (
              <button
                onClick={() => setLocation("/templates/new")}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                {t("templates.newTemplate")}
              </button>
            )}
          </div>
        }
      />

      {!canRead ? (
        <PermissionDenied />
      ) : (
        <>
          <div className="mb-4 grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">{t("templates.filters.status")}</span>
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-full rounded-lg border border-input bg-background px-3 py-2">
                {statusOptions.map((item) => (
                  <option key={item || "all"} value={item}>
                    {item ? t(`templates.statuses.${item}`, { defaultValue: item }) : t("templates.filters.allStatuses")}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">{t("templates.filters.category")}</span>
              <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="w-full rounded-lg border border-input bg-background px-3 py-2">
                {categoryOptions.map((item) => (
                  <option key={item || "all"} value={item}>
                    {item ? t(`templates.categories.${item}`, { defaultValue: item }) : t("templates.filters.allCategories")}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">{t("templates.filters.language")}</span>
              <select value={language} onChange={(e) => { setLanguage(e.target.value); setPage(1); }} className="w-full rounded-lg border border-input bg-background px-3 py-2">
                {languageOptions.map((item) => (
                  <option key={item || "all"} value={item}>
                    {item || t("templates.filters.allLanguages")}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {isError && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              <span>{t("templates.loadError")}</span>
              <button onClick={() => refetch()} className="underline">{t("common.retry")}</button>
            </div>
          )}

          <DataTable
            columns={columns}
            data={templates}
            keyExtractor={(row) => row.id}
            isLoading={isLoading}
            emptyMessage={t("templates.empty")}
          />

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>{t("templates.pagination.showing", { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, total), total })}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                >
                  {t("templates.pagination.prev")}
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                >
                  {t("templates.pagination.next")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
