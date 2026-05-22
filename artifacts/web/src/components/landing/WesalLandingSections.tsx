import { useEffect, useRef, useState } from "react";
import type { ComponentType, MouseEvent, ReactNode } from "react";
import {
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  MessageCircle,
  MonitorSmartphone,
  Search,
  Send,
  Share2,
  Moon,
  Sun,
  TrendingUp,
  Zap,
} from "lucide-react";
import { FaFacebookMessenger, FaInstagram, FaTelegram, FaWhatsapp } from "react-icons/fa6";

type IconType = ComponentType<{ className?: string }>;
export type LandingTheme = "light" | "dark";

const channelIcons: Array<{ label: string; icon: IconType; color: string; glow: string }> = [
  { label: "WhatsApp", icon: FaWhatsapp, color: "text-[#20c75a]", glow: "rgba(32,199,90,.26)" },
  { label: "Instagram", icon: FaInstagram, color: "text-[#e1306c]", glow: "rgba(225,48,108,.25)" },
  { label: "Messenger", icon: FaFacebookMessenger, color: "text-[#1687ff]", glow: "rgba(22,135,255,.25)" },
  { label: "Telegram", icon: FaTelegram, color: "text-[#229ed9]", glow: "rgba(34,158,217,.25)" },
];

const conversations = [
  { name: "سارة القحطاني", text: "مرحباً، هل المنتج متوفر حالياً؟", time: "11:43", icon: FaWhatsapp, color: "text-[#20c75a]" },
  { name: "منى لؤي", text: "شكراً لكم، تم استلام الطلب", time: "11:40", icon: FaInstagram, color: "text-[#e1306c]" },
  { name: "محمد الشهري", text: "متى يصل المنتج للرياض؟", time: "09:50", icon: FaFacebookMessenger, color: "text-[#1687ff]" },
  { name: "نورة عبدالله", text: "هل متاح الدفع عند الاستلام؟", time: "أمس", icon: FaWhatsapp, color: "text-[#20c75a]" },
  { name: "عمر بن ناصر", text: "هل يمكن حجز موعد؟", time: "أمس", icon: FaTelegram, color: "text-[#229ed9]" },
];

const quickFeatures = [
  { title: "صندوق وارد موحد", text: "اجمع كل الرسائل في مكان واحد", icon: MessageCircle },
  { title: "رد أسرع", text: "قلّل وقت الرد وارفع رضا عملائك", icon: Zap },
  { title: "متابعة منظمة", text: "لا تفوت أي عميل أو فرصة بيع", icon: CheckCircle2 },
  { title: "تقارير ذكية", text: "بيانات واضحة لاتخاذ قرارات أفضل", icon: BarChart3 },
];

const featureCards = [
  { title: "صندوق محادثات موحد", text: "اجمع رسائل واتساب وإنستغرام وماسنجر وتيليجرام في لوحة واحدة.", icon: MessageCircle, color: "text-[#1FB6A6]" },
  { title: "تنظيم ومتابعة", text: "وسوم، ملاحظات داخلية، مهام وتنبيهات تضمن نجاح كل عميل.", icon: ClipboardCheck, color: "text-[#0b6fe8]" },
  { title: "تقارير ورؤى", text: "راقب أداء فريقك، سرعة الرد، ونمو المحادثات والمبيعات.", icon: BarChart3, color: "text-[#8b5cf6]" },
  { title: "مناسب للجوال والكمبيوتر", text: "تابع عملك من أي مكان عبر واجهة سلسة وعصرية.", icon: MonitorSmartphone, color: "text-[#38bdf8]" },
];

const stats = [
  { value: 1250, suffix: "+", title: "محادثة", text: "تمت إدارتها هذا الأسبوع", icon: MessageCircle },
  { value: 96, suffix: "%", title: "رضا العملاء", text: "حسب التقييمات", icon: CheckCircle2 },
  { value: 2.5, suffix: " دقيقة", title: "متوسط الرد", text: "على الرسائل", icon: Clock3 },
  { value: 18, suffix: "%", title: "زيادة", text: "في المبيعات خلال 30 يوماً", icon: TrendingUp },
];

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.18 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, className: visible ? "landing-inview" : "" };
}

