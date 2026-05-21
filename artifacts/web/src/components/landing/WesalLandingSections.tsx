import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Link2,
  MessageCircle,
  MonitorSmartphone,
  Search,
  Send,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { FaFacebookMessenger, FaInstagram, FaTelegram, FaWhatsapp } from "react-icons/fa6";

type IconType = ComponentType<{ className?: string }>;

const channels: Array<{ name: string; icon: IconType; className: string }> = [
  { name: "Telegram", icon: FaTelegram, className: "from-[#37aee2] to-[#168ac2]" },
  { name: "Messenger", icon: FaFacebookMessenger, className: "from-[#00b2ff] to-[#006aff]" },
  { name: "Instagram", icon: FaInstagram, className: "from-[#ff8a00] via-[#e1306c] to-[#405de6]" },
  { name: "WhatsApp", icon: FaWhatsapp, className: "from-[#27d366] to-[#12a84d]" },
];

const conversations = [
  { name: "سارة القحطاني", text: "أريد معرفة توفر المنتج وطريقة الشحن", time: "11:42", dot: "bg-emerald-500" },
  { name: "محمد العنسي", text: "هل العرض لا يزال متاحاً؟", time: "11:36", dot: "bg-blue-500" },
  { name: "نورة عبدالله", text: "أحتاج تفاصيل الطلب الأخير", time: "11:24", dot: "bg-pink-500" },
  { name: "خالد اليافعي", text: "تم الاستلام، شكراً لكم", time: "11:08", dot: "bg-sky-500" },
];

const stripFeatures = [
  { title: "صندوق وارد موحد", text: "اجمع كل الرسائل في مكان واحد", icon: MessageCircle },
  { title: "رد أسرع", text: "قلّل وقت الرد وحسّن محادثاتك", icon: Zap },
  { title: "متابعة منظمة", text: "لا تنسى أي عميل أو فرصة بيع", icon: CheckCircle2 },
  { title: "تقارير ذكية", text: "بيانات واضحة لاتخاذ قرارات أفضل", icon: BarChart3 },
];

const detailFeatures = [
  { title: "صندوق محادثات موحد", text: "اجمع رسائل واتساب وإنستغرام وماسنجر وتيليجرام في لوحة واحدة.", icon: MessageCircle, tone: "text-teal-600 bg-teal-50" },
  { title: "تنظيم ومتابعة", text: "وسوم، ملاحظات داخلية، مهام وتنبيهات تمنع ضياع أي عميل.", icon: ClipboardCheck, tone: "text-blue-700 bg-blue-50" },
  { title: "تقارير ورؤى", text: "راقب أداء فريقك، سرعة الرد، ونمو المحادثات والمبيعات.", icon: BarChart3, tone: "text-violet-700 bg-violet-50" },
  { title: "مناسب للجوال والكمبيوتر", text: "تابع أعمالك من أي مكان عبر واجهة سريعة ومتجاوبة.", icon: MonitorSmartphone, tone: "text-sky-700 bg-sky-50" },
];

const stats = [
  { value: "1,250+", label: "محادثة تمت إدارتها هذا الأسبوع", icon: MessageCircle },
  { value: "96%", label: "رضا العملاء حسب التقييمات", icon: CheckCircle2 },
  { value: "2.5 دقيقة", label: "متوسط الرد على الرسائل", icon: Clock3 },
  { value: "18%", label: "زيادة في المتابعة خلال 30 يوماً", icon: TrendingUp },
];

const footerGroups = [
  { title: "المنتج", links: ["المزايا", "التقارير", "القنوات", "التكاملات"] },
  { title: "الشركة", links: ["من نحن", "المدونة", "الشركاء", "الوظائف"] },
  { title: "الدعم", links: ["مركز المساعدة", "سياسة الخصوصية", "الشروط والأحكام", "تواصل معنا"] },
];

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <a href="/" className="flex items-center gap-3.5" aria-label="وصال ون">
      <LogoMark className={compact ? "h-10 w-16" : "h-14 w-20"} />
      {!compact ? (
        <span className="leading-tight">
          <span className="block text-2xl font-black text-[#1B3A5C]">وصال ون</span>
          <span className="block text-sm font-semibold tracking-[0.18em] text-slate-500">Wesal One</span>
        </span>
      ) : null}
    </a>
  );
}

