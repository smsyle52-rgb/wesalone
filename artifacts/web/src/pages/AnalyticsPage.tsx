import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

const BASE = `${import.meta.env.BASE_URL}api`;

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const json = JSON.parse(text);
      if (typeof json.error === "string" && json.error.trim()) message = json.error;
    } catch {
      message = text;
    }
    throw new Error(message);
  }
  return res.json();
}

type AnalyticsTab = "overview" | "conversations" | "sales" | "finance" | "ai" | "team" | "channels";

const TABS: { key: AnalyticsTab; label: string }[] = [
  { key: "overview", label: "نظرة عامة" },
  { key: "conversations", label: "المحادثات" },
  { key: "sales", label: "المبيعات" },
  { key: "finance", label: "الماليات" },
  { key: "ai", label: "الذكاء الاصطناعي" },
  { key: "team", label: "الفريق" },
  { key: "channels", label: "القنوات" },
];

function normalizeNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    if (!cleaned) return 0;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatNumber(value: unknown) {
  return normalizeNumber(value).toLocaleString("ar-SA-u-nu-latn");
}

function StatCard({ label, value, sub }: { label: string; value: unknown; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-sm text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-bold text-foreground">{formatNumber(value)}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusTable({ rows, statusLabel = "الحالة" }: { rows: { status?: string; stage?: string; taskType?: string; direction?: string; provider?: string; channel?: string; count: number; total?: number; value?: number }[]; statusLabel?: string }) {
  if (!rows.length) return <div className="text-xs text-muted-foreground">لا توجد بيانات</div>;
  return (
    <>
      <div className="grid gap-2 md:hidden">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg border border-border bg-background p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{statusLabel}</span>
              <span className="min-w-0 truncate text-sm font-semibold text-foreground">{r.status ?? r.stage ?? r.taskType ?? r.direction ?? r.provider ?? r.channel ?? "—"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="block text-muted-foreground">العدد</span>
                <span className="font-medium text-foreground">{r.count.toLocaleString("ar-SA-u-nu-latn")}</span>
              </div>
              {r.total !== undefined && (
                <div>
                  <span className="block text-muted-foreground">الإجمالي</span>
                  <span className="font-medium text-foreground">{Number(r.total).toLocaleString("ar-SA-u-nu-latn")}</span>
                </div>
              )}
              {r.value !== undefined && (
                <div>
                  <span className="block text-muted-foreground">القيمة</span>
                  <span className="font-medium text-foreground">{Number(r.value).toLocaleString("ar-SA-u-nu-latn")}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-start py-2 pe-2 font-medium">{statusLabel}</th>
            <th className="text-start py-2 font-medium">العدد</th>
            {rows[0]?.total !== undefined && <th className="text-start py-2 font-medium">الإجمالي</th>}
            {rows[0]?.value !== undefined && <th className="text-start py-2 font-medium">القيمة</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-2 pe-2 text-foreground">{r.status ?? r.stage ?? r.taskType ?? r.direction ?? r.provider ?? r.channel ?? "—"}</td>
              <td className="py-2 font-medium">{r.count.toLocaleString("ar-SA-u-nu-latn")}</td>
              {r.total !== undefined && <td className="py-2 text-muted-foreground">{Number(r.total).toLocaleString("ar-SA-u-nu-latn")}</td>}
              {r.value !== undefined && <td className="py-2 text-muted-foreground">{Number(r.value).toLocaleString("ar-SA-u-nu-latn")}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-sm font-semibold text-foreground mb-3">{title}</div>
      {children}
    </div>
  );
}

function DateRangePicker({ dateFrom, dateTo, onChange }: { dateFrom: string; dateTo: string; onChange: (from: string, to: string) => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">من</span>
      <input type="date" value={dateFrom} onChange={(e) => onChange(e.target.value, dateTo)} className="border border-border rounded-lg px-2 py-1 text-sm bg-background" />
      <span className="text-muted-foreground">إلى</span>
      <input type="date" value={dateTo} onChange={(e) => onChange(dateFrom, e.target.value)} className="border border-border rounded-lg px-2 py-1 text-sm bg-background" />
    </div>
  );
}

function LoadingState() {
  return <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">جار التحميل...</div>;
}

function ErrorState({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="text-sm text-destructive">{error}</div>
      <button onClick={retry} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">إعادة المحاولة</button>
    </div>
  );
}

export default function AnalyticsPage() {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<AnalyticsTab>("overview");
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo.toISOString().split("T")[0]);
  const [dateTo, setDateTo] = useState(today);

  const canRead = hasPermission("analytics:read");

  const params = `date_from=${dateFrom}&date_to=${dateTo}`;

  const overview = useQuery({ queryKey: ["analytics-overview", dateFrom, dateTo], queryFn: () => apiFetch(`analytics/overview?${params}`), enabled: canRead && tab === "overview" });
  const operations = useQuery({ queryKey: ["analytics-operations", dateFrom, dateTo], queryFn: () => apiFetch(`analytics/operations?${params}`), enabled: canRead && tab === "conversations" });
  const sales = useQuery({ queryKey: ["analytics-sales", dateFrom, dateTo], queryFn: () => apiFetch(`analytics/sales?${params}`), enabled: canRead && tab === "sales" });
  const finance = useQuery({ queryKey: ["analytics-finance", dateFrom, dateTo], queryFn: () => apiFetch(`analytics/finance?${params}`), enabled: canRead && tab === "finance" });
  const ai = useQuery({ queryKey: ["analytics-ai", dateFrom, dateTo], queryFn: () => apiFetch(`analytics/ai?${params}`), enabled: canRead && tab === "ai" });
  const team = useQuery({ queryKey: ["analytics-team", dateFrom, dateTo], queryFn: () => apiFetch(`analytics/team?${params}`), enabled: canRead && tab === "team" });
  const channels = useQuery({ queryKey: ["analytics-channels", dateFrom, dateTo], queryFn: () => apiFetch(`analytics/channels?${params}`), enabled: canRead && tab === "channels" });

  if (!canRead) {
    return (
      <div className="flex items-center justify-center min-h-[300px]" dir="rtl">
        <div className="text-center">
          <div className="text-4xl mb-3">🔒</div>
          <p className="text-muted-foreground">ليس لديك صلاحية عرض التحليلات</p>
        </div>
      </div>
    );
  }

  const currentQuery = { overview, conversations: operations, sales, finance, ai, team, channels }[tab];

  return (
    <div dir="rtl">
      <PageHeader title="التحليلات" subtitle="تحليلات الأداء والبيانات التشغيلية" />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex gap-1 border-b border-border overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn("px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t.label}
            </button>
          ))}
        </div>
        <DateRangePicker dateFrom={dateFrom} dateTo={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
      </div>

      {currentQuery?.isLoading && <LoadingState />}
      {currentQuery?.isError && <ErrorState error={(currentQuery.error as Error).message} retry={() => currentQuery.refetch()} />}

      {/* OVERVIEW */}
      {tab === "overview" && overview.data && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            ⚠️ تعرض هذه الصفحة مزيجاً من الحالة الحالية ونشاط اليوم. المقاييس التفصيلية في التبويبات الأخرى تعتمد على النطاق الزمني المحدد.
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <StatCard label="إجمالي العملاء" value={overview.data.totalContacts} />
            <StatCard label="محادثات مفتوحة" value={overview.data.openConversations} />
            <StatCard label="رسائل اليوم" value={overview.data.messagesCount} />
            <StatCard label="تذاكر مفتوحة" value={overview.data.openTickets} />
            <StatCard label="مهام معلقة" value={overview.data.pendingTasks} />
            <StatCard label="متابعات متأخرة" value={overview.data.overdueFollowups} />
            <StatCard label="فرص مفتوحة" value={overview.data.openOpportunities} />
            <StatCard label="طلبات اليوم" value={overview.data.ordersToday} />
            <StatCard label="مدفوعات مؤكدة اليوم" value={overview.data.paymentsConfirmedToday} sub="ر.ي" />
            <StatCard label="ديون مفتوحة" value={overview.data.openDebtsAmount} sub="ر.ي" />
            <StatCard label="تشغيلات AI اليوم" value={overview.data.aiRunsToday} />
          </div>
        </div>
      )}

      {/* OPERATIONS */}
      {tab === "conversations" && operations.data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionCard title="التذاكر حسب الحالة">
            <StatusTable rows={operations.data.ticketsByStatus ?? []} />
          </SectionCard>
          <SectionCard title="المهام حسب الحالة">
            <StatusTable rows={operations.data.tasksByStatus ?? []} />
          </SectionCard>
          <SectionCard title="المتابعات حسب الحالة">
            <StatusTable rows={operations.data.followupsByStatus ?? []} />
          </SectionCard>
          <SectionCard title="الفرص حسب المرحلة">
            <StatusTable rows={operations.data.opportunitiesByStage ?? []} statusLabel="المرحلة" />
          </SectionCard>
          <StatCard label="متابعات متأخرة" value={operations.data.overdueFollowups ?? 0} />
        </div>
      )}

      {/* SALES */}
      {tab === "sales" && sales.data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="صفقات مكتسبة" value={sales.data.wonCount} sub={`${Number(sales.data.wonValue).toLocaleString("ar-SA-u-nu-latn")} ر.ي`} />
            <StatCard label="صفقات خسرت" value={sales.data.lostCount} />
            <StatCard label="إجمالي الطلبات" value={sales.data.ordersCount} sub={`${Number(sales.data.ordersTotal).toLocaleString("ar-SA-u-nu-latn")} ر.ي`} />
            <StatCard label="متوسط قيمة الطلب" value={sales.data.avgOrderValue} sub="ر.ي" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SectionCard title="الفرص حسب المرحلة">
              <StatusTable rows={sales.data.opportunitiesByStage ?? []} statusLabel="المرحلة" />
            </SectionCard>
            <SectionCard title="الطلبات حسب الحالة">
              <StatusTable rows={sales.data.ordersByStatus ?? []} />
            </SectionCard>
          </div>
        </div>
      )}

      {/* FINANCE */}
      {tab === "finance" && finance.data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="مدفوعات مؤكدة" value={finance.data.paymentsConfirmedTotal} sub={`${finance.data.paymentsConfirmedCount} عملية`} />
            <StatCard label="مدفوعات معلقة" value={finance.data.paymentsPendingTotal} sub={`${finance.data.paymentsPendingCount} عملية`} />
            <StatCard label="مدفوعات مرفوضة" value={finance.data.paymentsRejectedTotal} sub={`${finance.data.paymentsRejectedCount} عملية`} />
            <StatCard label="ديون مفتوحة" value={finance.data.debtsOpenAmount} sub={`${finance.data.debtsOpenCount} دين — ر.ي`} />
            <StatCard label="ديون متأخرة" value={finance.data.debtsOverdueAmount} sub={`${finance.data.debtsOverdueCount} دين — ر.ي`} />
          </div>
          <SectionCard title="المدفوعات حسب الحالة">
            <StatusTable rows={finance.data.paymentsByStatus ?? []} />
          </SectionCard>
        </div>
      )}

      {/* AI */}
      {tab === "ai" && ai.data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="إجمالي التشغيلات" value={ai.data.totalAiRuns ?? 0} />
            <StatCard label="أحداث الأمان" value={ai.data.safetyBlockedCount ?? 0} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SectionCard title="التشغيلات حسب النوع">
              <StatusTable rows={(ai.data.runsByTaskType ?? []).map((r: { taskType: string; count: number }) => ({ status: r.taskType, count: r.count }))} />
            </SectionCard>
            <SectionCard title="حالة المساعد الذكي">
              <StatusTable rows={(ai.data.runsByProviderStatus ?? []).map((r: { status: string; count: number }) => ({ status: r.status, count: r.count }))} />
            </SectionCard>
            <SectionCard title="طلبات الاعتماد حسب الحالة">
              <StatusTable rows={ai.data.approvalsByStatus ?? []} />
            </SectionCard>
          </div>
        </div>
      )}

      {/* TEAM */}
      {tab === "team" && team.data && (
        <div className="space-y-4">
          {!team.data.teamStats?.length ? (
            <div className="text-sm text-muted-foreground py-8 text-center">لا توجد بيانات لأعضاء الفريق</div>
          ) : (
            <>
            <div className="grid gap-3 md:hidden">
              {team.data.teamStats.map((m: { userId: string; name: string; email: string; messagesSent: number; tasksCompleted: number; followupsCompleted: number; ordersCreated: number; paymentsRecorded: number }) => (
                <div key={m.userId} className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-3">
                    <div className="font-semibold text-foreground">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div><span className="block text-muted-foreground">رسائل مرسلة</span><span className="font-medium">{m.messagesSent.toLocaleString("ar-SA-u-nu-latn")}</span></div>
                    <div><span className="block text-muted-foreground">مهام مكتملة</span><span className="font-medium">{m.tasksCompleted.toLocaleString("ar-SA-u-nu-latn")}</span></div>
                    <div><span className="block text-muted-foreground">متابعات مكتملة</span><span className="font-medium">{m.followupsCompleted.toLocaleString("ar-SA-u-nu-latn")}</span></div>
                    <div><span className="block text-muted-foreground">طلبات منشأة</span><span className="font-medium">{m.ordersCreated.toLocaleString("ar-SA-u-nu-latn")}</span></div>
                    <div><span className="block text-muted-foreground">مدفوعات مسجلة</span><span className="font-medium">{m.paymentsRecorded.toLocaleString("ar-SA-u-nu-latn")}</span></div>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-start py-3 px-4 font-medium">الموظف</th>
                    <th className="text-start py-3 px-3 font-medium">رسائل مرسلة</th>
                    <th className="text-start py-3 px-3 font-medium">مهام مكتملة</th>
                    <th className="text-start py-3 px-3 font-medium">متابعات مكتملة</th>
                    <th className="text-start py-3 px-3 font-medium">طلبات منشأة</th>
                    <th className="text-start py-3 px-3 font-medium">مدفوعات مسجلة</th>
                  </tr>
                </thead>
                <tbody>
                  {team.data.teamStats.map((m: { userId: string; name: string; email: string; messagesSent: number; tasksCompleted: number; followupsCompleted: number; ordersCreated: number; paymentsRecorded: number }) => (
                    <tr key={m.userId} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="py-3 px-4">
                        <div className="font-medium text-foreground">{m.name}</div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </td>
                      <td className="py-3 px-3">{m.messagesSent.toLocaleString("ar-SA-u-nu-latn")}</td>
                      <td className="py-3 px-3">{m.tasksCompleted.toLocaleString("ar-SA-u-nu-latn")}</td>
                      <td className="py-3 px-3">{m.followupsCompleted.toLocaleString("ar-SA-u-nu-latn")}</td>
                      <td className="py-3 px-3">{m.ordersCreated.toLocaleString("ar-SA-u-nu-latn")}</td>
                      <td className="py-3 px-3">{m.paymentsRecorded.toLocaleString("ar-SA-u-nu-latn")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      )}

      {/* CHANNELS */}
      {tab === "channels" && channels.data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionCard title="المحادثات حسب القناة">
            <StatusTable rows={(channels.data.conversationsByChannel ?? []).map((r: { channel: string; count: number }) => ({ channel: r.channel, count: r.count }))} statusLabel="القناة" />
          </SectionCard>
          <SectionCard title="الرسائل حسب الاتجاه">
            <StatusTable rows={(channels.data.messagesByDirection ?? []).map((r: { direction: string; count: number }) => ({ direction: r.direction, count: r.count }))} statusLabel="الاتجاه" />
          </SectionCard>
        </div>
      )}
    </div>
  );
}
