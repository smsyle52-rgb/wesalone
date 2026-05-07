import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

async function apiFetch(path: string) {
  const res = await fetch(`${import.meta.env.BASE_URL}api/${path}`, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text();
    try { const j = JSON.parse(text); throw new Error(j.error ?? text); } catch { throw new Error(text); }
  }
  return res.json();
}

function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  return (
    <div className={cn("rounded-xl p-4 border border-border bg-card flex items-center gap-4")}>
      <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0", color)}>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold text-foreground">{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, hasPermission } = useAuth();
  const canViewAnalytics = hasPermission("analytics:read");

  const { data: summary, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => apiFetch("dashboard/summary"),
    enabled: canViewAnalytics,
  });
  const { data: activity } = useQuery({
    queryKey: ["dashboard-activity"],
    queryFn: () => apiFetch("dashboard/activity"),
    enabled: canViewAnalytics,
  });

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "صباح الخير";
    if (h < 17) return "مساء الخير";
    return "مساء النور";
  };

  return (
    <div dir="rtl">
      <PageHeader
        title={`${greeting()}، ${user?.name?.split(" ")[0] ?? ""}! 👋`}
        subtitle="إليك نظرة عامة على أعمالك اليوم"
      />

      {!canViewAnalytics ? (
        <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm text-center">
          🔒 ليس لديك صلاحية لتنفيذ هذا الإجراء
        </div>
      ) : (
        <>
          {isError && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm flex items-center justify-between">
              <span>تعذّر تحميل البيانات. يرجى المحاولة مجدداً.</span>
              <button onClick={() => refetch()} className="text-xs underline font-medium">إعادة المحاولة</button>
            </div>
          )}
          {isLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              <StatCard label="محادثات مفتوحة" value={summary?.openConversations ?? 0} icon="💬" color="bg-blue-50 text-blue-600" />
              <StatCard label="تذاكر مفتوحة" value={summary?.openTickets ?? 0} icon="🎫" color="bg-purple-50 text-purple-600" />
              <StatCard label="مهام معلقة" value={summary?.pendingTasks ?? 0} icon="✅" color="bg-yellow-50 text-yellow-600" />
              <StatCard label="متابعات اليوم" value={summary?.pendingFollowups ?? 0} icon="🔔" color="bg-red-50 text-red-600" />
              <StatCard label="طلبات اليوم" value={summary?.ordersToday ?? 0} icon="📦" color="bg-indigo-50 text-indigo-600" />
              <StatCard label="إيرادات اليوم" value={formatCurrency(summary?.revenueToday ?? 0)} icon="💰" color="bg-green-50 text-green-600" />
              <StatCard label="مدفوعات معلقة" value={summary?.pendingPayments ?? 0} icon="⏳" color="bg-orange-50 text-orange-600" />
              <StatCard label="إجمالي العملاء" value={summary?.totalContacts ?? 0} icon="👥" color="bg-teal-50 text-teal-600" />
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-card rounded-xl border border-border p-4">
              <h3 className="font-semibold text-foreground mb-3 text-sm">قيمة خط الفرص</h3>
              <div className="text-3xl font-bold text-primary">{formatCurrency(summary?.pipelineValue ?? 0)}</div>
              <p className="text-xs text-muted-foreground mt-1">الفرص النشطة في مسار المبيعات</p>
            </div>

            <div className="bg-card rounded-xl border border-border p-4">
              <h3 className="font-semibold text-foreground mb-3 text-sm">آخر النشاطات</h3>
              {!activity?.activities?.length ? (
                <p className="text-sm text-muted-foreground py-4 text-center">لا توجد نشاطات بعد</p>
              ) : (
                <div className="space-y-2">
                  {activity.activities.slice(0, 5).map((item: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 text-sm">
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs shrink-0 mt-0.5">
                        📋
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-foreground truncate">{item.entityLabel || item.action}</div>
                        <div className="text-xs text-muted-foreground">{item.actorName}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