export function BrandLogo({ compact = false, mono = false }: { compact?: boolean; mono?: boolean }) {
  return (
    <a href="/" className="flex items-center gap-3" aria-label="وصال ون">
      <LogoMark className={compact ? "h-10 w-[76px]" : "h-14 w-[104px]"} mono={mono} />
      {!compact ? (
        <span className="leading-tight">
          <span className={`block text-[1.72rem] font-black ${mono ? "text-white" : "text-[#1B3A5C]"}`}>وصال ون</span>
          <span className="block text-sm font-semibold tracking-[0.18em] text-[#1FB6A6]">Wesal One</span>
        </span>
      ) : null}
    </a>
  );
}

export function ThemeToggle({ theme, onToggle }: { theme: LandingTheme; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="landing-theme-toggle grid h-11 w-11 place-items-center rounded-full border border-[#dce8f5] bg-white text-[#1B3A5C] shadow-[0_12px_26px_rgba(27,58,92,.1)] transition hover:-translate-y-0.5"
      aria-label={theme === "dark" ? "تفعيل وضع النهار" : "تفعيل وضع الليل"}
    >
      {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

function LogoMark({ className, mono = false }: { className: string; mono?: boolean }) {
  const dark = mono ? "#ffffff" : "#1B3A5C";
  return (
    <svg className={className} viewBox="0 0 128 76" role="img" aria-label="Wesal One logo">
      <defs>
        <linearGradient id="wesalLogoMain" x1="18" x2="116" y1="66" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor={dark} />
          <stop offset=".5" stopColor="#0b6fe8" />
          <stop offset="1" stopColor="#1FB6A6" />
        </linearGradient>
        <linearGradient id="wesalLogoWing" x1="54" x2="120" y1="68" y2="5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#063580" />
          <stop offset=".58" stopColor="#0b6fe8" />
          <stop offset="1" stopColor="#22d0c2" />
        </linearGradient>
        <filter id="wesalLogoShadow" x="-15%" y="-15%" width="140%" height="140%">
          <feDropShadow dx="0" dy="5" stdDeviation="3" floodColor="#0b6fe8" floodOpacity=".18" />
        </filter>
      </defs>
      <g fill="none" stroke="#38d8cf" strokeLinecap="round" strokeWidth="6.8">
        <path d="M11 20h26" />
        <path d="M2 34h40" />
        <path d="M12 49h31" />
        <path d="M0 9h15" />
      </g>
      <g filter="url(#wesalLogoShadow)">
        <path d="M27 15c8 24 18 40 30 47 8-14 18-33 29-56 9-4 21-6 37-6-11 24-27 49-47 74-12 1-22-2-31-10-11-10-21-26-30-48 4-3 8-3 12-1Z" fill="url(#wesalLogoMain)" />
        <path d="M58 62c12-25 30-46 55-62-6 16-16 35-30 57-8 11-17 14-25 5Z" fill="url(#wesalLogoWing)" />
        <path d="M69 51c14-14 27-28 38-43M75 59c12-11 22-23 30-36M61 45c11-10 21-20 30-31" stroke="#9af4ee" strokeLinecap="round" strokeWidth="2.8" opacity=".72" />
        <path d="M31 17c8 22 17 37 26 44 7-11 15-26 24-45" fill="none" stroke="#fff" strokeLinecap="round" strokeWidth="3" opacity=".56" />
      </g>
    </svg>
  );
}

export function LandingHero() {
  const [style, setStyle] = useState<React.CSSProperties>({});

  function handleMouseMove(event: MouseEvent<HTMLElement>) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    setStyle({
      "--mx": `${x * 18}px`,
      "--my": `${y * 18}px`,
      "--rx": `${-y * 2.2}deg`,
      "--ry": `${x * 2.2}deg`,
    } as React.CSSProperties);
  }

  return (
    <section id="home" className="landing-hero relative overflow-hidden pt-7" onMouseMove={handleMouseMove} style={style}>
      <div className="landing-mesh" />
      <div className="landing-orb landing-orb-a" />
      <div className="landing-orb landing-orb-b" />
      <div className="relative mx-auto grid w-[min(100%-2rem,1240px)] grid-cols-1 items-center gap-12 pb-16 pt-9 lg:grid-cols-[1fr_1fr]">
        <div className="landing-reveal text-center lg:justify-self-end lg:text-start">
          <h1 className="mx-auto max-w-[520px] text-4xl font-black leading-[1.1] text-[#102A4A] sm:text-5xl lg:mx-0 lg:text-[3.75rem]">
            كل محادثات عملائك في مكان واحد
          </h1>
          <p className="mx-auto mt-6 max-w-[500px] text-lg leading-9 text-slate-600 lg:mx-0">
            منصة موحدة لإدارة واتساب، إنستغرام، ماسنجر، وتيليجرام من لوحة تحكم واحدة.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
            <a href="/register" className="landing-ripple rounded-xl bg-[#0B6FE8] px-8 py-4 text-base font-black text-white shadow-[0_18px_42px_rgba(11,111,232,.32)] transition hover:-translate-y-1 hover:bg-[#075dcc]">
              ابدأ مجانًا
            </a>
            <a href="#contact" className="landing-ripple rounded-xl border border-[#0b6fe8]/28 bg-white px-8 py-4 text-base font-black text-[#1B3A5C] shadow-sm transition hover:-translate-y-1">
              تواصل مع المبيعات
            </a>
          </div>
          <ChannelIcons />
        </div>
        <div className="landing-hero-depth lg:justify-self-start">
          <DashboardMockup />
        </div>
      </div>
    </section>
  );
}

function ChannelIcons() {
  return (
    <div className="mt-8 flex flex-row-reverse flex-wrap justify-center gap-6 lg:justify-end" aria-label="القنوات المدعومة">
      {channelIcons.map((channel, index) => {
        const Icon = channel.icon;
        return (
          <span
            key={channel.label}
            className="landing-channel-spin grid h-14 w-14 place-items-center rounded-full bg-white shadow-[0_14px_30px_rgba(27,58,92,.10)] ring-1 ring-[#dce8f5]"
            style={{ animationDelay: `${index * 160}ms`, "--icon-glow": channel.glow } as React.CSSProperties}
          >
            <Icon className={`h-10 w-10 ${channel.color}`} />
          </span>
        );
      })}
    </div>
  );
}

export function FeatureStrip() {
  return (
    <Section className="pb-8 pt-5">
      <div className="mx-auto grid w-[min(100%-2rem,1180px)] overflow-hidden rounded-2xl border border-[#dce8f5] bg-white/88 shadow-[0_16px_45px_rgba(27,58,92,.08)] md:grid-cols-4">
        {quickFeatures.map((item, index) => {
          const Icon = item.icon;
          return (
            <article key={item.title} className="landing-reveal flex items-center gap-4 border-[#eef3f9] p-5 md:border-s" style={{ animationDelay: `${index * 80}ms` }}>
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eef6ff] text-[#0B6FE8]">
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
    </Section>
  );
}

export function FeatureCards() {
  return (
    <Section className="py-10">
      <div className="mx-auto grid w-[min(100%-2rem,1180px)] gap-5 md:grid-cols-2 lg:grid-cols-4">
        {featureCards.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <article key={feature.title} className="landing-card-float landing-reveal rounded-2xl border border-[#dce8f5] bg-white p-6 shadow-[0_14px_38px_rgba(27,58,92,.07)] transition hover:-translate-y-2" style={{ animationDelay: `${index * 90}ms` }}>
              <span className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-[#eef6ff]">
                <Icon className={`h-7 w-7 ${feature.color}`} />
              </span>
              <h3 className="text-lg font-black text-[#1B3A5C]">{feature.title}</h3>
              <p className="mt-3 min-h-20 text-sm leading-7 text-slate-600">{feature.text}</p>
              <a href="#how" className="mt-4 inline-flex items-center gap-2 text-sm font-black text-[#0B6FE8]">اعرف المزيد</a>
            </article>
          );
        })}
      </div>
    </Section>
  );
}

export function ProductShowcase() {
  return (
    <Section className="py-8">
      <div className="mx-auto grid w-[min(100%-2rem,1180px)] items-center gap-8 lg:grid-cols-[.78fr_1.22fr]">
        <div className="landing-reveal text-center lg:text-start">
          <h2 className="text-3xl font-black leading-[1.25] text-[#1B3A5C] md:text-4xl">إدارة احترافية لتجربة عملاء استثنائية</h2>
          <p className="mt-5 leading-8 text-slate-600">لوحة تحكم متكاملة تمنحك رؤية شاملة وتحكم كامل في محادثات عملائك وفريقك.</p>
          <ul className="mx-auto mt-7 max-w-md space-y-4 text-start lg:mx-0">
            {["واجهة موحدة وسهلة الاستخدام", "تحديثات فورية وتنبيهات ذكية", "أمان وخصوصية على أعلى مستوى"].map((item) => (
              <li key={item} className="flex items-center gap-3 text-slate-700">
                <CheckCircle2 className="h-5 w-5 text-[#1FB6A6]" />
                <span className="font-semibold">{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="landing-hero-depth relative">
          <LaptopFrame>
            <DashboardMockup compact />
          </LaptopFrame>
          <PhoneMockup />
        </div>
      </div>
    </Section>
  );
}

export function StatsSection() {
  return (
    <Section className="py-7">
      <div className="mx-auto grid w-[min(100%-2rem,1180px)] gap-4 rounded-2xl border border-[#dce8f5] bg-white p-5 shadow-[0_15px_45px_rgba(27,58,92,.08)] sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <StatItem key={stat.title} stat={stat} icon={Icon} delay={index * 90} />
          );
        })}
      </div>
    </Section>
  );
}

function StatItem({ stat, icon: Icon, delay }: { stat: (typeof stats)[number]; icon: IconType; delay: number }) {
  const { ref, className } = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`landing-reveal ${className} flex items-center justify-center gap-4 text-center`} style={{ animationDelay: `${delay}ms` }}>
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#eef6ff] text-[#0B6FE8]">
        <Icon className="h-7 w-7" />
      </span>
      <div className="text-start">
        <p className="text-2xl font-black text-[#0B6FE8]">
          <CountUp target={stat.value} active={className.includes("landing-inview")} suffix={stat.suffix} />
        </p>
        <p className="font-black text-[#1B3A5C]">{stat.title}</p>
        <p className="max-w-36 text-sm leading-6 text-slate-600">{stat.text}</p>
      </div>
    </div>
  );
}

function CountUp({ target, suffix, active }: { target: number; suffix: string; active: boolean }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    let frame = 0;
    const frames = 60;
    let raf = 0;
    const tick = () => {
      frame += 1;
      const progress = 1 - Math.pow(1 - frame / frames, 3);
      setValue(Number((target * Math.min(progress, 1)).toFixed(target % 1 ? 1 : 0)));
      if (frame < frames) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target]);
  return <>{value.toLocaleString("ar")}{suffix}</>;
}

export function HowItWorks() {
  const steps = [
    { title: "اربط قنواتك", text: "اربط واتساب، إنستغرام، ماسنجر وتيليجرام بخطوات بسيطة وآمنة.", icon: Share2 },
    { title: "نظّم المحادثات", text: "استخدم الوسوم، المهام والملاحظات لتنظيم عملائك وفريقك.", icon: ClipboardCheck },
    { title: "نمّ نشاطك", text: "حسّن سرعة الرد، تابع الأداء، وزد مبيعاتك بثقة.", icon: TrendingUp },
  ];
  return (
    <Section id="how" className="py-12">
      <div className="mx-auto w-[min(100%-2rem,1180px)] text-center">
        <h2 className="text-3xl font-black text-[#1B3A5C]">كيف يعمل وصال ون؟</h2>
        <div className="landing-steps-line relative mt-8 grid gap-5 lg:grid-cols-3">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className="landing-reveal rounded-2xl border border-[#dce8f5] bg-white p-5 text-start shadow-[0_14px_38px_rgba(27,58,92,.07)]" style={{ animationDelay: `${index * 100}ms` }}>
                <div className="flex items-center gap-4">
                  <span className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-[#0B6FE8] to-[#1FB6A6] text-white">
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
    </Section>
  );
}

export function Testimonials() {
  return (
    <Section id="testimonials" className="py-8">
      <div className="mx-auto w-[min(100%-2rem,1080px)] text-center">
        <h2 className="text-3xl font-black text-[#1B3A5C]">ماذا يقول عملاؤنا؟</h2>
        <div className="mt-7 flex items-center gap-4">
          <button className="hidden h-10 w-10 shrink-0 rounded-full border border-[#dce8f5] bg-white text-[#1B3A5C] shadow-sm md:grid md:place-items-center" aria-label="السابق">
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="grid flex-1 gap-5 md:grid-cols-2">
            {[
              ["وصال ون سهّل علينا متابعة الطلبات وردود العملاء من مكان واحد.", "خالد العنسي", "مؤسس متجر إلكتروني"],
              ["زاد رضا العملاء بشكل كبير لأن الرد صار أسرع ومنظم دائماً.", "نورة القحطاني", "مديرة تجربة العملاء"],
            ].map(([quote, name, role]) => (
              <article key={name} className="landing-reveal rounded-2xl border border-[#dce8f5] bg-white p-6 text-start shadow-[0_14px_38px_rgba(27,58,92,.07)]">
                <p className="text-4xl font-black text-[#0B6FE8]">“</p>
                <p className="mt-1 min-h-20 leading-8 text-slate-700">{quote}</p>
                <div className="mt-5 flex items-center gap-3">
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-[#0B6FE8] to-[#1FB6A6] font-black text-white">{name.slice(0, 1)}</span>
                  <div>
                    <p className="font-black text-[#1B3A5C]">{name}</p>
                    <p className="text-sm text-slate-500">{role}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <button className="hidden h-10 w-10 shrink-0 rounded-full border border-[#dce8f5] bg-white text-[#1B3A5C] shadow-sm md:grid md:place-items-center" aria-label="التالي">
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>
      </div>
    </Section>
  );
}

export function FinalCTA() {
  return (
    <section className="bg-[#F0F7FF] px-4 py-8">
      <div className="landing-cta mx-auto max-w-[1180px] overflow-hidden rounded-3xl px-6 py-9 text-center text-white shadow-[0_22px_60px_rgba(7,49,93,.22)]">
        <h2 className="text-3xl font-black">ابدأ اليوم مع وصال ون</h2>
        <p className="mt-3 text-blue-100">واجهة احترافية لإدارة المحادثات وتنمية نشاطك.</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <a href="/register" className="landing-ripple rounded-xl bg-[#1FB6A6] px-10 py-3.5 font-black text-white transition hover:-translate-y-1">ابدأ الآن</a>
          <a href="#contact" className="landing-ripple rounded-xl border border-white/30 px-10 py-3.5 font-black text-white transition hover:-translate-y-1 hover:bg-white/10">اطلب تجربة</a>
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
          <BrandLogo mono />
          <p className="mt-4 max-w-sm leading-7 text-blue-100">وصال ون يجمع قنوات التواصل في لوحة واحدة لفريق أسرع وتجربة عميل أفضل.</p>
          <p className="mt-4 text-sm tracking-[0.35em] text-blue-100">wesal.one</p>
        </div>
        {["المنتج", "الشركة", "الدعم"].map((title) => (
          <FooterColumn key={title} title={title} links={["المزايا", "التقارير", "القنوات", "تواصل معنا"]} />
        ))}
        <div>
          <h3 className="font-black">تواصل معنا</h3>
          <ul className="mt-4 space-y-3 text-sm text-blue-100">
            <li>hello@wesal.one</li>
            <li>+966 55 123 4567</li>
            <li className="flex gap-3 pt-2">{["x", "in", "yt", "ig"].map((i) => <span key={i} className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-xs font-black">{i}</span>)}</li>
          </ul>
        </div>
      </div>
      <p className="mx-auto mt-8 w-[min(100%-2rem,1180px)] border-t border-white/10 pt-5 text-center text-sm text-blue-100">© 2026 وصال ون. جميع الحقوق محفوظة.</p>
      <div className="mx-auto mt-6 flex w-[min(100%-2rem,1180px)] flex-wrap justify-center gap-4 text-sm text-blue-100">
        <a href="/products" className="transition hover:text-white">منتجاتنا</a>
        <a href="/about" className="transition hover:text-white">من نحن</a>
        <a href="/privacy" className="transition hover:text-white">سياسة الخصوصية</a>
        <a href="/terms" className="transition hover:text-white">الشروط والأحكام</a>
        <a href="/contact" className="transition hover:text-white">تواصل معنا</a>
      </div>
    </footer>
  );
}

function Section({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`bg-[#F0F7FF] ${className}`}>{children}</section>;
}

function DashboardMockup({ compact = false }: { compact?: boolean }) {
  const messages = conversations.slice(0, compact ? 3 : 5);
  return (
    <div dir="rtl" className={`pointer-events-none relative mx-auto select-none ${compact ? "h-[320px]" : "max-w-[800px]"}`}>
      {!compact ? (
        <>
          <FloatingCard className="-start-6 top-10" title="عميل جديد" body="رسالة واتساب وصلت الآن" />
          <FloatingCard className="-end-6 bottom-20" title="متابعة" body="موعد الرد خلال 2.5 دقيقة" />
        </>
      ) : null}
      <div className={`overflow-hidden rounded-[26px] border border-[#dce8f5] bg-white shadow-[0_24px_70px_rgba(27,58,92,.15)] ${compact ? "h-[320px]" : "h-[452px]"}`}>
        <div className="grid h-full grid-cols-[118px_1fr] sm:grid-cols-[148px_1fr]">
          <aside className="bg-[#0A2E57] p-4 text-white">
            <div className="flex items-center gap-2">
              <LogoMark className="h-9 w-14" mono />
              <span className="hidden text-sm font-black sm:inline">وصال ون</span>
            </div>
            <div className="mt-8 space-y-3">
              {["المحادثات", "العملاء", "المهام", "التقارير", "الإعدادات"].map((item, index) => (
                <div key={item} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${index === 0 ? "bg-[#0B6FE8]" : "text-blue-100/75"}`}>
                  <span className="h-2 w-2 rounded-full bg-[#1FB6A6]" />
                  <span className="hidden sm:inline">{item}</span>
                </div>
              ))}
            </div>
          </aside>
          <div className="grid min-w-0 bg-[#f8fbff] lg:grid-cols-[.95fr_1.08fr_.72fr]">
            <section className="min-w-0 border-e border-[#dce8f5] bg-white p-4">
              <div className="mb-4 flex items-center gap-2 rounded-xl bg-[#f2f6fb] px-3 py-2 text-xs text-slate-400">
                <Search className="h-4 w-4" /> بحث في المحادثات
              </div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-black text-[#1B3A5C]">المحادثات</h3>
                <span className="rounded-full bg-[#eef6ff] px-3 py-1 text-xs font-bold text-[#0B6FE8]">24 جديد</span>
              </div>
              <div className="space-y-3">
                {messages.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.name} className="landing-message-animate flex gap-3 rounded-2xl border border-[#edf2f8] bg-white p-3 shadow-sm" style={{ animationDelay: `${index * 220}ms` }}>
                      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${item.color}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-black text-[#1B3A5C]">{item.name}</p>
                          <span className="text-[11px] text-slate-400">{item.time}</span>
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">{item.text}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="hidden min-w-0 p-4 md:block">
              <div className="mb-4 flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm">
                <div>
                  <p className="text-sm font-black text-[#1B3A5C]">سارة القحطاني</p>
                  <p className="text-xs text-emerald-500">متصل الآن</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-black text-emerald-600">نشطة</span>
              </div>
              <div className="space-y-4">
                <Bubble>أريد معرفة توفر المنتج والسعر المخفض</Bubble>
                <Bubble out>أهلًا سارة، المنتج متوفر والشحن خلال يومين.</Bubble>
                <Bubble>ممتاز، شكرًا لكم</Bubble>
              </div>
              <div className="mt-7 flex items-center gap-2 rounded-2xl bg-white p-3 shadow-sm">
                <span className="flex-1 text-xs text-slate-400">اكتب رسالة...</span>
                <Send className="h-5 w-5 text-[#0B6FE8]" />
              </div>
            </section>
            <section className="hidden border-s border-[#dce8f5] bg-white p-4 lg:block">
              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="الرسائل" value="1,250" />
                <MiniStat label="العملاء" value="24" />
                <MiniStat label="وقت الرد" value="2.5 د" />
                <MiniStat label="الرضا" value="96%" />
              </div>
              <div className="mt-5 rounded-2xl border border-[#edf2f8] p-4">
                <p className="mb-4 text-sm font-black text-[#1B3A5C]">مهام اليوم</p>
                {["متابعة طلب سارة", "تأكيد شحنة محمد", "رد على نورة"].map((task) => (
                  <div key={task} className="mb-3 flex items-center gap-2 text-xs text-slate-600">
                    <CheckCircle2 className="h-4 w-4 text-[#1FB6A6]" /> {task}
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
      <div className="rounded-t-[22px] border-[10px] border-[#172436] bg-[#172436] shadow-[0_22px_60px_rgba(27,58,92,.18)]">{children}</div>
      <div className="mx-auto h-5 w-[82%] rounded-b-[50%] bg-gradient-to-b from-slate-300 to-slate-600" />
    </div>
  );
}

function PhoneMockup() {
  return (
    <div className="pointer-events-none absolute -bottom-2 -end-2 hidden w-[170px] select-none rounded-[30px] border-[8px] border-[#111827] bg-white p-3 shadow-[0_22px_45px_rgba(27,58,92,.18)] md:block">
      <div className="mx-auto mb-3 h-4 w-16 rounded-full bg-[#111827]" />
      <h3 className="mb-3 text-center text-sm font-black text-[#1B3A5C]">المحادثات</h3>
      <div className="space-y-3">{conversations.slice(0, 4).map((item) => <p key={item.name} className="truncate text-xs font-bold text-slate-500">{item.name}</p>)}</div>
    </div>
  );
}

function FloatingCard({ className, title, body }: { className: string; title: string; body: string }) {
  return (
    <div className={`landing-float-card absolute z-20 hidden w-52 rounded-2xl border border-[#dce8f5] bg-white/95 p-4 shadow-[0_18px_45px_rgba(27,58,92,.16)] backdrop-blur md:block ${className}`}>
      <p className="text-xs font-black text-[#0B6FE8]">{title}</p>
      <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">{body}</p>
    </div>
  );
}

function Bubble({ children, out = false }: { children: ReactNode; out?: boolean }) {
  return <div className={`max-w-[86%] rounded-2xl p-3 text-sm leading-6 ${out ? "me-auto bg-emerald-50 text-[#14533b]" : "bg-white text-slate-600 shadow-sm"}`}>{children}</div>;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#edf2f8] bg-white p-3 shadow-sm">
      <p className="text-lg font-black text-[#1B3A5C]">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

function ChartBars() {
  return (
    <div className="mt-5 rounded-2xl bg-[#eef6ff] p-4">
      <p className="text-sm font-black text-[#0B6FE8]">المحادثات خلال 7 أيام</p>
      <div className="mt-4 flex h-20 items-end gap-2">{[35, 46, 38, 58, 52, 78, 65].map((h, i) => <span key={i} className="landing-bar flex-1 rounded-t-lg bg-gradient-to-t from-[#0B6FE8] to-[#1FB6A6]" style={{ height: `${h}%`, animationDelay: `${i * 90}ms` }} />)}</div>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <h3 className="font-black">{title}</h3>
      <ul className="mt-4 space-y-3 text-sm text-blue-100">{links.map((link) => <li key={link}><a href="#home" className="transition hover:text-white">{link}</a></li>)}</ul>
    </div>
  );
}
