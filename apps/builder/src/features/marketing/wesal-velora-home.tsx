import {
  ArrowLeft,
  Bot,
  BrainCircuit,
  Check,
  ChevronLeft,
  CircleHelp,
  ContactRound,
  Database,
  MessageCircleMore,
  MessagesSquare,
  Route,
  ShoppingBag,
  Sparkles,
  UsersRound,
  Zap,
} from "lucide-react"
import Link from "next/link"
import { PublicShell } from "./public-shell"

const capabilities = [
  {
    title: "صندوق وارد موحّد",
    description: "تابع كل المحادثات من القنوات المتصلة في مكان واحد، ووزّعها على فريقك بوضوح.",
    icon: MessagesSquare,
    className: "md:col-span-2",
  },
  {
    title: "وكلاء ذكاء اصطناعي",
    description: "أنشئ وكيلًا يجيب وفق تعليماتك ومعرفتك، ثم راقب أثره من داخل المنصة.",
    icon: BrainCircuit,
    className: "md:col-span-1",
  },
  {
    title: "قاعدة معرفة قابلة للبحث",
    description: "ارفع المستندات والملفات لتغذية إجابات وكيلك وسياق فريقك.",
    icon: Database,
    className: "md:col-span-1",
  },
  {
    title: "رحلات وتدفقات آلية",
    description: "صمّم الرسائل والشروط والإجراءات ليتابع العمل حتى خارج ساعات الدوام.",
    icon: Route,
    className: "md:col-span-2",
  },
  {
    title: "جهات الاتصال والتقسيم",
    description: "ابنِ ملفًا موحدًا لكل عميل ونظّم الشرائح والوسوم والحقول المخصصة.",
    icon: ContactRound,
    className: "md:col-span-1",
  },
  {
    title: "المنتجات والطلبات",
    description: "نظّم الكتالوج والطلبات من نفس مساحة تشغيل المحادثات.",
    icon: ShoppingBag,
    className: "md:col-span-1",
  },
]

const channels = ["WhatsApp", "Instagram", "Messenger", "Telegram", "Web chat", "TikTok", "Zalo"]

const steps = [
  ["اربط قنواتك", "أضف القنوات المتاحة لفريقك من صفحة القنوات."],
  ["رتّب سير العمل", "حدّد من يستقبل الرسائل، وأنشئ الوسوم والتدفقات اللازمة."],
  ["فعّل المساعدة الذكية", "أنشئ وكيلًا واربطه بقاعدة المعرفة المناسبة."],
]

const faqs = [
  ["هل أحتاج إلى بطاقة للبدء؟", "لا. تتيح الخطة المجانية البدء برصيد شهري قدره 1,000 نقطة، وتفاصيل الحدود واضحة في صفحة الأسعار."],
  ["كيف تُستهلك النقاط؟", "تُخصم النقاط بحسب الاستخدام الفعلي للخدمات المقاسة مثل الذكاء الاصطناعي والصوت والصور والمعرفة، وتظهر الحدود في باقتك."],
  ["هل يمكن للفريق العمل من حساب واحد؟", "نعم، وتختلف سعة أعضاء الفريق ومساحات العمل والقنوات حسب الباقة المختارة."],
  ["ما القنوات التي يمكن ربطها؟", "يدعم وصال ون القنوات التي تظهر في صفحة إنشاء القنوات، ومنها واتساب وإنستغرام ومسنجر وتلغرام وويب شات وTikTok وZalo."],
]