function LogoMark({ className = "h-12 w-16" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 106 66" role="img" aria-label="Wesal One W">
      <defs>
        <linearGradient id="wesal-wing-a" x1="12" x2="82" y1="52" y2="5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#083E93" />
          <stop offset=".48" stopColor="#0B6FE8" />
          <stop offset="1" stopColor="#22D0C0" />
        </linearGradient>
        <linearGradient id="wesal-wing-b" x1="24" x2="78" y1="58" y2="8" gradientUnits="userSpaceOnUse">
          <stop stopColor="#062B65" />
          <stop offset=".56" stopColor="#065BD8" />
          <stop offset="1" stopColor="#1FB6A6" />
        </linearGradient>
      </defs>
      <g fill="none" strokeLinecap="round">
        <path d="M8 21h22" stroke="#38D8CF" strokeWidth="6" />
        <path d="M2 32h32" stroke="#38D8CF" strokeWidth="6" />
        <path d="M10 43h23" stroke="#38D8CF" strokeWidth="6" />
        <path d="M0 11h12" stroke="#38D8CF" strokeWidth="6" />
      </g>
      <path
        d="M23 16c7 19 14 32 22 37 6-10 13-23 21-39 7-4 16-6 26-7-8 18-19 36-32 54-8 1-15-1-21-6-8-7-15-19-22-37 2-2 4-2 6-2Z"
        fill="url(#wesal-wing-a)"
      />
      <path
        d="M45 53c8-18 20-33 36-45-3 11-9 24-18 39-5 8-11 12-18 6Z"
        fill="url(#wesal-wing-b)"
        opacity=".95"
      />
      <path
        d="M55 44c10-11 18-20 25-29M60 50c9-8 16-16 21-24M50 38c8-8 15-15 21-21"
        stroke="#8CEBE5"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity=".65"
      />
      <path
        d="M23 16c7 19 14 32 22 37 5-8 11-19 18-32"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3"
        strokeLinecap="round"
        opacity=".55"
      />
    </svg>
  );
}

export function LandingHero() {
  return (
    <section id="home" className="relative overflow-hidden bg-[#f8fbff] pt-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_31%_35%,rgba(31,182,166,.22),transparent_30%),radial-gradient(circle_at_72%_38%,rgba(11,111,232,.16),transparent_34%),linear-gradient(180deg,#ffffff_0%,#f3f9ff_100%)]" />
      <div className="pointer-events-none absolute left-1/2 top-24 h-[520px] w-[520px] -translate-x-1/2 rounded-full border border-[#d9ecff] bg-white/35 blur-[1px]" />
      <div className="relative mx-auto grid w-[min(100%-2rem,1240px)] items-center gap-12 pb-16 pt-10 lg:grid-cols-[1.16fr_.84fr]">
        <div className="order-2 lg:order-1">
          <DashboardMockup variant="hero" />
        </div>

        <div className="order-1 text-center lg:order-2 lg:text-start">
          <h1 className="mx-auto max-w-[500px] text-4xl font-black leading-[1.1] text-[#102A4A] sm:text-5xl lg:mx-0 lg:text-[3.75rem]">
            كل محادثات عملائك في مكان واحد
          </h1>
          <p className="mx-auto mt-6 max-w-[500px] text-lg leading-9 text-slate-600 lg:mx-0">
            منصة موحدة لإدارة واتساب، إنستغرام، ماسنجر، وتيليجرام من لوحة تحكم واحدة.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
            <a href="/register" className="rounded-xl bg-[#0B6FE8] px-8 py-4 text-base font-black text-white shadow-[0_18px_42px_rgba(11,111,232,.28)] transition hover:-translate-y-1 hover:bg-[#075dcc]">
              ابدأ مجانًا
            </a>
            <a href="#contact" className="rounded-xl border border-[#0B6FE8]/40 bg-white px-8 py-4 text-base font-black text-[#0B6FE8] shadow-sm transition hover:-translate-y-1 hover:bg-blue-50">
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
    <div className="mt-9 flex flex-wrap justify-center gap-5 lg:justify-start" aria-label="القنوات المدعومة">
      {channels.map((channel, index) => {
        const Icon = channel.icon;
        return (
          <div
            key={channel.name}
            className="wesal-channel-float text-center"
            style={{ animationDelay: `${index * 180}ms` }}
            title={channel.name}
          >
            <span className={`mx-auto grid h-16 w-16 place-items-center rounded-[22px] bg-gradient-to-br ${channel.className} text-white shadow-[0_16px_34px_rgba(27,58,92,.16)]`}>
              <Icon className="h-9 w-9" />
            </span>
            <span className="mt-2 block text-xs font-black text-slate-500">{channel.name}</span>
          </div>
        );
      })}
    </div>
  );
}

