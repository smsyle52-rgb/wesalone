import {
  ArrowLeft,
  BarChart3,
  Bell,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Link2,
  MessageCircle,
  MonitorSmartphone,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { FaFacebookMessenger, FaInstagram, FaTelegram, FaWhatsapp } from "react-icons/fa6";

type Channel = {
  name: string;
  icon: ComponentType<{ className?: string }>;
  className: string;
};

const channels: Channel[] = [
  { name: "WhatsApp", icon: FaWhatsapp, className: "from-[#20d466] to-[#0aa84f]" },
  { name: "Instagram", icon: FaInstagram, className: "from-[#ff7a18] via-[#dd2a7b] to-[#515bd4]" },
  { name: "Messenger", icon: FaFacebookMessenger, className: "from-[#00b2ff] to-[#006aff]" },
  { name: "Telegram", icon: FaTelegram, className: "from-[#34ace1] to-[#168ac2]" },
];

const conversations = [
  { name: "سارة القحطاني", channel: "WhatsApp", text: "أريد معرفة توفر المنتج وطريقة الشحن", time: "11:42", color: "bg-emerald-500" },
  { name: "محمد العنسي", channel: "Messenger", text: "هل أقدر أتابع الطلب من نفس الصفحة؟", time: "11:36", color: "bg-blue-500" },
  { name: "نورة عبدالله", channel: "Instagram", text: "أحتاج تفاصيل العرض الأخير", time: "11:28", color: "bg-pink-500" },
  { name: "خالد النجار", channel: "Telegram", text: "تم الاستلام، شكراً لكم", time: "11:10", color: "bg-sky-500" },
];

const features = [
  {
    title: "صندوق وارد موحد",
    body: "اجمع رسائل القنوات في شاشة واحدة واضحة لفريقك.",
    icon: MessageCircle,
    tone: "bg-cyan-50 text-cyan-700",
  },
  {
    title: "رد أسرع",
    body: "قلّل وقت انتظار العملاء ووزّع المحادثات بذكاء.",
    icon: Zap,
    tone: "bg-blue-50 text-blue-700",
  },
  {
    title: "متابعة منظمة",
    body: "مهام، وسوم، وملاحظات داخلية بدون تشتيت.",
    icon: ClipboardCheck,
    tone: "bg-indigo-50 text-indigo-700",
  },
  {
    title: "تقارير ذكية",
    body: "تابع الأداء، سرعة الرد، ونمو المحادثات يومياً.",
    icon: BarChart3,
    tone: "bg-violet-50 text-violet-700",
  },
  {
    title: "مناسب للجوال والكمبيوتر",
    body: "واجهة مرنة تعمل بسلاسة من المكتب أو أثناء الحركة.",
    icon: MonitorSmartphone,
    tone: "bg-sky-50 text-sky-700",
  },
  {
    title: "موثوق وآمن",
    body: "صلاحيات واضحة وسجل نشاط يحفظ ثقة فريقك.",
    icon: ShieldCheck,
    tone: "bg-emerald-50 text-emerald-700",
  },
];

const stats = [
  { value: "1,250+", label: "محادثة هذا الأسبوع", icon: MessageCircle },
  { value: "96%", label: "رضا العملاء", icon: CheckCircle2 },
  { value: "2.5 دقيقة", label: "متوسط الرد", icon: Clock3 },
  { value: "18%", label: "نمو في المتابعة", icon: TrendingUp },
];

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <a href="/" className="flex items-center gap-3" aria-label="وصال ون">
      <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#053269] via-[#075bd8] to-[#25c6b8] shadow-[0_16px_34px_rgba(7,91,216,.2)]">
        <span className="absolute -start-3 top-3 flex flex-col gap-1">
          <span className="h-1 w-4 rounded-full bg-[#39d8cf]" />
          <span className="h-1 w-7 rounded-full bg-[#39d8cf]" />
          <span className="h-1 w-5 rounded-full bg-[#39d8cf]" />
        </span>
        <span className="text-2xl font-black italic text-white">W</span>
      </span>
      {!compact ? (
        <span className="leading-tight">
          <span className="block text-xl font-black tracking-tight text-[#082a55]">وصال ون</span>
          <span className="block text-sm font-semibold tracking-[0.18em] text-[#199fb0]">Wesal One</span>
        </span>
      ) : null}
    </a>
  );
}

