import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { formatDate } from "@/lib/utils";

const BASE = `${import.meta.env.BASE_URL}api`;
const apiFetch = async (path: string) => {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text();
    try { const j = JSON.parse(text); throw new Error(j.error ?? text); } catch { throw new Error(text); }
  }
  return res.json();
};

const ACTION_LABELS: Record<string, string> = {
  create: "إنشاء",
  update: "تعديل",
  delete: "حذف",
  login: "دخول",
  logout: "خروج",
  login_failed: "دخول فاشل",
  invite: "دعوة",
  suspend: "إيقاف",
  activate: "تفعيل",
  assign_role: "تعيين دور",
  remove_role: "إزالة دور",
  confirm: "تأكيد",
  reject: "رفض",
  switch_workspace: "تبديل المساحة",
  workspace_update: "تحديث المساحة",
  register: "تسجيل",
};

const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-100 text-green-800",
  update: "bg-blue-100 text-blue-800",
  delete: "bg-red-100 text-red-800",
  login: "bg-gray-100 text-gray-700",
  logout: "bg-gray-100 text-gray-700",
  login_failed: "bg-red-100 text-red-800",
  invite: "bg-purple-100 text-purple-800",
  suspend: "bg-orange-100 text-orange-800",
  activate: "bg-green-100 text-green-800",
  assign_role: "bg-indigo-100 text-indigo-800",
  remove_role: "bg-orange-100 text-orange-800",
  confirm: "bg-green-100 text-green-800",
  reject: "bg-red-100 text-red-800",
  switch_workspace: "bg-gray-100 text-gray-700",
  workspace_update: "bg-blue-100 text-blue-800",
  register: "bg-purple-100 text-purple-800",
};

const ENTITY_LABELS: Record<string, string> = {
  contact: "عميل",
  conversation: "محادثة",
  ticket: "تذكرة",
  task: "مهمة",
  followup: "متابعة",
  opportunity: "فرصة",
  order: "طلب",
  payment: "دفعة",
  workspace: "مساحة العمل",
  user: "مستخدم",
  auth: "المصادقة",
  session: "جلسة",
};

const SEVERITY_LABELS: Record<string, string> = {
  info: "معلومات",
  warning: "تحذير",
  critical: "حرج",
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "bg-gray-100 text-gray-600",
  warning: "bg-yellow-100 text-yellow-800",
  critical: "bg-red-100 text-red-800",
};

type AuditLog = {
  id: string;
  actorType: string;
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  severity: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  ipAddress: string | null;
  createdAt: string;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
};

function PermissionDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <span className="text-4xl">🔒</span>
      <p className="text-muted-foreground text-sm">ليس لديك صلاحية لعرض سجل النشاطات</p>
    </div>
  );
}

