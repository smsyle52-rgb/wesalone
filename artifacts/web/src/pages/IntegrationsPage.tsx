import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { cn, formatDateTime } from "@/lib/utils";

const BASE = `${import.meta.env.BASE_URL}api`;

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { error?: string };
      throw new Error(json.error ?? text);
    } catch {
      throw new Error(text);
    }
  }
  return res.json() as Promise<T>;
}

type ProviderAccount = {
  id: string;
  provider: string;
  displayName: string;
  status: string;
  externalAccountId: string | null;
  createdAt: string;
};

type WebhookEvent = {
  id: string;
  provider: string;
  eventType: string;
  externalEventId: string | null;
  status: string;
  receivedAt: string;
  retryCount: number;
};

type OutboxMessage = {
  id: string;
  provider: string;
  destination: string;
  status: string;
  retryCount: number;
  createdAt: string;
};

type HealthCheck = {
  id: string;
  provider: string;
  status: string;
  lastCheckedAt: string;
  latencyMs: number | null;
  message: string | null;
};

type AccountsResponse = {
  accounts: ProviderAccount[];
  deadLetterCount: number;
};

type EventsResponse = { events: WebhookEvent[] };
type OutboxResponse = { messages: OutboxMessage[] };
type HealthResponse = { healthChecks: HealthCheck[]; deadLetterCount: number };

const providerLabels: Record<string, string> = {
  whatsapp_cloud: "WhatsApp Cloud API",
  instagram: "Instagram",
  messenger: "Messenger",
  telegram: "Telegram",
  website_widget: "Website Widget",
  payment_manual: "Manual Payments",
  payment_gateway: "Payment Gateway",
  storage_gcs: "Google Cloud Storage",
};

const statusLabels: Record<string, string> = {
  draft: "مسودة",
  active: "نشط",
  disabled: "معطل",
  error: "خطأ",
  received: "مستلم",
  processing: "قيد المعالجة",
  processed: "تمت المعالجة",
  failed: "فشل",
  ignored: "متجاهل",
  dead_letter: "معزول",
  pending: "معلق",
  sending: "قيد الإرسال",
  sent: "مرسل",
  cancelled: "ملغي",
  ok: "سليم",
  warning: "تحذير",
  unknown: "غير معروف",
};

const statusClasses: Record<string, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  ok: "bg-green-50 text-green-700 border-green-200",
  draft: "bg-gray-50 text-gray-700 border-gray-200",
  disabled: "bg-gray-50 text-gray-600 border-gray-200",
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  received: "bg-blue-50 text-blue-700 border-blue-200",
  processing: "bg-blue-50 text-blue-700 border-blue-200",
  processed: "bg-green-50 text-green-700 border-green-200",
  sent: "bg-green-50 text-green-700 border-green-200",
  warning: "bg-yellow-50 text-yellow-700 border-yellow-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  error: "bg-red-50 text-red-700 border-red-200",
  dead_letter: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-gray-50 text-gray-600 border-gray-200",
  ignored: "bg-gray-50 text-gray-600 border-gray-200",
  unknown: "bg-gray-50 text-gray-600 border-gray-200",
};

const placeholders = [
  {
    title: "WhatsApp Cloud API",
    description: "سيتم تفعيله لاحقاً بعد إعداد Meta ومراجعة أذونات القناة.",
  },
  {
    title: "Meta Embedded Signup",
    description: "غير مربوط حالياً. لا يوجد زر تسجيل أو ربط مباشر في هذه النسخة.",
  },
  {
    title: "Payment Gateway",
    description: "سيتم تفعيله لاحقاً. المدفوعات الحالية يدوية فقط ولا تستدعي مزود دفع.",
  },
];

function Badge({ value }: { value: string }) {
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", statusClasses[value] ?? "bg-muted text-muted-foreground border-border")}>
      {statusLabels[value] ?? value}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {message}
    </div>
  );
}

