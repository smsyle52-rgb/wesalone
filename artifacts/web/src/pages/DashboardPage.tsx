import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  CheckSquare,
  Clock3,
  CreditCard,
  Inbox,
  Package,
  RefreshCw,
  Settings,
  ShoppingBag,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

type DashboardSummary = {
  openConversations?: number;
  inboundMessagesToday?: number;
  closedConversationsToday?: number;
  slaBreachedConversations?: number;
  totalContacts?: number;
  ordersToday?: number;
  confirmedPaymentsToday?: number;
  pendingPayments?: number;
  pendingFollowups?: number;
  messagesToday?: number;
};

type ActivityItem = {
  entityLabel?: string;
  action?: string;
  actorName?: string;
};

type MobileTile = {
  label: string;
  href: string;
  permission: string;
  icon: LucideIcon;
  badge?: number;
};

async function apiFetch(path: string) {
  const res = await fetch(`${import.meta.env.BASE_URL}api/${path}`, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as { error?: string };
      throw new Error(parsed.error ?? text);
    } catch {
      throw new Error(text);
    }
  }
  return res.json();
}

function DashboardSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold text-foreground">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function StatCard({
  label,
  value,
  helper,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  helper: string;
  icon: typeof Inbox;
  tone: string;
}) {
  return (
    <Card className="transition hover:-translate-y-1 hover:shadow-[var(--shadow-hover)]">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", tone)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-extrabold text-foreground">{value}</div>
          <div className="mt-0.5 text-sm font-bold text-foreground">{label}</div>
          <div className="mt-1 text-xs text-muted-foreground">{helper}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function TrendPanel({ title, points, labels }: { title: string; points: number[]; labels: string[] }) {
  const max = Math.max(1, ...points);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>نظرة سريعة على الحركة اليومية</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex h-48 items-end gap-2">
          {points.map((point, index) => (
            <div key={`${labels[index]}-${index}`} className="flex flex-1 flex-col items-center gap-2">
              <div className="w-full rounded-t-lg bg-gradient-to-t from-primary to-accent" style={{ height: `${Math.max(10, (point / max) * 150)}px` }} />
              <span className="text-xs text-muted-foreground">{labels[index]}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DistributionPanel({ title, rows }: { title: string; rows: { label: string; value: number; color: string }[] }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>توزيع يساعدك على تحديد الأولويات</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="font-bold text-foreground">{row.label}</span>
              <span className="text-muted-foreground">{row.value.toLocaleString("ar-YE-u-nu-latn")}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
              <div className={cn("h-full rounded-full", row.color)} style={{ width: `${Math.round((row.value / total) * 100)}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const setupSteps = [
  "عرّف نشاطك التجاري",
  "اربط قنوات التواصل",
  "أضف قاعدة المعرفة",
  "اختبر الوكيل الذكي",
  "ابدأ متابعة العملاء",
];

export default function DashboardPage() {
  const { user, hasPermission } = useAuth();
  const canViewAnalytics = hasPermission("analytics:read");

  const { data: summary, isLoading, isError, refetch } = useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary"],
    queryFn: () => apiFetch("dashboard/summary"),
    enabled: canViewAnalytics,
  });
  const { data: activity } = useQuery<{ activities: ActivityItem[] }>({
    queryKey: ["dashboard-activity"],
    queryFn: () => apiFetch("dashboard/activity"),
    enabled: canViewAnalytics,
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "صباح الخير" : hour < 17 ? "مساء الخير" : "مساء النور";
  const openConversations = summary?.openConversations ?? 0;
  const closedToday = summary?.closedConversationsToday ?? 0;
  const mobileTiles: MobileTile[] = [
    { label: "الوارد", href: "/inbox", permission: "conversations:read", icon: Inbox, badge: openConversations },
    { label: "الوكلاء", href: "/agents", permission: "ai:read", icon: Bot },
    { label: "المخزون", href: "/inventory", permission: "products:read", icon: ShoppingBag },
    { label: "الطلبات", href: "/orders", permission: "orders:read", icon: Package, badge: summary?.ordersToday ?? 0 },
    { label: "العملاء", href: "/contacts", permission: "contacts:read", icon: Users },
    { label: "المدفوعات", href: "/payments", permission: "payments:read", icon: CreditCard },
    { label: "المهام", href: "/tasks", permission: "tasks:read", icon: CheckSquare, badge: summary?.pendingFollowups ?? 0 },
    { label: "التحليلات", href: "/analytics", permission: "analytics:read", icon: BarChart3 },
    { label: "الإعدادات", href: "/settings", permission: "settings:read", icon: Settings },
  ].filter((tile) => hasPermission(tile.permission));

  return (
    <div dir="rtl">
      <div className="block space-y-5 lg:hidden">
        <div
          className="-mx-4 -mt-5 flex items-center justify-between bg-white px-4 py-[10px] sm:-mx-6 sm:px-6"
          style={{ borderBottom: "0.5px solid rgba(27,58,92,0.10)" }}
        >
          <div>
            <p className="text-[11px]" style={{ color: "#8A94A0" }}>{greeting}</p>
            <p className="text-[15px] font-medium" style={{ color: "#1B3A5C" }}>
              {user?.name?.split(" ")[0] ?? "مرحبًا"}
            </p>
          </div>
        </div>

        <Card className="overflow-hidden border-primary/10 bg-gradient-to-l from-primary/8 via-card to-accent/10">
          <CardContent className="space-y-3 p-4">
            <div>
              <p className="text-xs font-bold text-primary">دليل التشغيل السريع</p>
              <h2 className="mt-1 text-base font-extrabold text-foreground">ابدأ من الخطوات التي تجعل التجربة مفهومة لفريقك</h2>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                وصال ون يجمع المحادثات، المتابعة، الكتالوج، والوكيل الذكي في مسار واحد.
              </p>
            </div>
            <div className="grid gap-2">
              {setupSteps.map((step, index) => (
                <div key={step} className="rounded-lg border border-border/80 bg-card/80 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[0.68rem] font-black text-primary-foreground">{index + 1}</span>
                    <span className="text-xs font-bold text-foreground">{step}</span>
                  </div>
                </div>
              ))}
            </div>
            <Button asChild size="sm" className="mt-2 w-full">
              <Link href="/start">فتح دليل الإعداد الكامل</Link>
            </Button>
          </CardContent>
        </Card>

        {!canViewAnalytics ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="flex items-center gap-3 p-4 text-amber-800">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-xs font-bold">تحتاج صلاحية التحليلات لعرض مؤشرات لوحة التحكم.</span>
            </CardContent>
          </Card>
        ) : (
          <>
            {isError && (
              <Card className="border-destructive/20 bg-destructive/5">
                <CardContent className="flex items-center justify-between gap-3 p-3 text-xs text-destructive">
                  <span className="font-bold">تعذر تحميل بيانات لوحة التحكم.</span>
                  <Button variant="outline" size="sm" onClick={() => refetch()}>
                    <RefreshCw className="h-4 w-4" />
                    إعادة المحاولة
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-card p-2">
              {[
                ["تجاوز SLA", summary?.slaBreachedConversations ?? 0],
                ["مدفوعات معلقة", summary?.pendingPayments ?? 0],
                ["متابعات معلقة", summary?.pendingFollowups ?? 0],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-secondary/70 px-2 py-2 text-center">
                  <div className="text-lg font-extrabold text-foreground">{value}</div>
                  <div className="mt-0.5 text-[0.68rem] font-bold leading-4 text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="grid grid-cols-3 gap-2 p-3">
          {mobileTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <Link key={tile.href} href={tile.href}>
                <span
                  className="relative flex flex-col items-center justify-center rounded-2xl bg-white px-[6px] py-[13px] text-center gap-1.5"
                  style={{ border: "0.5px solid rgba(27,58,92,0.12)" }}
                >
                  {tile.badge ? (
                    <span
                      className="absolute end-1.5 top-1.5 min-w-5 rounded px-[5px] text-[10px] font-black leading-none text-white"
                      style={{ backgroundColor: "#1B3A5C" }}
                    >
                      {tile.badge}
                    </span>
                  ) : null}
                  <Icon className="h-[23px] w-[23px]" style={{ color: "#1B3A5C" }} />
                  <span className="text-[12px] font-medium" style={{ color: "#16293F" }}>
                    {tile.label}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>

        {canViewAnalytics && (
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base">آخر النشاطات</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              {!activity?.activities?.length ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center">
                  <BarChart3 className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                  <p className="text-sm font-bold text-foreground">لا توجد نشاطات بعد</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {activity.activities.slice(0, 3).map((item, index) => (
                    <div key={`${item.action}-${index}`} className="flex items-start gap-2 rounded-lg bg-secondary/45 p-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <BarChart3 className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold text-foreground">{item.entityLabel || item.action || "نشاط جديد"}</div>
                        <div className="text-[0.68rem] text-muted-foreground">{item.actorName ?? "النظام"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="hidden lg:block">
        <div className="space-y-8">
      <PageHeader
        title={`${greeting}، ${user?.name?.split(" ")[0] ?? "مرحبًا"}`}
        subtitle="لوحة هادئة تلخص أداء المحادثات والعملاء والمبيعات، وتساعدك على اختيار الخطوة التالية بثقة."
        actions={(
          <Button asChild>
            <Link href="/inbox">فتح صندوق الوارد</Link>
          </Button>
        )}
      />

      <Card className="overflow-hidden border-primary/10 bg-gradient-to-l from-primary/8 via-card to-accent/10">
        <CardContent className="grid gap-6 p-5 lg:grid-cols-[1.2fr_.8fr] lg:p-6">
          <div>
            <p className="text-sm font-bold text-primary">دليل التشغيل السريع</p>
            <h2 className="mt-2 text-2xl font-extrabold text-foreground">ابدأ من الخطوات التي تجعل التجربة مفهومة لفريقك</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              وصال ون يجمع المحادثات، المتابعة، الكتالوج، والوكيل الذكي في مسار واحد. أكمل هذه الخطوات ثم راقب الأداء من هذه اللوحة.
            </p>
          </div>
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {setupSteps.map((step, index) => (
                <div key={step} className="rounded-lg border border-border/80 bg-card/80 p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-black text-primary-foreground">{index + 1}</span>
                    <span className="text-sm font-bold text-foreground">{step}</span>
                  </div>
                </div>
              ))}
            </div>
            <Button asChild size="sm">
              <Link href="/start">فتح دليل الإعداد الكامل</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {!canViewAnalytics ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-center gap-3 p-5 text-amber-800">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-sm font-bold">تحتاج صلاحية التحليلات لعرض مؤشرات لوحة التحكم.</span>
          </CardContent>
        </Card>
      ) : (
        <>
          {isError && (
            <Card className="border-destructive/20 bg-destructive/5">
              <CardContent className="flex items-center justify-between gap-3 p-4 text-sm text-destructive">
                <span className="font-bold">تعذر تحميل بيانات لوحة التحكم.</span>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  <RefreshCw className="h-4 w-4" />
                  إعادة المحاولة
                </Button>
              </CardContent>
            </Card>
          )}

          <DashboardSection title="المؤشرات الأساسية" description="أرقام مختصرة تساعدك على فهم حالة اليوم بسرعة.">
            {isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-xl bg-muted" />)}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="محادثات مفتوحة" value={openConversations} helper="تحتاج متابعة من الفريق" icon={Inbox} tone="bg-blue-50 text-blue-700" />
                <StatCard label="رسائل واردة اليوم" value={summary?.inboundMessagesToday ?? 0} helper="حركة العملاء خلال اليوم" icon={TrendingUp} tone="bg-cyan-50 text-cyan-700" />
                <StatCard label="إغلاق اليوم" value={closedToday} helper="محادثات تم إنهاؤها" icon={CheckCircle2} tone="bg-emerald-50 text-emerald-700" />
                <StatCard label="تجاوز SLA" value={summary?.slaBreachedConversations ?? 0} helper="تحتاج انتباه سريع" icon={Clock3} tone="bg-red-50 text-red-700" />
                <StatCard label="إجمالي العملاء" value={summary?.totalContacts ?? 0} helper="قاعدة العملاء المسجلة" icon={Users} tone="bg-teal-50 text-teal-700" />
                <StatCard label="طلبات اليوم" value={summary?.ordersToday ?? 0} helper="طلبات دخلت للنظام" icon={Package} tone="bg-indigo-50 text-indigo-700" />
                <StatCard label="مدفوعات مؤكدة" value={formatCurrency(summary?.confirmedPaymentsToday ?? 0)} helper="إيراد مؤكد اليوم" icon={CreditCard} tone="bg-green-50 text-green-700" />
                <StatCard label="متابعات معلقة" value={summary?.pendingFollowups ?? 0} helper="لا تتركها تتراكم" icon={AlertTriangle} tone="bg-amber-50 text-amber-700" />
              </div>
            )}
          </DashboardSection>

          <DashboardSection title="قراءة الأداء" description="رسوم مبسطة تكشف اتجاه المحادثات وتوزيع الضغط.">
            <div className="grid gap-4 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <TrendPanel
                  title="حجم الرسائل آخر 14 يومًا"
                  points={[2, 4, 6, 5, 9, 7, 8, 11, 9, 14, 10, 16, 13, summary?.messagesToday ?? 0]}
                  labels={["14", "13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "اليوم"]}
                />
              </div>
              <DistributionPanel
                title="حالات المحادثات"
                rows={[
                  { label: "مفتوحة", value: openConversations, color: "bg-blue-500" },
                  { label: "مغلقة اليوم", value: closedToday, color: "bg-emerald-500" },
                  { label: "متأخرة", value: summary?.slaBreachedConversations ?? 0, color: "bg-red-500" },
                ]}
              />
            </div>
          </DashboardSection>

          <DashboardSection title="ما يحتاج متابعة" description="قوائم قصيرة بدل صفحة طويلة؛ ركز على القرارات لا الضجيج.">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>تنبيهات التشغيل</CardTitle>
                  <CardDescription>أهم النقاط التي تستحق الانتباه الآن.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    ["محادثات تجاوزت SLA", summary?.slaBreachedConversations ?? 0],
                    ["مدفوعات معلقة", summary?.pendingPayments ?? 0],
                    ["متابعات معلقة", summary?.pendingFollowups ?? 0],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between rounded-lg bg-secondary/70 p-3">
                      <span className="text-sm font-bold text-foreground">{label}</span>
                      <strong className="text-primary">{value}</strong>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>آخر النشاطات</CardTitle>
                  <CardDescription>أحدث ما حدث داخل مساحة العمل.</CardDescription>
                </CardHeader>
                <CardContent>
                  {!activity?.activities?.length ? (
                    <div className="rounded-lg border border-dashed border-border p-6 text-center">
                      <BarChart3 className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="text-sm font-bold text-foreground">لا توجد نشاطات بعد</p>
                      <p className="mt-1 text-xs text-muted-foreground">ستظهر هنا المحادثات والطلبات والتحديثات المهمة.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {activity.activities.slice(0, 5).map((item, index) => (
                        <div key={`${item.action}-${index}`} className="flex items-start gap-3 rounded-lg bg-secondary/45 p-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <BarChart3 className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold text-foreground">{item.entityLabel || item.action || "نشاط جديد"}</div>
                            <div className="text-xs text-muted-foreground">{item.actorName ?? "النظام"}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </DashboardSection>
        </>
      )}
        </div>
      </div>
    </div>
  );
}