function Badge({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

export default function AuditLogsPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission("audit_logs:read");

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const [filters, setFilters] = useState({
    action: "",
    entity_type: "",
    severity: "",
    date_from: "",
    date_to: "",
    search: "",
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (filters.action) params.set("action", filters.action);
    if (filters.entity_type) params.set("entity_type", filters.entity_type);
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    if (filters.search) params.set("search", filters.search);
    params.set("page", String(page));
    params.set("page_size", String(PAGE_SIZE));
    return params.toString();
  };

  const { data, isLoading, isError, refetch } = useQuery<{
    logs: AuditLog[];
    total: number;
    page: number;
    pageSize: number;
  }>({
    queryKey: ["audit-logs", filters, page],
    queryFn: () => apiFetch(`audit-logs?${buildQuery()}`),
    enabled: canRead,
  });

  const handleFilterChange = (key: keyof typeof filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleResetFilters = () => {
    setFilters({ action: "", entity_type: "", severity: "", date_from: "", date_to: "", search: "" });
    setPage(1);
  };

  if (!canRead) return (
    <>
      <PageHeader title="سجلات النشاط" subtitle="مراقبة جميع الإجراءات داخل المساحة" />
      <PermissionDenied />
    </>
  );

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader title="سجلات النشاط" subtitle="مراقبة جميع الإجراءات داخل المساحة" />

      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-4 mb-4 space-y-3">
        {/* Search */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="بحث في المستخدم أو الكيان..."
            value={filters.search}
            onChange={(e) => handleFilterChange("search", e.target.value)}
            className="flex-1 h-9 px-3 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {hasFilters && (
            <button
              onClick={handleResetFilters}
              className="h-9 px-3 text-xs text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
            >
              مسح الفلاتر
            </button>
          )}
        </div>

        {/* Filter row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <select
            value={filters.action}
            onChange={(e) => handleFilterChange("action", e.target.value)}
            className="h-9 px-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">كل الإجراءات</option>
            {Object.entries(ACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          <select
            value={filters.entity_type}
            onChange={(e) => handleFilterChange("entity_type", e.target.value)}
            className="h-9 px-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">كل الكيانات</option>
            {Object.entries(ENTITY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          <select
            value={filters.severity}
            onChange={(e) => handleFilterChange("severity", e.target.value)}
            className="h-9 px-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">كل مستويات الخطورة</option>
            {Object.entries(SEVERITY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          <input
            type="date"
            value={filters.date_from}
            onChange={(e) => handleFilterChange("date_from", e.target.value)}
            title="من تاريخ"
            className="h-9 px-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />

          <input
            type="date"
            value={filters.date_to}
            onChange={(e) => handleFilterChange("date_to", e.target.value)}
            title="إلى تاريخ"
            className="h-9 px-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {/* States */}
      {isLoading && (
        <div className="bg-card border border-border rounded-xl divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="p-4 animate-pulse flex items-center gap-3">
              <div className="h-4 w-24 bg-muted rounded" />
              <div className="h-4 w-20 bg-muted rounded" />
              <div className="h-4 w-16 bg-muted rounded" />
              <div className="h-4 flex-1 bg-muted rounded" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center space-y-3">
          <p className="text-red-800 text-sm">حدث خطأ أثناء تحميل السجلات</p>
          <button
            onClick={() => refetch()}
            className="text-sm px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg transition-colors"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {!isLoading && !isError && data && data.logs.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-16 text-center text-muted-foreground">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-sm font-medium">لا توجد سجلات</p>
          <p className="text-xs mt-1 text-muted-foreground/70">
            {hasFilters ? "جرّب تغيير الفلاتر أو مسحها" : "ستظهر هنا الأنشطة عند حدوثها"}
          </p>
        </div>
      )}

      {!isLoading && !isError && data && data.logs.length > 0 && (
        <>
          {/* Table */}
          <div className="bg-card border border-border rounded-xl overflow-hidden mb-4">
            <div className="grid gap-3 p-3 md:hidden">
              {data.logs.map((log) => {
                const isExpanded = expandedId === log.id;
                const hasChangeData = log.oldData !== undefined || log.newData !== undefined;
                const hasActualData = (log.oldData && Object.keys(log.oldData).length > 0) ||
                                     (log.newData && Object.keys(log.newData).length > 0);
                return (
                  <div key={log.id} className="rounded-xl border border-border bg-background p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {log.actorLabel ?? (log.actorType === "system" ? "النظام" : "—")}
                        </div>
                        <div className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</div>
                      </div>
                      <Badge
                        label={SEVERITY_LABELS[log.severity] ?? log.severity}
                        colorClass={SEVERITY_COLORS[log.severity] ?? "bg-gray-100 text-gray-600"}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="block text-muted-foreground">الإجراء</span>
                        <Badge
                          label={ACTION_LABELS[log.action] ?? log.action}
                          colorClass={ACTION_COLORS[log.action] ?? "bg-gray-100 text-gray-700"}
                        />
                      </div>
                      <div>
                        <span className="block text-muted-foreground">الكيان</span>
                        <span className="font-medium text-foreground">{ENTITY_LABELS[log.entityType] ?? log.entityType}</span>
                        {log.entityLabel && <span className="mt-0.5 block truncate text-muted-foreground">{log.entityLabel}</span>}
                      </div>
                      <div className="col-span-2">
                        <span className="block text-muted-foreground">العنوان</span>
                        <span className="font-medium text-foreground">{log.ipAddress ?? "—"}</span>
                      </div>
                    </div>
                    {hasActualData && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                        className="mt-3 w-full rounded-lg border border-border px-3 py-2 text-xs font-medium text-primary hover:bg-muted"
                      >
                        {isExpanded ? "إخفاء التفاصيل" : "عرض التفاصيل"}
                      </button>
                    )}
                    {isExpanded && hasChangeData && (
                      <div className="mt-3 grid gap-3 text-xs">
                        {log.oldData && Object.keys(log.oldData).length > 0 && (
                          <div>
                            <p className="mb-1 font-semibold text-muted-foreground">قبل التعديل:</p>
                            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs leading-relaxed text-foreground">
                              {JSON.stringify(log.oldData, null, 2)}
                            </pre>
                          </div>
                        )}
                        {log.newData && Object.keys(log.newData).length > 0 && (
                          <div>
                            <p className="mb-1 font-semibold text-muted-foreground">بعد التعديل:</p>
                            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs leading-relaxed text-foreground">
                              {JSON.stringify(log.newData, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-start">
                    <th className="px-4 py-3 font-medium text-muted-foreground text-xs">التاريخ</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-xs">المنفّذ</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-xs">الإجراء</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-xs">الكيان</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-xs">الخطورة</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-xs">العنوان</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.logs.map((log) => {
                    const isExpanded = expandedId === log.id;
                    const hasChangeData = log.oldData !== undefined || log.newData !== undefined;
                    const hasActualData = (log.oldData && Object.keys(log.oldData).length > 0) ||
                                         (log.newData && Object.keys(log.newData).length > 0);
                    return (
                      <Fragment key={log.id}>
                        <tr
                          className="hover:bg-muted/30 transition-colors cursor-default"
                          onClick={() => hasActualData && setExpandedId(isExpanded ? null : log.id)}
                        >
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(log.createdAt)}
                          </td>
                          <td className="px-4 py-3 font-medium text-foreground max-w-[140px] truncate">
                            {log.actorLabel ?? (log.actorType === "system" ? "النظام" : "—")}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              label={ACTION_LABELS[log.action] ?? log.action}
                              colorClass={ACTION_COLORS[log.action] ?? "bg-gray-100 text-gray-700"}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-muted-foreground">
                                {ENTITY_LABELS[log.entityType] ?? log.entityType}
                              </span>
                              {log.entityLabel && (
                                <span className="text-foreground text-xs font-medium truncate max-w-[120px]">
                                  {log.entityLabel}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              label={SEVERITY_LABELS[log.severity] ?? log.severity}
                              colorClass={SEVERITY_COLORS[log.severity] ?? "bg-gray-100 text-gray-600"}
                            />
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {log.ipAddress ?? "—"}
                            {hasActualData && (
                              <span className="ms-2 text-primary text-xs font-medium cursor-pointer hover:underline">
                                {isExpanded ? "إخفاء" : "تفاصيل"}
                              </span>
                            )}
                          </td>
                        </tr>
                        {isExpanded && hasChangeData && (
                          <tr key={`${log.id}-details`} className="bg-muted/20">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                {log.oldData && Object.keys(log.oldData).length > 0 && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">قبل التعديل:</p>
                                    <pre className="bg-muted rounded p-2 overflow-x-auto text-foreground whitespace-pre-wrap break-all text-xs leading-relaxed">
                                      {JSON.stringify(log.oldData, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {log.newData && Object.keys(log.newData).length > 0 && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">بعد التعديل:</p>
                                    <pre className="bg-muted rounded p-2 overflow-x-auto text-foreground whitespace-pre-wrap break-all text-xs leading-relaxed">
                                      {JSON.stringify(log.newData, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span className="text-xs">
              {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, data.total)} من {data.total} سجل
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-xs border border-border rounded-lg disabled:opacity-40 hover:bg-muted transition-colors"
              >
                السابق
              </button>
              <span className="px-3 py-1.5 text-xs">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-xs border border-border rounded-lg disabled:opacity-40 hover:bg-muted transition-colors"
              >
                التالي
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