export default function IntegrationsPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission("integrations:read");
  const canViewEvents = hasPermission("integrations:view_events");

  const accountsQuery = useQuery({
    queryKey: ["integrations", "provider-accounts"],
    queryFn: () => apiFetch<AccountsResponse>("integrations/provider-accounts"),
    enabled: canRead,
  });

  const healthQuery = useQuery({
    queryKey: ["integrations", "health"],
    queryFn: () => apiFetch<HealthResponse>("integrations/health"),
    enabled: canRead,
  });

  const eventsQuery = useQuery({
    queryKey: ["integrations", "webhook-events"],
    queryFn: () => apiFetch<EventsResponse>("integrations/webhook-events?limit=20"),
    enabled: canRead && canViewEvents,
  });

  const outboxQuery = useQuery({
    queryKey: ["integrations", "outbox"],
    queryFn: () => apiFetch<OutboxResponse>("integrations/outbox?limit=20"),
    enabled: canRead,
  });

  if (!canRead) {
    return (
      <div dir="rtl">
        <PageHeader title="التكاملات" subtitle="مراقبة آمنة للتكاملات الخارجية قبل تفعيل الربط الحي" />
        <div className="flex min-h-[300px] items-center justify-center">
          <div className="text-center">
            <div className="mb-3 text-4xl">🔒</div>
            <p className="text-sm text-muted-foreground">ليس لديك صلاحية عرض التكاملات</p>
          </div>
        </div>
      </div>
    );
  }

  const accounts = accountsQuery.data?.accounts ?? [];
  const healthChecks = healthQuery.data?.healthChecks ?? [];
  const events = eventsQuery.data?.events ?? [];
  const outbox = outboxQuery.data?.messages ?? [];
  const deadLetterCount = healthQuery.data?.deadLetterCount ?? accountsQuery.data?.deadLetterCount ?? 0;

  return (
    <div dir="rtl" className="space-y-6">
      <PageHeader
        title="التكاملات"
        subtitle="دفتر آمن للأحداث والرسائل قبل ربط القنوات والدفع والتخزين"
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {placeholders.map((item) => (
          <div key={item.title} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
              <Badge value="disabled" />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-2xl font-bold text-foreground">{accounts.length}</div>
          <div className="mt-1 text-sm text-muted-foreground">حسابات مزودين</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-2xl font-bold text-foreground">{healthChecks.length}</div>
          <div className="mt-1 text-sm text-muted-foreground">فحوصات صحة</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-2xl font-bold text-foreground">{events.length}</div>
          <div className="mt-1 text-sm text-muted-foreground">أحداث Webhook معروضة</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className={cn("text-2xl font-bold", deadLetterCount > 0 ? "text-red-600" : "text-foreground")}>{deadLetterCount}</div>
          <div className="mt-1 text-sm text-muted-foreground">Dead letter</div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">حسابات المزودين</h2>
        {accountsQuery.isLoading && <EmptyState message="جار تحميل حسابات المزودين..." />}
        {accountsQuery.isError && <ErrorState message={(accountsQuery.error as Error).message} />}
        {!accountsQuery.isLoading && !accountsQuery.isError && accounts.length === 0 && (
          <EmptyState message="لا توجد حسابات مزودين بعد. الربط الحي غير مفعل في هذه المرحلة." />
        )}
        {accounts.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-right text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">المزود</th>
                  <th className="px-4 py-3 font-medium">الاسم</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">تاريخ الإنشاء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td className="px-4 py-3">{providerLabels[account.provider] ?? account.provider}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{account.displayName}</td>
                    <td className="px-4 py-3"><Badge value={account.status} /></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(account.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">صحة التكاملات</h2>
        {healthQuery.isLoading && <EmptyState message="جار تحميل حالة الصحة..." />}
        {healthQuery.isError && <ErrorState message={(healthQuery.error as Error).message} />}
        {!healthQuery.isLoading && !healthQuery.isError && healthChecks.length === 0 && (
          <EmptyState message="لا توجد فحوصات صحة بعد. ستظهر هنا بعد تفعيل مراقبة المزودين." />
        )}
        {healthChecks.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {healthChecks.map((check) => (
              <div key={check.id} className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{providerLabels[check.provider] ?? check.provider}</span>
                  <Badge value={check.status} />
                </div>
                <div className="text-xs text-muted-foreground">{check.message ?? "لا توجد رسالة حالة"}</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  آخر فحص: {formatDateTime(check.lastCheckedAt)}
                  {check.latencyMs !== null ? ` · ${check.latencyMs}ms` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Webhook events</h2>
          {!canViewEvents && <EmptyState message="تحتاج صلاحية عرض أحداث التكامل لرؤية هذا الجدول." />}
          {canViewEvents && eventsQuery.isLoading && <EmptyState message="جار تحميل أحداث الويبهوك..." />}
          {canViewEvents && eventsQuery.isError && <ErrorState message={(eventsQuery.error as Error).message} />}
          {canViewEvents && !eventsQuery.isLoading && !eventsQuery.isError && events.length === 0 && (
            <EmptyState message="لا توجد أحداث Webhook بعد." />
          )}
          {canViewEvents && events.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40 text-right text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">المزود</th>
                    <th className="px-4 py-3 font-medium">النوع</th>
                    <th className="px-4 py-3 font-medium">الحالة</th>
                    <th className="px-4 py-3 font-medium">الوقت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td className="px-4 py-3">{providerLabels[event.provider] ?? event.provider}</td>
                      <td className="px-4 py-3">{event.eventType}</td>
                      <td className="px-4 py-3"><Badge value={event.status} /></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(event.receivedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Outbox</h2>
          {outboxQuery.isLoading && <EmptyState message="جار تحميل رسائل outbox..." />}
          {outboxQuery.isError && <ErrorState message={(outboxQuery.error as Error).message} />}
          {!outboxQuery.isLoading && !outboxQuery.isError && outbox.length === 0 && (
            <EmptyState message="لا توجد رسائل Outbox. لا يتم إرسال أي رسائل خارجية في هذه المرحلة." />
          )}
          {outbox.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40 text-right text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">المزود</th>
                    <th className="px-4 py-3 font-medium">الوجهة</th>
                    <th className="px-4 py-3 font-medium">الحالة</th>
                    <th className="px-4 py-3 font-medium">محاولات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {outbox.map((message) => (
                    <tr key={message.id}>
                      <td className="px-4 py-3">{providerLabels[message.provider] ?? message.provider}</td>
                      <td className="px-4 py-3 max-w-[160px] truncate">{message.destination}</td>
                      <td className="px-4 py-3"><Badge value={message.status} /></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{message.retryCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
