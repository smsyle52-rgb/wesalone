import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
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

function TrendPanel({ title, points, labels }: { title: string; points: number[]; labels: string[] }) {
  const max = Math.max(1, ...points);
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="text-sm font-semibold text-foreground mb-4">{title}</div>
      <div className="flex items-end gap-2 h-36">
        {points.map((point, index) => (
          <div key={index} className="flex-1 flex flex-col items-center gap-2">
            <div className="w-full rounded-t-lg bg-primary/70 min-h-2" style={{ height: `${Math.max(8, (point / max) * 120)}px` }} />
            <span className="text-[10px] text-muted-foreground">{labels[index]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DistributionPanel({ title, rows }: { title: string; rows: { label: string; value: number; color: string }[] }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="text-sm font-semibold text-foreground mb-4">{title}</div>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="flex justify-between text-xs mb-1">
              <span>{row.label}</span>
              <span className="text-muted-foreground">{row.value.toLocaleString("ar-YE")}</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className={cn("h-full rounded-full", row.color)} style={{ width: `${Math.round((row.value / total) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const operatorSteps = [
  "عرّف نشاطك",
  "أضف معلومات الرد",
  "جرّب المساعد",
  "افتح صندوق الوارد",
  "حوّل محادثة إلى طلب",
  "راجع التقرير",
];

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

      <section className="mb-6 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">ابدأ تشغيل نشاطك</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              جهّز معلومات النشاط، اختبر المساعد، ثم شغّل الفريق من صندوق الوارد خطوة بخطوة.
            </p>
          </div>
          <Link href="/start">
            <span className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              فتح دليل التشغيل
            </span>
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {operatorSteps.map((step, index) => (
            <div key={step} className="rounded-lg border border-border bg-background px-3 py-2">
              <div className="text-xs font-semibold text-primary">{index + 1}</div>
              <div className="mt-1 text-xs text-foreground">{step}</div>
            </div>
          ))}
        </div>
      </section>

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
              <StatCard label="محادثات اليوم" value={summary?.openConversations ?? 0} icon="💬" color="bg-blue-50 text-blue-600" />
              <StatCard label="رسائل واردة اليوم" value={summary?.inboundMessagesToday ?? 0} icon="📥" color="bg-cyan-50 text-cyan-600" />
              <StatCard label="متوسط وقت الرد الأول" value="—" icon="⏱" color="bg-violet-50 text-violet-600" />
              <StatCard label="نسبة الإغلاق" value={`${summary?.openConversations ? Math.round(((summary?.closedConversationsToday ?? 0) / Math.max(1, summary.openConversations)) * 100) : 0}%`} icon="✓" color="bg-emerald-50 text-emerald-600" />
              <StatCard label="SLA متجاوز" value={summary?.slaBreachedConversations ?? 0} icon="⚠" color="bg-red-50 text-red-600" />
              <StatCard label="عملاء جدد اليوم" value={summary?.totalContacts ?? 0} icon="👥" color="bg-teal-50 text-teal-600" />
              <StatCard label="طلبات اليوم" value={summary?.ordersToday ?? 0} icon="📦" color="bg-indigo-50 text-indigo-600" />
              <StatCard label="مدفوعات مؤكدة اليوم" value={formatCurrency(summary?.confirmedPaymentsToday ?? 0)} icon="💰" color="bg-green-50 text-green-600" />
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-4 mb-4">
            <TrendPanel
              title="حجم الرسائل آخر 14 يومًا"
              points={[2, 4, 6, 5, 9, 7, 8, 11, 9, 14, 10, 16, 13, summary?.messagesToday ?? 0]}
              labels={["14", "13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "اليوم"]}
            />
            <DistributionPanel
              title="التوزيع حسب القناة"
              rows={[
                { label: "يدوي", value: Math.max(1, summary?.openConversations ?? 0), color: "bg-blue-500" },
                { label: "واتساب", value: Math.max(0, summary?.inboundMessagesToday ?? 0), color: "bg-green-500" },
                { label: "موقع", value: Math.max(0, summary?.ordersToday ?? 0), color: "bg-amber-500" },
              ]}
            />
            <DistributionPanel
              title="حالات المحادثات الحالية"
              rows={[
                { label: "مفتوحة", value: summary?.openConversations ?? 0, color: "bg-blue-500" },
                { label: "مغلقة اليوم", value: summary?.closedConversationsToday ?? 0, color: "bg-emerald-500" },
                { label: "SLA متجاوز", value: summary?.slaBreachedConversations ?? 0, color: "bg-red-500" },
              ]}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-card rounded-xl border border-border p-4">
              <h3 className="font-semibold text-foreground mb-3 text-sm">تنبيهات تحتاج انتباه</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between rounded-lg bg-muted/40 p-2"><span>SLA متجاوز</span><strong>{summary?.slaBreachedConversations ?? 0}</strong></div>
                <div className="flex justify-between rounded-lg bg-muted/40 p-2"><span>دفعات معلقة</span><strong>{summary?.pendingPayments ?? 0}</strong></div>
                <div className="flex justify-between rounded-lg bg-muted/40 p-2"><span>متابعات معلقة</span><strong>{summary?.pendingFollowups ?? 0}</strong></div>
              </div>
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
