import { Link } from "wouter";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils";

const BASE = `${import.meta.env.BASE_URL}api`;

type ConnectedChannel = {
  id: string;
  channelType: "whatsapp" | "instagram" | "messenger";
  displayName: string;
  status: string;
  hasCredentialReference: boolean;
  providerConfig?: Record<string, unknown>;
  updatedAt?: string;
};

const manualChannels = [
  {
    name: "الصندوق اليدوي",
    status: "available",
    description: "متاح الآن لإدارة محادثات العملاء يدوياً واستيراد نصوص المحادثات عند الحاجة.",
    action: "فتح صندوق الوارد",
    href: "/inbox",
  },
  {
    name: "تيليجرام",
    status: "soon",
    description: "قريباً. تيليجرام مزود مستقل وسيتم إضافته لاحقاً عند الحاجة التجارية.",
  },
  {
    name: "موقعك الإلكتروني",
    status: "soon",
    description: "قريباً لاستقبال رسائل الموقع داخل صندوق الوارد.",
  },
];

const safeguards = [
  "لا يوجد إرسال تلقائي إلا عبر وضع الثقة المصرح به",
  "لا تظهر رموز الوصول أو أسرار Meta في الواجهة",
  "كل قناة مرتبطة تبقى داخل مساحة العمل الحالية فقط",
  "عند غياب أسرار Meta يعمل النظام في وضع DRY_RUN الآمن",
];

function ChannelCard({ channel }: { channel: (typeof manualChannels)[number] }) {
  const available = channel.status === "available";
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{channel.name}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{channel.description}</p>
        </div>
        <span className={cn(
          "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium",
          available ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700",
        )}>
          {available ? "متاح الآن" : "قريباً"}
        </span>
      </div>
      {available && channel.href ? (
        <Link href={channel.href}>
          <span className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            {channel.action}
          </span>
        </Link>
      ) : (
        <button
          disabled
          title="سيتم تفعيله لاحقاً بعد الربط الرسمي"
          className="rounded-lg border border-border bg-muted px-4 py-2 text-sm font-medium text-muted-foreground opacity-70"
        >
          سيتم تفعيله لاحقاً
        </button>
      )}
    </div>
  );
}

function ConnectedChannelCard({ channel }: { channel: ConnectedChannel }) {
  const label = channel.channelType === "whatsapp"
    ? "واتساب"
    : channel.channelType === "instagram"
      ? "إنستقرام"
      : "ماسنجر";

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{label}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{channel.displayName}</p>
        </div>
        <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
          {channel.status === "active" ? "نشط" : channel.status}
        </span>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {channel.hasCredentialReference ? "رمز الوصول محفوظ كمرجع آمن." : "لا يوجد مرجع رمز وصول بعد."}
      </p>
    </div>
  );
}

export default function IntegrationsPage() {
  const [isStartingMeta, setIsStartingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [connectedChannels, setConnectedChannels] = useState<ConnectedChannel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadChannels() {
      setIsLoadingChannels(true);
      try {
        const res = await fetch(`${BASE}/integrations/meta/channels`, { credentials: "include" });
        const data = await res.json();
        if (!cancelled && res.ok) setConnectedChannels(data.accounts ?? []);
      } finally {
        if (!cancelled) setIsLoadingChannels(false);
      }
    }
    void loadChannels();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startMetaSignup() {
    setIsStartingMeta(true);
    setMetaError(null);
    try {
      const res = await fetch(`${BASE}/integrations/meta/embedded-signup/start`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? data.missing?.join(", ") ?? "تعذر تجهيز ربط قنوات Meta");
      window.open(data.url, "meta-channels-signup", "width=820,height=780,noopener,noreferrer");
    } catch (err) {
      setMetaError((err as Error).message);
    } finally {
      setIsStartingMeta(false);
    }
  }

  async function disconnectChannel(id: string) {
    setDisconnectingId(id);
    setMetaError(null);
    try {
      const res = await fetch(`${BASE}/integrations/channels/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "تعذر فصل القناة");
      setConnectedChannels((current) => current.map((channel) => (
        channel.id === id ? { ...channel, status: "disabled", updatedAt: data.account?.updatedAt ?? channel.updatedAt } : channel
      )));
    } catch (err) {
      setMetaError((err as Error).message);
    } finally {
      setDisconnectingId(null);
    }
  }

  const metaChannelStatuses = (["whatsapp", "instagram", "messenger"] as const).map((type) => {
    const channel = connectedChannels.find((item) => item.channelType === type && item.status === "active");
    return { type, channel };
  });

  return (
    <div dir="rtl" className="space-y-6">
      <PageHeader
        title="القنوات"
        subtitle="شغّل قنوات العملاء من مكان واحد، مع إبقاء الأسرار والرموز خارج الواجهة."
      />

      <section className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-blue-900">
        <h2 className="text-base font-semibold">ابدأ من الصندوق اليدوي</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed">
          يمكنك تشغيل الفريق من الصندوق اليدوي الآن. وعند جاهزية إعدادات Meta، يمكن ربط واتساب وإنستقرام وماسنجر عبر نفس المسار الرسمي دون تغيير طريقة العمل داخل صندوق الوارد.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">قنوات Meta</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              يدعم المسار الموحد اختيار واتساب وإنستقرام وماسنجر بعد إكمال الربط. في وضع التطوير لا يتم أي إرسال خارجي.
            </p>
            {metaError && <p className="mt-2 text-sm text-destructive">{metaError}</p>}
          </div>
          <button
            type="button"
            onClick={startMetaSignup}
            disabled={isStartingMeta}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isStartingMeta ? "جار التجهيز..." : "ربط قنوات ميتا الإضافية"}
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          {metaChannelStatuses.map((item) => (
            <div key={item.type} className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-foreground">
                  {item.type === "whatsapp" ? "WhatsApp" : item.type === "instagram" ? "Instagram" : "Messenger"}
                </span>
                <span className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium",
                  item.channel ? "border-green-200 bg-green-50 text-green-700" : "border-slate-200 bg-slate-50 text-slate-600",
                )}>
                  {item.channel ? "متصل" : "غير متصل"}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {item.channel?.displayName ?? "لم يتم ربط قناة بعد"}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          {isLoadingChannels ? (
            <div className="rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
              جار تحميل القنوات المرتبطة...
            </div>
          ) : connectedChannels.length > 0 ? (
            connectedChannels.map((channel) => (
              <div key={channel.id} className="space-y-2">
                <ConnectedChannelCard channel={channel} />
                <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
                  <span className="text-xs text-muted-foreground">
                    آخر نشاط: {channel.updatedAt ? new Date(channel.updatedAt).toLocaleString("ar-YE-u-nu-latn") : "غير متاح"}
                  </span>
                  <button
                    type="button"
                    onClick={() => disconnectChannel(channel.id)}
                    disabled={disconnectingId === channel.id || channel.status === "disabled"}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
                  >
                    فصل
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-background p-4 text-sm text-muted-foreground md:col-span-3">
              لا توجد قنوات Meta مرتبطة بعد. أكمل الربط الرسمي ثم اختر القنوات التي تريد تشغيلها.
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {manualChannels.map((channel) => (
          <ChannelCard key={channel.name} channel={channel} />
        ))}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">ضمانات التشغيل</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {safeguards.map((item) => (
            <div key={item} className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground">
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