function InboxMockup() {
  return (
    <div className="relative mx-auto mt-12 max-w-5xl overflow-hidden rounded-[1.75rem] border border-white/15 bg-slate-950/80 p-2 shadow-2xl shadow-cyan-950/40 backdrop-blur">
      <div className="flex items-center gap-2 border-white/10 border-b px-4 py-3 text-slate-400 text-xs">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <span className="mx-auto rounded-md bg-white/5 px-20 py-1 text-slate-300">wesal.one</span>
      </div>
      <div className="grid min-h-[360px] grid-cols-[76px_1fr] overflow-hidden rounded-b-[1.3rem] bg-slate-900/80 sm:grid-cols-[170px_1fr_180px]">
        <aside className="border-white/10 border-l bg-slate-950/50 p-3">
          <img alt="وصال ون" className="mx-auto h-9 w-9" src="/brand/icon_white.svg" />
          <div className="mt-8 space-y-4 text-center text-cyan-300">
            <MessageCircleMore className="mx-auto h-5 w-5" />
            <UsersRound className="mx-auto h-5 w-5 text-slate-500" />
            <Route className="mx-auto h-5 w-5 text-slate-500" />
            <Bot className="mx-auto h-5 w-5 text-slate-500" />
          </div>
        </aside>
        <section className="border-white/10 border-l p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div><p className="font-bold text-white">رسائل اليوم</p><p className="mt-1 text-slate-500 text-xs">كل القنوات المتصلة</p></div>
            <span className="rounded-full bg-cyan-400/15 px-3 py-1 font-bold text-cyan-200 text-xs">12 جديدة</span>
          </div>
          <div className="mt-5 space-y-3">
            {["استفسار عن المنتج", "أحتاج متابعة طلبي", "هل يمكنني التحدث مع الفريق؟"].map((message, index) => (
              <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[.035] p-3" key={message}>
                <span className={`grid h-9 w-9 place-items-center rounded-full font-bold text-xs ${index === 0 ? "bg-emerald-400 text-slate-950" : "bg-cyan-400/20 text-cyan-200"}`}>{["و", "أ", "س"][index]}</span>
                <div className="min-w-0 flex-1"><p className="font-semibold text-sm text-white">{["واتساب", "إنستغرام", "ويب شات"][index]}</p><p className="truncate text-slate-400 text-xs">{message}</p></div>
                <span className="text-slate-500 text-xs">الآن</span>
              </div>
            ))}
          </div>
        </section>
        <aside className="hidden p-5 sm:block">
          <p className="font-bold text-white text-sm">مساعد وصال</p>
          <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-cyan-50 text-sm leading-7">يمكنني البحث في قاعدة المعرفة واقتراح رد مناسب لفريقك.</div>
          <div className="mt-4 h-20 rounded-xl border border-dashed border-white/15" />
        </aside>
      </div>
    </div>
  )
}

