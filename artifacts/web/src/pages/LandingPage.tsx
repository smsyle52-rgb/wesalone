import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link as RouterLink } from "wouter";
import {
  ArrowLeft,
  BarChart3,
  Bot,
  Check,
  Inbox,
  Instagram,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  Package,
  Send,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";

const navLinks = [
  { href: "#features", label: "المميزات" },
  { href: "#pricing", label: "الأسعار" },
  { href: "#contact", label: "تواصل معنا" },
];

const features = [
  { icon: Inbox, title: "الوارد الموحّد", text: "اجمع رسائل كل القنوات في مساحة عمل واحدة واضحة." },
  { icon: Bot, title: "الوكيل الذكي", text: "ردود دقيقة تتعلم من منتجاتك وسياسة البيع لديك." },
  { icon: Package, title: "المنتجات والكتالوج", text: "كتالوج منظم يساعد العميل على الاختيار والشراء بسرعة." },
  { icon: Megaphone, title: "الحملات", text: "رسائل موجهة للعروض والمتابعة دون فقدان نبرة علامتك." },
  { icon: BarChart3, title: "التحليلات", text: "مؤشرات مفهومة عن المحادثات، الطلبات، وفرص النمو." },
  { icon: Workflow, title: "الأتمتة", text: "مسارات متابعة تعمل بهدوء من أول رسالة حتى إغلاق الطلب." },
];

const plans = [
  { name: "البداية", price: "مجاني", text: "لإطلاق قناة واحدة وتجربة الوكيل الذكي.", items: ["وارد موحد", "وكيل أساسي", "تقارير مبسطة"] },
  { name: "النمو", price: "$29", text: "للفرق التي تحتاج بيعاً ومتابعة أسرع.", items: ["قنوات متعددة", "حملات", "أتمتة متقدمة"], featured: true },
  { name: "الأعمال", price: "مخصص", text: "للعمليات الأكبر وتكاملات الفريق.", items: ["صلاحيات موسعة", "دعم مخصص", "تحليلات متقدمة"] },
];

type RevealStyle = CSSProperties & { "--reveal-delay"?: string };

function revealDelay(ms: number): RevealStyle {
  return { "--reveal-delay": `${ms}ms` };
}

function useScrollReveal() {
  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>(".wesal-reveal"));
    if (!items.length) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      items.forEach((item) => item.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
    );

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);
}

function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCount(value);
      return;
    }

    let frame = 0;
    const total = 70;
    const tick = () => {
      frame += 1;
      const progress = 1 - Math.pow(1 - frame / total, 3);
      setCount(Math.round(value * Math.min(progress, 1)));
      if (frame < total) requestAnimationFrame(tick);
    };
    const requestId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(requestId);
  }, [value]);

  return (
    <span>
      {count.toLocaleString("ar")}
      {suffix}
    </span>
  );
}

