import { Link } from "wouter";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils";

const channels = [
  {
    name: "الصندوق اليدوي",
    status: "available",
    description: "متاح الآن لإدارة محادثات العملاء يدوياً واستيراد نصوص المحادثات.",
    action: "فتح صندوق الوارد",
    href: "/inbox",
  },
  {
    name: "واتساب",
    status: "soon",
    description: "قريباً. لا يوجد ربط مباشر أو إرسال تلقائي في هذه النسخة.",
  },
  {
    name: "إنستغرام",
    status: "soon",
    description: "قريباً بعد تجهيز الربط الرسمي ومراجعة الصلاحيات.",
  },
  {
    name: "ماسنجر",
    status: "soon",
    description: "قريباً. حالياً يمكن للفريق العمل من الصندوق اليدوي.",
  },
  {
    name: "تيليغرام",
    status: "soon",
    description: "قريباً. لن يتم إرسال رسائل خارجية قبل التفعيل الرسمي.",
  },
  {
    name: "موقعك الإلكتروني",
    status: "soon",
    description: "قريباً لاستقبال رسائل الموقع داخل صندوق الوارد.",
  },
];

const safeguards = [
  "لا يوجد إرسال تلقائي للعملاء",
  "لا يوجد ربط واتساب مباشر الآن",
  "لا توجد بوابة دفع إلكتروني",
  "لا يتم تشغيل أي تكامل حي من هذه الصفحة",
];

function ChannelCard({ channel }: { channel: (typeof channels)[number] }) {
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
          available ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"
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

export default function IntegrationsPage() {
  return (
    <div dir="rtl" className="space-y-6">
      <PageHeader
        title="القنوات"
        subtitle="طريقة تشغيل فريقك مع العملاء الآن، وما سيتم ربطه لاحقاً"
      />

      <section className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-blue-900">
        <h2 className="text-base font-semibold">ابدأ من الصندوق اليدوي</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed">
          حالياً يمكنك تشغيل الفريق من الصندوق اليدوي: افتح محادثة، الصق نص العميل، استخدم اقتراحات المساعد، ثم حوّل المحادثة إلى طلب أو متابعة. سيتم تفعيل الربط المباشر لاحقاً بدون تغيير طريقة عمل الفريق.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {channels.map((channel) => (
          <ChannelCard key={channel.name} channel={channel} />
        ))}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">ضمانات العرض التجريبي</h2>
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