export function LandingHero() {
  return (
    <section id="home" className="relative overflow-hidden bg-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_20%,rgba(36,198,184,.18),transparent_32%),radial-gradient(circle_at_14%_16%,rgba(7,91,216,.12),transparent_30%)]" />
      <div className="relative mx-auto grid min-h-[720px] w-[min(100%-2rem,1180px)] items-center gap-12 py-16 lg:grid-cols-[0.92fr_1.08fr] lg:py-24">
        <div className="order-2 lg:order-1">
          <DashboardMockup />
        </div>

        <div className="order-1 text-center lg:order-2 lg:text-start">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-100 bg-cyan-50 px-4 py-2 text-sm font-bold text-[#087c8a]">
            <Sparkles className="h-4 w-4" />
            منصة تواصل ذكية لتجربة عملاء أسرع
          </div>
          <h1 className="mx-auto max-w-2xl text-4xl font-black leading-[1.12] tracking-normal text-[#071f41] sm:text-5xl lg:mx-0 lg:text-6xl">
            كل محادثات عملائك في مكان واحد
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-9 text-slate-600 lg:mx-0">
            منصة موحدة لإدارة واتساب، إنستغرام، ماسنجر، وتيليجرام من لوحة تحكم واحدة، مع متابعة العملاء وتنظيم
            المحادثات بسهولة.
          </p>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
            <a
              href="/register"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#075bd8] px-7 py-4 text-base font-black text-white shadow-[0_18px_40px_rgba(7,91,216,.26)] transition hover:-translate-y-0.5 hover:bg-[#054db9]"
            >
              ابدأ مجانًا
              <ArrowLeft className="h-5 w-5" />
            </a>
            <a
              href="#contact"
              className="inline-flex items-center justify-center rounded-xl border border-[#075bd8]/30 bg-white px-7 py-4 text-base font-black text-[#075bd8] transition hover:-translate-y-0.5 hover:bg-blue-50"
            >
              تواصل مع المبيعات
            </a>
          </div>

          <ChannelIcons />
        </div>
      </div>
    </section>
  );
}

export function ChannelIcons() {
  return (
    <div className="mt-10 flex flex-wrap justify-center gap-4 lg:justify-start" aria-label="القنوات المدعومة">
      {channels.map((channel, index) => {
        const Icon = channel.icon;
        return (
          <div
            key={channel.name}
            className="wesal-channel-float flex items-center gap-2 rounded-2xl border border-white bg-white/88 px-4 py-3 shadow-[0_16px_36px_rgba(7,31,65,.12)] backdrop-blur"
            style={{ animationDelay: `${index * 180}ms` }}
          >
            <span className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${channel.className} text-white`}>
              <Icon className="h-5 w-5" />
            </span>
            <span className="text-sm font-bold text-slate-700">{channel.name}</span>
          </div>
        );
      })}
    </div>
  );
}

export function DashboardMockup() {
  return (
    <div className="relative mx-auto max-w-[680px]">
      <FloatingMessage className="-start-5 top-9 hidden md:block" delay="0ms" name="عميل جديد" text="أحتاج تفاصيل الخدمة" />
      <FloatingMessage className="-end-3 bottom-24 hidden md:block" delay="650ms" name="متابعة" text="تم تحويلها للمسؤول" />

      <div className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(7,31,65,.16)]">
        <div className="grid min-h-[430px] grid-cols-[86px_1fr] sm:grid-cols-[120px_1fr]">
          <aside className="bg-[#072b55] p-4 text-white">
            <BrandLogo compact />
            <div className="mt-8 space-y-3">
              {["المحادثات", "العملاء", "المهام", "التقارير", "الإعدادات"].map((item, index) => (
                <div
                  key={item}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${
                    index === 0 ? "bg-[#075bd8]" : "text-blue-100/80"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-[#35d1c5]" />
                  <span className="hidden sm:inline">{item}</span>
                </div>
              ))}
            </div>
            <div className="mt-16 hidden sm:block">
              <p className="mb-2 text-xs text-blue-100/70">فريق العمل</p>
              <div className="flex -space-x-2 space-x-reverse">
                {[1, 2, 3, 4].map((item) => (
                  <span key={item} className="grid h-8 w-8 place-items-center rounded-full border-2 border-[#072b55] bg-[#e8f4ff] text-xs font-black text-[#075bd8]">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </aside>

          <div className="grid bg-[#f8fbff] lg:grid-cols-[1fr_0.9fr_0.8fr]">
            <section className="border-e border-slate-200 bg-white p-4">
              <div className="mb-4 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-400">
                <Search className="h-4 w-4" />
                بحث في المحادثات
              </div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-black text-[#082a55]">المحادثات</h3>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">24 جديد</span>
              </div>
              <div className="space-y-3">
                {conversations.map((item, index) => (
                  <div key={item.name} className="wesal-message-enter flex gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm" style={{ animationDelay: `${index * 220}ms` }}>
                    <span className={`mt-1 h-3 w-3 rounded-full ${item.color}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-black text-slate-800">{item.name}</p>
                        <span className="text-[11px] text-slate-400">{item.time}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500">{item.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="hidden p-4 md:block">
              <div className="mb-4 flex items-center justify-between rounded-2xl bg-white p-3 shadow-sm">
                <div>
                  <p className="text-sm font-black text-[#082a55]">سارة القحطاني</p>
                  <p className="text-xs text-emerald-600">WhatsApp</p>
                </div>
                <Bell className="h-5 w-5 text-slate-400" />
              </div>
              <div className="space-y-4">
                <Bubble side="in">أريد معرفة توفر المنتج وطريقة الشحن</Bubble>
                <Bubble side="out">أهلًا سارة، المنتج متوفر ويمكن شحنه خلال يومين.</Bubble>
                <Bubble side="in">ممتاز، كم رسوم التوصيل؟</Bubble>
              </div>
              <div className="mt-8 flex items-center gap-2 rounded-2xl bg-white p-3 shadow-sm">
                <span className="flex-1 text-xs text-slate-400">اكتب رسالة...</span>
                <Send className="h-5 w-5 text-[#075bd8]" />
              </div>
            </section>

            <section className="hidden border-s border-slate-200 bg-white p-4 lg:block">
              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="عملاء جديدة" value="24" />
                <MiniStat label="رسائل الأسبوع" value="1,250" />
                <MiniStat label="وقت الرد" value="2.5 د" />
                <MiniStat label="الرضا" value="96%" />
              </div>
              <div className="mt-5 rounded-2xl border border-slate-100 p-4">
                <p className="mb-4 text-sm font-black text-[#082a55]">المهام</p>
                {["متابعة طلب سارة", "رد على استفسار محمد", "تأكيد موعد الشحن"].map((task) => (
                  <div key={task} className="mb-3 flex items-center gap-2 text-xs text-slate-600">
                    <CheckCircle2 className="h-4 w-4 text-[#25b8a9]" />
                    {task}
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-2xl bg-blue-50 p-4">
                <p className="text-sm font-black text-[#075bd8]">نمو المحادثات</p>
                <div className="mt-4 flex h-20 items-end gap-2">
                  {[35, 46, 38, 58, 52, 78, 65].map((height, index) => (
                    <span key={index} className="flex-1 rounded-t-lg bg-gradient-to-t from-[#075bd8] to-[#35d1c5]" style={{ height: `${height}%` }} />
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function FloatingMessage({ className, delay, name, text }: { className: string; delay: string; name: string; text: string }) {
  return (
    <div className={`wesal-float-card absolute z-20 w-56 rounded-2xl border border-white bg-white/90 p-4 shadow-[0_18px_45px_rgba(7,31,65,.16)] backdrop-blur ${className}`} style={{ animationDelay: delay }}>
      <p className="text-xs font-bold text-[#075bd8]">{name}</p>
      <p className="mt-1 text-sm font-semibold text-slate-700">{text}</p>
    </div>
  );
}

function Bubble({ children, side }: { children: ReactNode; side: "in" | "out" }) {
  return (
    <div className={`max-w-[85%] rounded-2xl p-3 text-sm leading-6 ${side === "out" ? "me-auto bg-[#dbf7e8] text-[#164d36]" : "bg-white text-slate-700 shadow-sm"}`}>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
      <p className="text-lg font-black text-[#082a55]">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

export function FeatureCards() {
  return (
    <section id="features" className="bg-[#f7fbff] py-14">
      <div className="mx-auto w-[min(100%-2rem,1180px)]">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <article key={feature.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_16px_38px_rgba(7,31,65,.07)] transition hover:-translate-y-1 hover:shadow-[0_22px_55px_rgba(7,31,65,.1)]">
                <span className={`mb-5 grid h-12 w-12 place-items-center rounded-2xl ${feature.tone}`}>
                  <Icon className="h-6 w-6" />
                </span>
                <h2 className="text-xl font-black text-[#082a55]">{feature.title}</h2>
                <p className="mt-3 leading-7 text-slate-600">{feature.body}</p>
                <a href="/register" className="mt-5 inline-flex items-center gap-2 text-sm font-black text-[#075bd8]">
                  اعرف المزيد
                  <ArrowLeft className="h-4 w-4" />
                </a>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function StatsSection() {
  return (
    <section className="bg-white py-10">
      <div className="mx-auto grid w-[min(100%-2rem,1180px)] gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(7,31,65,.08)] sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="flex items-center gap-4 rounded-2xl bg-[#f8fbff] p-4">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-[#075bd8]">
                <Icon className="h-6 w-6" />
              </span>
              <div>
                <p className="text-2xl font-black text-[#075bd8]">{stat.value}</p>
                <p className="text-sm font-semibold text-slate-600">{stat.label}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function HowItWorks() {
  const steps = [
    { title: "اربط قنواتك", body: "وصّل واتساب، إنستغرام، ماسنجر وتيليجرام بخطوات بسيطة.", icon: Link2 },
    { title: "نظّم المحادثات", body: "استخدم الوسوم، المهام، والملاحظات لتنسيق عمل الفريق.", icon: ClipboardCheck },
    { title: "نمّ نشاطك", body: "تابع الأداء وحسّن سرعة الرد وتجربة العملاء يومًا بعد يوم.", icon: TrendingUp },
  ];

  return (
    <section id="how" className="bg-[#f7fbff] py-16">
      <div className="mx-auto w-[min(100%-2rem,1180px)] text-center">
        <h2 className="text-3xl font-black text-[#082a55]">كيف يعمل وصال ون؟</h2>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className="relative rounded-2xl border border-slate-200 bg-white p-6 text-start shadow-[0_16px_38px_rgba(7,31,65,.07)]">
                <span className="absolute -top-4 end-6 grid h-9 w-9 place-items-center rounded-full bg-[#075bd8] text-sm font-black text-white">{index + 1}</span>
                <span className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#075bd8] to-[#28c6b8] text-white">
                  <Icon className="h-7 w-7" />
                </span>
                <h3 className="text-xl font-black text-[#082a55]">{step.title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{step.body}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function Testimonials() {
  const items = [
    {
      quote: "وصال ون رتّب الرسائل وخفف ضياع العملاء. صار الفريق يعرف من المسؤول عن كل محادثة.",
      name: "خالد العنسي",
      role: "مؤسس متجر محلي",
    },
    {
      quote: "أكثر ما أعجبنا أن لوحة التحكم واضحة، والردود والمتابعات صارت أسهل بكثير.",
      name: "نورة القحطاني",
      role: "مديرة عمليات",
    },
  ];

  return (
    <section id="testimonials" className="bg-white py-16">
      <div className="mx-auto w-[min(100%-2rem,980px)] text-center">
        <h2 className="text-3xl font-black text-[#082a55]">ماذا يقول عملاؤنا؟</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {items.map((item) => (
            <article key={item.name} className="rounded-3xl border border-slate-200 bg-white p-7 text-start shadow-[0_16px_38px_rgba(7,31,65,.07)]">
              <span className="mb-4 grid h-11 w-11 place-items-center rounded-2xl bg-blue-50 text-[#075bd8]">
                <Sparkles className="h-5 w-5" />
              </span>
              <p className="leading-8 text-slate-700">"{item.quote}"</p>
              <div className="mt-6 flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-[#075bd8] to-[#28c6b8] font-black text-white">
                  {item.name.slice(0, 1)}
                </span>
                <div>
                  <p className="font-black text-[#082a55]">{item.name}</p>
                  <p className="text-sm text-slate-500">{item.role}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCTA() {
  return (
    <section className="bg-[#f7fbff] px-4 py-14">
      <div className="mx-auto overflow-hidden rounded-[28px] bg-[#062b55] p-8 text-center text-white shadow-[0_24px_65px_rgba(6,43,85,.22)] md:p-12 lg:max-w-[1180px]">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-3xl font-black md:text-4xl">ابدأ اليوم مع وصال ون</h2>
          <p className="mt-4 leading-8 text-blue-100">واجهة احترافية لإدارة المحادثات وتنمية نشاطك من مكان واحد.</p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <a href="/register" className="rounded-xl bg-[#27c9bd] px-7 py-4 font-black text-[#052c55] transition hover:-translate-y-0.5 hover:bg-[#31ded1]">
              ابدأ الآن
            </a>
            <a href="#contact" className="rounded-xl border border-white/30 px-7 py-4 font-black text-white transition hover:-translate-y-0.5 hover:bg-white/10">
              اطلب تجربة
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer id="contact" className="bg-[#051d3a] py-10 text-white">
      <div className="mx-auto grid w-[min(100%-2rem,1180px)] gap-8 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
        <div>
          <BrandLogo />
          <p className="mt-4 max-w-sm leading-7 text-blue-100">وصال ون يجمع محادثات عملائك في لوحة واحدة، واضحة وسريعة وآمنة.</p>
        </div>
        <FooterColumn title="المنتج" links={["المزايا", "القنوات", "التقارير", "الأمان"]} />
        <FooterColumn title="الشركة" links={["من نحن", "المدونة", "الشركاء", "الوظائف"]} />
        <FooterColumn title="تواصل معنا" links={["hello@wesal.one", "+966 55 123 4567", "الدعم", "المبيعات"]} />
      </div>
      <div className="mx-auto mt-8 flex w-[min(100%-2rem,1180px)] flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 text-sm text-blue-100 md:flex-row">
        <span>© 2026 وصال ون. جميع الحقوق محفوظة.</span>
        <span className="tracking-[0.35em]">wesal.one</span>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <h3 className="font-black">{title}</h3>
      <ul className="mt-4 space-y-3 text-sm text-blue-100">
        {links.map((link) => (
          <li key={link}>
            <a href="#home" className="transition hover:text-white">
              {link}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