export default function LandingPage() {
  useScrollReveal();
  const year = useMemo(() => new Date().getFullYear(), []);

  return (
    <main dir="rtl" className="min-h-screen overflow-hidden bg-wesal-bg text-wesal-ink">
      <nav className="sticky top-0 z-50 border-b border-[#1B3A5C]/10 bg-wesal-bg/82 backdrop-blur-xl">
        <div className="wesal-container flex h-20 items-center justify-between gap-4">
          <a href="#" className="inline-flex items-center gap-3" aria-label="وصال ون">
            <img src="/brand/logo-mark.svg" alt="" className="h-11 w-11" />
            <span className="text-xl font-bold text-wesal-primary">وصال ون</span>
          </a>

          <div className="hidden items-center gap-8 md:flex" aria-label="روابط الصفحة">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} className="text-sm font-medium text-wesal-muted transition-colors hover:text-wesal-primary">
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <RouterLink href="/login" className="hidden rounded-md px-4 py-2 text-sm font-semibold text-wesal-primary transition-colors hover:bg-white sm:inline-flex">
              تسجيل الدخول
            </RouterLink>
            <RouterLink href="/register" className="inline-flex items-center gap-2 rounded-md bg-wesal-primary px-4 py-2.5 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(27,58,92,.18)] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-wesal-accent focus:ring-offset-2">
              ابدأ مجاناً
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </RouterLink>
          </div>
        </div>
      </nav>

      <section className="wesal-hero-mesh relative border-b border-[#1B3A5C]/10">
        <div className="wesal-container grid min-h-[calc(100vh-5rem)] items-center gap-12 py-16 lg:grid-cols-[1.02fr_.98fr] lg:py-20">
          <div className="wesal-reveal max-w-3xl">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#1FB6A6]/25 bg-white/70 px-4 py-2 text-sm font-semibold text-wesal-primary">
              <Sparkles className="h-4 w-4 text-wesal-accent" aria-hidden="true" />
              منصة تواصل وبيع موحدة للتجار
            </p>
            <h1 className="text-4xl font-bold leading-[1.15] text-wesal-primary sm:text-5xl lg:text-6xl">
              قرّب عميلك من قرار الشراء عبر منصة واحدة تفهم محادثاته.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-9 text-wesal-muted">
              وصال ون يجمع قنوات التواصل، الوكيل الذكي، الكتالوج، والحملات في تجربة هادئة تساعد فريقك على الرد والبيع والمتابعة بثقة.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <RouterLink href="/register" className="inline-flex items-center justify-center gap-2 rounded-md bg-wesal-primary px-6 py-3.5 text-base font-bold text-white shadow-[0_18px_36px_rgba(27,58,92,.2)] transition-transform hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-wesal-accent focus:ring-offset-2">
                ابدأ مجاناً الآن
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </RouterLink>
              <a href="#features" className="inline-flex items-center justify-center rounded-md border border-[#1B3A5C]/15 bg-white/70 px-6 py-3.5 text-base font-bold text-wesal-primary transition-transform hover:-translate-y-1">
                استكشف المنصة
              </a>
            </div>
          </div>

          <div className="wesal-reveal wesal-float relative mx-auto w-full max-w-[540px]" style={revealDelay(120)}>
            <div className="absolute -inset-5 rounded-[2rem] bg-[#1FB6A6]/10 blur-3xl" aria-hidden="true" />
            <div className="relative rounded-[1.75rem] border border-white/80 bg-white/82 p-4 shadow-[0_32px_80px_rgba(27,58,92,.16)] backdrop-blur">
              <div className="rounded-[1.25rem] border border-[#1B3A5C]/10 bg-[#FAFBFC] p-5">
                <div className="flex items-center justify-between border-b border-[#1B3A5C]/10 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-wesal-primary text-white">
                      <MessagesSquare className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-bold text-wesal-primary">محادثات اليوم</p>
                      <p className="text-sm text-wesal-muted">واتساب، إنستغرام، ماسنجر</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-[#1FB6A6]/12 px-3 py-1 text-sm font-bold text-[#127f74]">نشط</span>
                </div>
                <div className="space-y-4 pt-5">
                  {["هل المنتج متوفر؟", "أريد المقاس المتوسط", "كم مدة التوصيل؟"].map((message, index) => (
                    <div key={message} className="flex items-start gap-3" style={{ opacity: 0.92 - index * 0.08 }}>
                      <span className="mt-2 h-2.5 w-2.5 rounded-full bg-wesal-accent" />
                      <div className="rounded-2xl rounded-tr-sm bg-white px-4 py-3 text-sm text-wesal-ink shadow-sm">{message}</div>
                    </div>
                  ))}
                  <div className="mr-auto max-w-[86%] rounded-2xl rounded-tl-sm bg-wesal-primary px-4 py-3 text-sm leading-7 text-white">
                    متوفر يا غالي، وبنجهّز لك الطلب اليوم. تحب نرسل لك صورة الألوان قبل التأكيد؟
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[#1B3A5C]/10 bg-white py-8">
        <div className="wesal-container grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
          <p className="wesal-reveal text-2xl font-bold text-wesal-primary">منصة متكاملة لإدارة تواصل عملائك</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: MessageCircle, label: "واتساب", value: 98, suffix: "%" },
              { icon: Instagram, label: "إنستغرام", value: 24, suffix: "/7" },
              { icon: Send, label: "ماسنجر", value: 3, suffix: " قنوات" },
            ].map((item, index) => (
              <div key={item.label} className="wesal-reveal min-w-24 rounded-lg border border-[#1B3A5C]/10 bg-[#FAFBFC] p-4 text-center" style={revealDelay(index * 90)}>
                <item.icon className="mx-auto mb-2 h-5 w-5 text-wesal-accent" aria-hidden="true" />
                <p className="text-lg font-bold text-wesal-primary"><CountUp value={item.value} suffix={item.suffix} /></p>
                <p className="text-xs text-wesal-muted">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="wesal-container py-20">
        <div className="wesal-reveal max-w-2xl">
          <p className="text-sm font-bold text-wesal-accent">مميزات مصممة للعمل اليومي</p>
          <h2 className="mt-3 text-3xl font-bold text-wesal-primary sm:text-4xl">كل ما يحتاجه التاجر ليتابع العميل دون تشتيت.</h2>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => (
            <article key={feature.title} className="wesal-reveal rounded-lg border border-[#1B3A5C]/10 bg-white p-6 shadow-[0_16px_34px_rgba(27,58,92,.06)] transition-transform hover:-translate-y-1" style={revealDelay(index * 80)}>
              <feature.icon className="mb-5 h-7 w-7 text-wesal-accent" aria-hidden="true" />
              <h3 className="text-xl font-bold text-wesal-primary">{feature.title}</h3>
              <p className="mt-3 leading-7 text-wesal-muted">{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-[#EEF7F7] py-20">
        <div className="wesal-container">
          <div className="wesal-reveal text-center">
            <p className="text-sm font-bold text-wesal-accent">طريقة العمل</p>
            <h2 className="mt-3 text-3xl font-bold text-wesal-primary sm:text-4xl">ثلاث خطوات كافية لتبدأ البيع بثقة.</h2>
          </div>
          <div className="relative mt-12 grid gap-5 md:grid-cols-3">
            <div className="wesal-line-pulse pointer-events-none absolute inset-x-[16%] top-16 hidden h-1 md:block" aria-hidden="true" />
            {["اربط قنواتك", "درّب وكيلك", "ابدأ البيع"].map((step, index) => (
              <div key={step} className="wesal-reveal relative rounded-lg border border-white bg-white p-6 text-center shadow-[0_18px_38px_rgba(27,58,92,.07)]" style={revealDelay(index * 120)}>
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-wesal-primary text-xl font-bold text-white">{index + 1}</span>
                <h3 className="mt-5 text-xl font-bold text-wesal-primary">{step}</h3>
                <p className="mt-3 text-sm leading-7 text-wesal-muted">
                  {index === 0 ? "وصّل واتساب وإنستغرام وماسنجر خلال دقائق." : index === 1 ? "أضف منتجاتك وسياساتك ليجيب الوكيل بدقة." : "تابع الطلبات والفرص من مكان واحد."}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="wesal-container grid items-center gap-10 py-20 lg:grid-cols-[.92fr_1.08fr]">
        <div className="wesal-reveal">
          <p className="text-sm font-bold text-wesal-accent">وكيل ذكي بنبرة قريبة</p>
          <h2 className="mt-3 text-3xl font-bold text-wesal-primary sm:text-4xl">يرد بسرعة، ويحافظ على أسلوب متجرك.</h2>
          <p className="mt-5 text-lg leading-9 text-wesal-muted">
            درّب الوكيل على منتجاتك، خيارات التوصيل، وسياسة الدفع ليقدم إجابات مفيدة باللهجة المناسبة دون أن يفقد العميل الإحساس بوجود فريق حقيقي خلف العلامة.
          </p>
        </div>
        <div className="wesal-reveal rounded-[1.5rem] border border-[#1B3A5C]/10 bg-white p-5 shadow-[0_28px_70px_rgba(27,58,92,.12)]" style={revealDelay(120)}>
          <div className="rounded-[1rem] bg-[#102C48] p-5 text-white">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1FB6A6]"><Bot className="h-5 w-5" aria-hidden="true" /></div>
              <div>
                <p className="font-bold">وكيل وصال</p>
                <p className="text-xs text-white/65">يكتب الآن</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="w-fit rounded-2xl rounded-tr-sm bg-white/10 px-4 py-3 text-sm">معاكم مقاس 42 من الحذاء الأسود؟</div>
              <div className="mr-auto max-w-[92%] rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm leading-7 text-[#1A1F2E]">
                <p className="wesal-type">أيوه متوفر يا غالي.</p>
                <p className="mt-2 text-[#6B7689]">السعر 18,500 ريال، والتوصيل داخل صنعاء خلال 24 ساعة. أؤكد لك الطلب؟</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="bg-white py-20">
        <div className="wesal-container">
          <div className="wesal-reveal max-w-2xl">
            <p className="text-sm font-bold text-wesal-accent">خطط مرنة</p>
            <h2 className="mt-3 text-3xl font-bold text-wesal-primary sm:text-4xl">ابدأ صغيراً، ثم وسّع التشغيل عندما ينمو الطلب.</h2>
          </div>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {plans.map((plan, index) => (
              <article key={plan.name} className={`wesal-reveal rounded-lg border p-6 transition-transform hover:-translate-y-1 ${plan.featured ? "border-wesal-accent bg-[#F0FBFA] shadow-[0_24px_54px_rgba(31,182,166,.16)]" : "border-[#1B3A5C]/10 bg-white"}`} style={revealDelay(index * 90)}>
                <h3 className="text-2xl font-bold text-wesal-primary">{plan.name}</h3>
                <p className="mt-3 text-wesal-muted">{plan.text}</p>
                <p className="mt-6 text-3xl font-bold text-wesal-primary">{plan.price}</p>
                <ul className="mt-6 space-y-3">
                  {plan.items.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-sm text-wesal-muted">
                      <Check className="h-4 w-4 text-wesal-accent" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
                <RouterLink href="/register" className="mt-7 inline-flex w-full items-center justify-center rounded-md bg-wesal-primary px-4 py-3 text-sm font-bold text-white transition-transform hover:-translate-y-0.5">
                  اختر الخطة
                </RouterLink>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="bg-wesal-accent py-16 text-white">
        <div className="wesal-container flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="wesal-reveal">
            <p className="text-sm font-bold text-white/75">وصال ون</p>
            <h2 className="mt-2 text-3xl font-bold sm:text-4xl">ابدأ تشغيل نشاطك اليوم.</h2>
          </div>
          <RouterLink href="/register" className="wesal-reveal inline-flex items-center gap-2 rounded-md bg-white px-6 py-3.5 font-bold text-wesal-primary transition-transform hover:-translate-y-1">
            ابدأ مجاناً
            <Zap className="h-5 w-5" aria-hidden="true" />
          </RouterLink>
        </div>
      </section>

      <footer className="bg-[#102C48] py-10 text-white">
        <div className="wesal-container flex flex-col justify-between gap-6 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <img src="/brand/logo-mark-mono.svg" alt="" className="h-10 w-10" />
            <div>
              <p className="font-bold">وصال ون</p>
              <p className="text-sm text-white/60">تواصل مستمر، منصة واحدة.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-5 text-sm text-white/70">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} className="hover:text-white">{link.label}</a>
            ))}
          </div>
          <p className="text-sm text-white/55">© {year} Wesal One. جميع الحقوق محفوظة.</p>
        </div>
      </footer>
    </main>
  );
}