export function FeatureStrip() {
  return (
    <section className="relative z-10 bg-[#f7fbff] pb-8 pt-5">
      <div className="mx-auto grid w-[min(100%-2rem,1180px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_45px_rgba(27,58,92,.08)] md:grid-cols-4">
        {stripFeatures.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.title} className="flex items-center gap-4 border-slate-100 p-5 md:border-s">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-[#0B6FE8]">
                <Icon className="h-6 w-6" />
              </span>
              <div>
                <h2 className="font-black text-[#1B3A5C]">{item.title}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">{item.text}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function FeatureCards() {
  return (
    <section id="features" className="bg-white py-10">
      <div className="mx-auto grid w-[min(100%-2rem,1180px)] gap-5 md:grid-cols-2 lg:grid-cols-4">
        {detailFeatures.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <article key={feature.title} className="wesal-reveal-static rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_38px_rgba(27,58,92,.07)] transition hover:-translate-y-1" style={{ animationDelay: `${index * 90}ms` }}>
              <span className={`mb-5 grid h-14 w-14 place-items-center rounded-2xl ${feature.tone}`}>
                <Icon className="h-7 w-7" />
              </span>
              <h3 className="text-lg font-black text-[#1B3A5C]">{feature.title}</h3>
              <p className="mt-3 min-h-20 text-sm leading-7 text-slate-600">{feature.text}</p>
              <a href="#how" className="mt-4 inline-flex items-center gap-2 text-sm font-black text-[#0B6FE8]">
                اعرف المزيد
                <ArrowLeft className="h-4 w-4" />
              </a>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ProductShowcase() {
  return (
    <section className="bg-white py-6">
      <div className="mx-auto grid w-[min(100%-2rem,1180px)] items-center gap-8 lg:grid-cols-[.78fr_1.22fr]">
        <div className="text-center lg:text-start">
          <h2 className="text-3xl font-black leading-[1.25] text-[#1B3A5C] md:text-4xl">
            إدارة احترافية لتجربة عملاء استثنائية
          </h2>
          <p className="mt-5 leading-8 text-slate-600">
            لوحة تحكم متكاملة تمنحك رؤية شاملة وتحكم كامل في محادثات عملائك وفريقك.
          </p>
          <ul className="mx-auto mt-7 max-w-md space-y-4 text-start lg:mx-0">
            {["واجهة عربية سهلة الاستخدام", "تحديثات فورية وتنبيهات ذكية", "أمان وخصوصية على أعلى مستوى"].map((item) => (
              <li key={item} className="flex items-center gap-3 text-slate-700">
                <CheckCircle2 className="h-5 w-5 text-[#1FB6A6]" />
                <span className="font-semibold">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <div className="mx-auto max-w-[760px]">
            <LaptopFrame>
              <DashboardMockup variant="compact" />
            </LaptopFrame>
          </div>
          <PhoneMockup />
        </div>
      </div>
    </section>
  );
}

export function StatsSection() {
  return (
    <section className="bg-white py-7">
      <div className="mx-auto grid w-[min(100%-2rem,1180px)] gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_15px_45px_rgba(27,58,92,.08)] sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.value} className="flex items-center justify-center gap-4 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-[#0B6FE8]">
                <Icon className="h-7 w-7" />
              </span>
              <div className="text-start">
                <p className="text-2xl font-black text-[#0B6FE8]">{stat.value}</p>
                <p className="max-w-36 text-sm font-semibold leading-6 text-slate-600">{stat.label}</p>
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
    { title: "اربط قنواتك", text: "اربط واتساب، إنستغرام، ماسنجر وتيليجرام بخطوات بسيطة وآمنة.", icon: Link2 },
    { title: "نظّم المحادثات", text: "استخدم الوسوم، المهام والملاحظات لتنظيم عملائك وفريقك.", icon: ClipboardCheck },
    { title: "نمّ نشاطك", text: "حسّن سرعة الرد، تابع الأداء، وزد مبيعاتك بثقة.", icon: TrendingUp },
  ];

  return (
    <section id="how" className="bg-[#f7fbff] py-12">
      <div className="mx-auto w-[min(100%-2rem,1180px)] text-center">
        <h2 className="text-3xl font-black text-[#1B3A5C]">كيف يعمل وصال ون؟</h2>
        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className="rounded-2xl border border-slate-200 bg-white p-5 text-start shadow-[0_14px_38px_rgba(27,58,92,.07)]">
                <div className="flex items-center gap-4">
                  <span className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-[#0B6FE8] to-[#1FB6A6] text-white shadow-[0_14px_34px_rgba(11,111,232,.24)]">
                    <Icon className="h-8 w-8" />
                  </span>
                  <div>
                    <h3 className="text-xl font-black text-[#1B3A5C]">{step.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-600">{step.text}</p>
                  </div>
                </div>
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
      quote: "وصال ون سهّل علينا متابعة الطلبات وردود العملاء في مكان واحد، وفريقنا صار أوضح في توزيع المسؤوليات.",
      name: "خالد العنسي",
      role: "مؤسس متجر إلكتروني",
    },
    {
      quote: "رتّب الرسائل وخفف ضياع المحادثات. الآن نعرف كل عميل في أي مرحلة بدون سؤال الفريق.",
      name: "نورة القحطاني",
      role: "مديرة تجربة العملاء",
    },
  ];

  return (
    <section id="testimonials" className="bg-[#f7fbff] py-8">
      <div className="mx-auto w-[min(100%-2rem,1080px)] text-center">
        <h2 className="text-3xl font-black text-[#1B3A5C]">ماذا يقول عملاؤنا؟</h2>
        <div className="mt-7 flex items-center gap-4">
          <button className="hidden h-10 w-10 shrink-0 rounded-full border border-slate-200 bg-white text-[#1B3A5C] shadow-sm md:grid md:place-items-center" aria-label="السابق">
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="grid flex-1 gap-5 md:grid-cols-2">
            {items.map((item) => (
              <article key={item.name} className="rounded-2xl border border-slate-200 bg-white p-6 text-start shadow-[0_14px_38px_rgba(27,58,92,.07)]">
                <p className="text-4xl font-black text-[#0B6FE8]">“</p>
                <p className="mt-1 min-h-24 leading-8 text-slate-700">{item.quote}</p>
                <div className="mt-5 flex items-center gap-3">
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-[#0B6FE8] to-[#1FB6A6] font-black text-white">
                    {item.name.slice(0, 1)}
                  </span>
                  <div>
                    <p className="font-black text-[#1B3A5C]">{item.name}</p>
                    <p className="text-sm text-slate-500">{item.role}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <button className="hidden h-10 w-10 shrink-0 rounded-full border border-slate-200 bg-white text-[#1B3A5C] shadow-sm md:grid md:place-items-center" aria-label="التالي">
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>
      </div>
    </section>
  );
}

export function FinalCTA() {
  return (
    <section className="bg-[#f7fbff] px-4 py-8">
      <div className="mx-auto max-w-[1180px] overflow-hidden rounded-3xl bg-[#07315d] px-6 py-9 text-center text-white shadow-[0_22px_60px_rgba(7,49,93,.22)]">
        <div className="absolute" />
        <h2 className="text-3xl font-black">ابدأ اليوم مع وصال ون</h2>
        <p className="mt-3 text-blue-100">واجهة احترافية لإدارة المحادثات وتنمية نشاطك.</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <a href="/register" className="rounded-xl bg-[#1FB6A6] px-10 py-3.5 font-black text-white transition hover:-translate-y-1 hover:bg-[#19a395]">
            ابدأ الآن
          </a>
          <a href="#contact" className="rounded-xl border border-white/30 px-10 py-3.5 font-black text-white transition hover:-translate-y-1 hover:bg-white/10">
            اطلب تجربة
          </a>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer id="contact" className="bg-[#061f3d] py-10 text-white">
      <div className="mx-auto grid w-[min(100%-2rem,1180px)] gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr_1.1fr]">
        <div>
          <BrandLogo />
          <p className="mt-4 max-w-sm leading-7 text-blue-100">وصال ون يجمع قنوات التواصل في لوحة واحدة لفريق أسرع وتجربة عميل أفضل.</p>
          <p className="mt-4 text-sm tracking-[0.35em] text-blue-100">wesal.one</p>
        </div>
        {footerGroups.map((group) => (
          <FooterColumn key={group.title} title={group.title} links={group.links} />
        ))}
        <div>
          <h3 className="font-black">تواصل معنا</h3>
          <ul className="mt-4 space-y-3 text-sm text-blue-100">
            <li>hello@wesal.one</li>
            <li>+966 55 123 4567</li>
            <li className="flex gap-3 pt-2">
              {["x", "in", "yt", "ig"].map((item) => (
                <span key={item} className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-xs font-black">
                  {item}
                </span>
              ))}
            </li>
          </ul>
        </div>
      </div>
      <p className="mx-auto mt-8 w-[min(100%-2rem,1180px)] border-t border-white/10 pt-5 text-center text-sm text-blue-100">
        © 2026 وصال ون. جميع الحقوق محفوظة.
      </p>
    </footer>
  );
}

export function DashboardMockup({ variant = "hero" }: { variant?: "hero" | "compact" }) {
  const isCompact = variant === "compact";
  return (
    <div className={`relative mx-auto ${isCompact ? "h-[330px]" : "max-w-[780px]"}`}>
      {!isCompact ? (
        <>
          <FloatingCard className="-start-8 top-12" title="طلب جديد" body="تم إسناده إلى فريق الدعم" />
          <FloatingCard className="-end-8 bottom-24" title="متابعة" body="موعد الرد خلال 2.5 دقيقة" />
        </>
      ) : null}
      <div className={`overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(27,58,92,.16)] ${isCompact ? "h-[330px]" : "h-[462px]"}`}>
      <div className="grid h-full grid-cols-[104px_1fr] sm:grid-cols-[140px_1fr]">
        <aside className="bg-[#092a4d] p-4 text-white">
          <BrandLogo compact />
          <div className="mt-8 space-y-3">
            {["المحادثات", "العملاء", "المهام", "التقارير", "الإعدادات"].map((item, index) => (
              <div key={item} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${index === 0 ? "bg-[#0B6FE8]" : "text-blue-100/80"}`}>
                <span className="h-2 w-2 rounded-full bg-[#1FB6A6]" />
                <span className="hidden sm:inline">{item}</span>
              </div>
            ))}
          </div>
        </aside>
        <div className="grid bg-[#f8fbff] md:grid-cols-[1fr_1fr] lg:grid-cols-[1fr_1fr_.78fr]">
          <section className="border-e border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-400">
              <Search className="h-4 w-4" />
              بحث في المحادثات
            </div>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-black text-[#1B3A5C]">المحادثات</h3>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-[#0B6FE8]">24 جديد</span>
            </div>
            <div className="space-y-3">
              {conversations.map((item, index) => (
                <div key={item.name} className="wesal-message-enter flex gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm" style={{ animationDelay: `${index * 220}ms` }}>
                  <span className={`mt-1 h-3 w-3 rounded-full ${item.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2">
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
            <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-sm font-black text-[#1B3A5C]">سارة القحطاني</p>
              <p className="text-xs text-emerald-600">WhatsApp</p>
            </div>
            <div className="space-y-4">
              <Bubble>أريد معرفة توفر المنتج وطريقة الشحن</Bubble>
              <Bubble out>أهلًا سارة، المنتج متوفر ويمكن شحنه خلال يومين.</Bubble>
              <Bubble>ممتاز، أرسلي التفاصيل.</Bubble>
            </div>
            <div className="mt-7 flex items-center gap-2 rounded-2xl bg-white p-3 shadow-sm">
              <span className="flex-1 text-xs text-slate-400">اكتب رسالة...</span>
              <Send className="h-5 w-5 text-[#0B6FE8]" />
            </div>
          </section>

          <section className="hidden border-s border-slate-200 bg-white p-4 lg:block">
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="رسائل" value="1,250" />
              <MiniStat label="عملاء" value="24" />
              <MiniStat label="وقت الرد" value="2.5 د" />
              <MiniStat label="الرضا" value="96%" />
            </div>
            <div className="mt-5 rounded-2xl border border-slate-100 p-4">
              <p className="mb-4 text-sm font-black text-[#1B3A5C]">المهام</p>
              {["متابعة طلب سارة", "تأكيد شحنة محمد", "رد على استفسار نورة"].map((task) => (
                <div key={task} className="mb-3 flex items-center gap-2 text-xs text-slate-600">
                  <CheckCircle2 className="h-4 w-4 text-[#1FB6A6]" />
                  {task}
                </div>
              ))}
            </div>
            <ChartBars />
          </section>
        </div>
      </div>
      </div>
    </div>
  );
}

function LaptopFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative pb-7">
      <div className="rounded-t-[22px] border-[10px] border-[#172436] bg-[#172436] shadow-[0_22px_60px_rgba(27,58,92,.18)]">
        {children}
      </div>
      <div className="mx-auto h-5 w-[82%] rounded-b-[50%] bg-gradient-to-b from-slate-300 to-slate-500" />
    </div>
  );
}

function PhoneMockup() {
  return (
    <div className="absolute -bottom-2 -end-2 hidden w-[170px] rounded-[30px] border-[8px] border-[#111827] bg-white p-3 shadow-[0_22px_45px_rgba(15,23,42,.18)] md:block">
      <div className="mx-auto mb-3 h-4 w-16 rounded-full bg-[#111827]" />
      <h3 className="mb-3 text-center text-sm font-black text-[#1B3A5C]">المحادثات</h3>
      <div className="space-y-3">
        {conversations.slice(0, 4).map((item) => (
          <div key={item.name} className="flex gap-2">
            <span className={`mt-1 h-3 w-3 rounded-full ${item.dot}`} />
            <div className="min-w-0">
              <p className="truncate text-xs font-black text-slate-800">{item.name}</p>
              <p className="truncate text-[10px] text-slate-500">{item.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FloatingCard({ className, title, body }: { className: string; title: string; body: string }) {
  return (
    <div className={`wesal-float-card absolute z-20 hidden w-52 rounded-2xl border border-white bg-white/92 p-4 shadow-[0_18px_45px_rgba(27,58,92,.16)] backdrop-blur md:block ${className}`}>
      <p className="text-xs font-black text-[#0B6FE8]">{title}</p>
      <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{body}</p>
    </div>
  );
}

function Bubble({ children, out = false }: { children: ReactNode; out?: boolean }) {
  return (
    <div className={`max-w-[86%] rounded-2xl p-3 text-sm leading-6 ${out ? "me-auto bg-[#dcf7e9] text-[#14533b]" : "bg-white text-slate-700 shadow-sm"}`}>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
      <p className="text-lg font-black text-[#1B3A5C]">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

function ChartBars() {
  return (
    <div className="mt-5 rounded-2xl bg-blue-50 p-4">
      <p className="text-sm font-black text-[#0B6FE8]">المحادثات خلال 7 أيام</p>
      <div className="mt-4 flex h-20 items-end gap-2">
        {[35, 46, 38, 58, 52, 78, 65].map((height, index) => (
          <span key={index} className="flex-1 rounded-t-lg bg-gradient-to-t from-[#0B6FE8] to-[#1FB6A6]" style={{ height: `${height}%` }} />
        ))}
      </div>
    </div>
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