export function WesalVeloraHome() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "وصال ون",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: "https://www.wesal.one",
    inLanguage: "ar",
    description: "منصة لتشغيل محادثات الأعمال والقنوات والفريق والذكاء الاصطناعي في مساحة عمل واحدة.",
  }

  return (
    <PublicShell>
      <script dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} type="application/ld+json" />
      <section className="relative isolate overflow-hidden bg-[#05142b] pb-14 pt-20 sm:pb-20 sm:pt-28">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_55%_at_50%_-5%,rgba(11,204,232,.35),transparent_68%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-full opacity-20 [background-image:linear-gradient(rgba(255,255,255,.09)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.09)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_75%_60%_at_50%_20%,black,transparent)]" />
        <div className="mx-auto max-w-7xl px-5 text-center lg:px-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-200/25 bg-white/[.06] px-4 py-2 font-semibold text-cyan-100 text-sm backdrop-blur"><Sparkles className="h-4 w-4" />منصة تشغيل محادثات الأعمال</span>
          <h1 className="mx-auto mt-7 max-w-4xl text-balance font-black text-4xl leading-[1.22] text-white sm:text-6xl">كل محادثات أعمالك في مكان واحد</h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base text-slate-300 leading-8 sm:text-lg">وصال ون يجمع القنوات والفريق والأتمتة والذكاء الاصطناعي في مساحة عمل واحدة، لتبقى كل محادثة واضحة وقابلة للمتابعة.</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-300 px-6 py-3.5 font-bold text-slate-950 shadow-lg shadow-cyan-400/20 transition hover:bg-cyan-200" href="/auth/sign-up">ابدأ مجانًا <ArrowLeft className="h-4 w-4" /></Link>
            <Link className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/[.06] px-6 py-3.5 font-bold text-white transition hover:bg-white/10" href="/features">استكشف المزايا <ChevronLeft className="h-4 w-4" /></Link>
          </div>
          <p className="mt-4 text-slate-400 text-xs">الخطة المجانية تشمل 1,000 نقطة شهرية.</p>
          <InboxMockup />
        </div>
      </section>

      <section className="bg-white py-18 text-slate-950 sm:py-24">
        <div className="mx-auto max-w-7xl px-5 lg:px-8">
          <p className="text-center font-bold text-cyan-700 text-sm">قنواتك في واجهة واحدة</p>
          <div className="mx-auto mt-6 flex max-w-5xl flex-wrap items-center justify-center gap-3" dir="ltr">
            {channels.map((channel) => <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 font-bold text-slate-700 text-sm shadow-sm" key={channel}>{channel}</span>)}
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-20 text-slate-950 sm:py-28">
        <div className="mx-auto max-w-7xl px-5 lg:px-8">
          <div className="mx-auto max-w-3xl text-center"><p className="font-bold text-cyan-700 text-sm">تشغيل منظم، لا محادثات متفرقة</p><h2 className="mt-4 text-balance font-black text-3xl sm:text-5xl">الأدوات التي يحتاجها فريق المحادثات في مكانها الصحيح</h2><p className="mt-5 text-slate-600 leading-8">كل جزء مصمم ليكمل الآخر: من أول رسالة، إلى الرد، إلى إدارة المعرفة وسياق العميل.</p></div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {capabilities.map(({ title, description, icon: Icon, className }, index) => (
              <article className={`group relative min-h-64 overflow-hidden rounded-3xl border border-slate-200 bg-white p-7 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl ${className}`} key={title}>
                <div aria-hidden className="absolute -left-16 -top-16 h-40 w-40 rounded-full bg-cyan-200/45 blur-3xl transition group-hover:bg-cyan-300/55" />
                <div className="relative"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-950 text-cyan-300"><Icon className="h-6 w-6" /></span><h3 className="mt-16 font-black text-xl">{title}</h3><p className="mt-3 max-w-xl text-slate-600 text-sm leading-7">{description}</p></div>
                {index === 0 && <div className="absolute bottom-0 left-0 right-0 flex gap-2 border-slate-100 border-t bg-slate-50/80 px-5 py-3 text-slate-500 text-xs"><MessageCircleMore className="h-4 w-4 text-cyan-700" />رسائل منظمة حسب الفريق والقناة</div>}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden bg-slate-950 py-20 text-white sm:py-28">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-2 lg:px-8">
          <div><p className="font-bold text-cyan-300 text-sm">ذكاء اصطناعي تحت إشرافك</p><h2 className="mt-4 text-balance font-black text-3xl leading-tight sm:text-5xl">اجعل المعرفة جزءًا من كل محادثة</h2><p className="mt-6 max-w-xl text-slate-300 leading-8">اربط الوكلاء بالمعرفة التي يملكها عملك، واستخدم الأدوات والتدفقات للمساعدة في تنفيذ العمل بدلًا من إجابات عامة خارج سياقك.</p><ul className="mt-8 space-y-4 text-slate-200">{["وكلاء قابلون للتخصيص", "ملفات ومعرفة قابلة للإدارة", "إجراءات وتدفقات عند الحاجة"].map((item) => <li className="flex items-center gap-3" key={item}><Check className="h-5 w-5 text-cyan-300" />{item}</li>)}</ul><Link className="mt-8 inline-flex items-center gap-2 font-bold text-cyan-200 hover:text-cyan-100" href="/features">تعرّف على المزايا <ArrowLeft className="h-4 w-4" /></Link></div>
          <div className="relative rounded-[2rem] border border-white/10 bg-white/[.04] p-5 shadow-2xl"><div aria-hidden className="absolute -inset-20 -z-10 rounded-full bg-cyan-500/20 blur-3xl" /><div className="rounded-2xl border border-white/10 bg-slate-900 p-5"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-300 text-slate-950"><Bot className="h-5 w-5" /></span><div><p className="font-bold">وكيل المساعدة</p><p className="text-emerald-300 text-xs">متصل بقاعدة المعرفة</p></div></div><div className="mt-6 space-y-4 text-sm leading-7"><div className="mr-auto max-w-[88%] rounded-2xl rounded-tr-sm bg-white/10 p-4 text-slate-200">ما الذي تريد أن يعرفه فريق الدعم عن هذا المنتج؟</div><div className="ml-auto max-w-[88%] rounded-2xl rounded-tl-sm bg-cyan-300 p-4 text-slate-950">أستطيع البحث في المستندات المرتبطة واقتراح رد واضح، ثم يراجعه الفريق قبل الإرسال.</div></div></div></div>
        </div>
      </section>

      <section className="bg-white py-20 text-slate-950 sm:py-28">
        <div className="mx-auto max-w-7xl px-5 lg:px-8"><div className="text-center"><p className="font-bold text-cyan-700 text-sm">ابدأ بخطوات واضحة</p><h2 className="mt-4 font-black text-3xl sm:text-5xl">من القناة إلى محادثة منظمة</h2></div><ol className="mt-14 grid gap-6 md:grid-cols-3">{steps.map(([title, description], index) => <li className="relative rounded-3xl border border-slate-200 p-7" key={title}><span className="grid h-10 w-10 place-items-center rounded-full bg-cyan-100 font-black text-cyan-800">{index + 1}</span><h3 className="mt-8 font-black text-xl">{title}</h3><p className="mt-3 text-slate-600 leading-7">{description}</p>{index < steps.length - 1 && <ArrowLeft className="absolute -left-5 top-12 hidden h-8 w-8 text-cyan-500 md:block" />}</li>)}</ol></div>
      </section>

      <section className="bg-slate-50 py-20 text-slate-950 sm:py-28"><div className="mx-auto max-w-5xl px-5 lg:px-8"><div className="text-center"><p className="font-bold text-cyan-700 text-sm">أسئلة شائعة</p><h2 className="mt-4 font-black text-3xl sm:text-5xl">إجابات قبل أن تبدأ</h2></div><div className="mt-12 grid gap-4 md:grid-cols-2">{faqs.map(([question, answer]) => <article className="rounded-2xl border border-slate-200 bg-white p-6" key={question}><div className="flex items-start gap-3"><CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-cyan-700" /><div><h3 className="font-black">{question}</h3><p className="mt-3 text-slate-600 text-sm leading-7">{answer}</p></div></div></article>)}</div><div className="mt-10 text-center"><Link className="font-bold text-cyan-700 hover:text-cyan-900" href="/faq">عرض كل الأسئلة <ArrowLeft className="inline h-4 w-4" /></Link></div></div></section>

      <section className="relative overflow-hidden bg-cyan-300 py-20 text-slate-950"><div aria-hidden className="absolute inset-0 opacity-20 [background-image:radial-gradient(#0f172a_1px,transparent_1px)] [background-size:18px_18px]" /><div className="relative mx-auto max-w-3xl px-5 text-center"><Zap className="mx-auto h-8 w-8" /><h2 className="mt-5 font-black text-3xl sm:text-5xl">ابدأ من محادثاتك الحالية</h2><p className="mt-5 text-slate-800 leading-8">أنشئ حسابك، ابدأ بالخطة المجانية، ثم اختر الباقة التي تناسب استخدام فريقك عندما تكون جاهزًا.</p><div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><Link className="rounded-xl bg-slate-950 px-6 py-3.5 font-bold text-white transition hover:bg-slate-800" href="/auth/sign-up">إنشاء حساب</Link><Link className="rounded-xl border border-slate-950/25 px-6 py-3.5 font-bold transition hover:bg-white/30" href="/pricing">عرض الباقات</Link></div></div></section>
    </PublicShell>
  )
}
