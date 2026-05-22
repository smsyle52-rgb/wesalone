import { Link } from "wouter";
import { BrandLogo } from "@/components/landing/WesalLandingSections";

type PageKind = "about" | "privacy" | "terms" | "contact" | "products";

const pages: Record<PageKind, {
  title: string;
  eyebrow: string;
  intro: string;
  sections: Array<{ title: string; body: string[] }>;
}> = {
  about: {
    eyebrow: "من نحن",
    title: "وصال ون يبني تشغيلًا أوضح لتجار اليمن",
    intro: "نساعد أصحاب الأنشطة على جمع المحادثات، تنظيم المتابعة، وربط المعرفة والمنتجات في لوحة واحدة سهلة الاستخدام.",
    sections: [
      { title: "رسالتنا", body: ["نؤمن أن التاجر لا يحتاج أدوات كثيرة ومتفرقة حتى يخدم عملاءه جيدًا. يحتاج نظامًا واضحًا يجمع الرسائل، يوضح الأولويات، ويحفظ معرفة النشاط بطريقة تفيد الفريق والوكيل الذكي."] },
      { title: "من نخدم", body: ["نخدم المتاجر الصغيرة والمتوسطة، مقدمي الخدمات، العيادات، المعاهد، والمشاريع التي تعتمد على واتساب وإنستغرام وماسنجر وتيليجرام لاستقبال العملاء والطلبات."] },
      { title: "رؤيتنا", body: ["أن تصبح وصال ون طبقة التشغيل اليومية للتواصل التجاري في السوق اليمني والعربي: بسيطة، موثوقة، ومناسبة لطريقة عمل الفرق الصغيرة."] },
    ],
  },
  privacy: {
    eyebrow: "سياسة الخصوصية",
    title: "نحمي بياناتك وبيانات عملائك بوضوح ومسؤولية",
    intro: "توضح هذه السياسة نوع البيانات التي نتعامل معها، ولماذا نستخدمها، وكيف نحافظ عليها عند تشغيل خدمات وصال ون.",
    sections: [
      { title: "البيانات التي نجمعها", body: ["قد نعالج بيانات الحساب، معلومات مساحة العمل، بيانات المحادثات، بيانات القنوات المرتبطة، ملفات المعرفة، المنتجات المتزامنة، وسجلات الاستخدام الضرورية لتشغيل الخدمة."] },
      { title: "بيانات ميتا وواتساب", body: ["عند ربط قنوات ميتا، نعالج الرسائل والمعرفات الفنية اللازمة لإظهار المحادثات والردود داخل منصتك. لا نبيع هذه البيانات ولا نستخدمها خارج غرض تشغيل الخدمة وتحسينها."] },
      { title: "التخزين والحماية", body: ["نستخدم ضوابط وصول، تشفير للأسرار، وسجلات تدقيق لتقليل المخاطر. يحتفظ النظام بآخر حالة ناجحة للبيانات المتزامنة ولا يحذفها عند فشل المزامنة."] },
      { title: "حقوقك", body: ["يمكن لصاحب الحساب طلب تصحيح أو حذف بيانات مساحة العمل وفق القيود النظامية والتعاقدية. يمكن كذلك فصل القنوات أو تعطيلها من لوحة التحكم."] },
    ],
  },
  terms: {
    eyebrow: "الشروط والأحكام",
    title: "شروط استخدام منصة وصال ون",
    intro: "باستخدامك للمنصة، فإنك توافق على هذه الشروط التي تنظّم العلاقة بينك وبين وصال ون أثناء فترة التجربة أو الاشتراك.",
    sections: [
      { title: "استخدام الخدمة", body: ["يلتزم المستخدم باستخدام المنصة لأغراض تجارية مشروعة، وبإدارة صلاحيات فريقه ومسؤولية المحتوى الذي يرفعه أو يرسله عبر القنوات المرتبطة."] },
      { title: "التكاملات الخارجية", body: ["تعتمد بعض الميزات على مزودين خارجيين مثل ميتا. قد تتغير سياسات هذه المزودات أو متطلبات المراجعة، ويلتزم صاحب الحساب بإعداد تطبيقاته وأذوناته بشكل صحيح."] },
      { title: "حدود المسؤولية", body: ["توفر وصال ون أدوات لتنظيم التواصل واقتراح الردود. لا ينبغي الاعتماد على الردود الآلية لاتخاذ قرارات حساسة دون مراجعة بشرية."] },
      { title: "التعديلات", body: ["قد نقوم بتحديث هذه الشروط عند إضافة خدمات جديدة أو تغيّر المتطلبات التشغيلية، وسيتم توفير النسخة الأحدث عبر هذه الصفحة."] },
    ],
  },
  contact: {
    eyebrow: "تواصل معنا",
    title: "يسعدنا سماعك",
    intro: "أرسل لنا استفسارك أو طلب تجربة، وسنعود إليك بالمعلومات المناسبة لنشاطك.",
    sections: [
      { title: "بيانات التواصل", body: ["البريد: hello@wesal.one", "الهاتف: +967 000 000 000", "الاستجابة: خلال يوم عمل في أيام الدوام."] },
      { title: "نموذج التواصل", body: ["النسخة الحالية تعرض النموذج بصريًا فقط. يمكن ربط الإرسال بالبريد أو نظام التذاكر في مرحلة لاحقة."] },
    ],
  },
  products: {
    eyebrow: "منتجاتنا وخدماتنا",
    title: "منصة واحدة لتشغيل محادثات العملاء",
    intro: "وصال ون يجمع الأدوات التي يحتاجها التاجر للرد، المتابعة، المعرفة، المنتجات، الحملات، والتقارير.",
    sections: [
      { title: "صندوق وارد موحد", body: ["إدارة محادثات واتساب، إنستغرام، ماسنجر وتيليجرام في واجهة واحدة مع وسوم وحالات ومهام داخلية."] },
      { title: "وكيل ذكي مساعد", body: ["اقتراح ردود مبنية على ذاكرة المحادثة وقاعدة المعرفة والكتالوج، مع وضع ثقة يمنع الإرسال التلقائي إلا بشروط واضحة."] },
      { title: "كتالوج ومنتجات", body: ["مزامنة قراءة فقط من كتالوج ميتا والمنشورات والإعلانات، لتصبح المنتجات قابلة للاسترجاع داخل ردود الوكيل."] },
      { title: "حملات وتحليلات", body: ["قوالب، حملات، أتمتة، وتقارير تساعد صاحب النشاط على فهم الأداء وتحسين سرعة الرد."] },
    ],
  },
};

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <main dir="rtl" className="min-h-screen bg-[#FAFBFC] text-[#1A1F2E]">
      <header className="border-b border-[#e5ebf2] bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-20 w-[min(100%-2rem,1120px)] items-center justify-between">
          <BrandLogo />
          <nav className="hidden items-center gap-6 text-sm font-bold text-[#6B7689] md:flex">
            <Link href="/products">منتجاتنا</Link>
            <Link href="/about">من نحن</Link>
            <Link href="/privacy">الخصوصية</Link>
            <Link href="/terms">الشروط</Link>
            <Link href="/contact">تواصل معنا</Link>
          </nav>
          <Link href="/register" className="rounded-lg bg-[#1B3A5C] px-5 py-2.5 text-sm font-black text-white">ابدأ الآن</Link>
        </div>
      </header>
      {children}
      <footer className="mt-16 border-t border-[#e5ebf2] bg-white py-8">
        <div className="mx-auto flex w-[min(100%-2rem,1120px)] flex-col gap-4 text-sm text-[#6B7689] md:flex-row md:items-center md:justify-between">
          <BrandLogo compact />
          <p>© 2026 وصال ون. جميع الحقوق محفوظة.</p>
        </div>
      </footer>
    </main>
  );
}

function ContactFormPreview() {
  return (
    <div className="mt-8 rounded-2xl border border-[#e5ebf2] bg-white p-5 shadow-[var(--shadow-soft)]">
      <div className="grid gap-4 md:grid-cols-2">
        <input className="rounded-lg border border-[#dfe7f0] px-4 py-3" placeholder="الاسم" />
        <input className="rounded-lg border border-[#dfe7f0] px-4 py-3" placeholder="البريد الإلكتروني" />
        <textarea className="min-h-32 rounded-lg border border-[#dfe7f0] px-4 py-3 md:col-span-2" placeholder="رسالتك" />
      </div>
      <button className="mt-4 rounded-lg bg-[#1FB6A6] px-6 py-3 font-black text-white">إرسال الرسالة</button>
    </div>
  );
}

export default function PublicContentPage({ kind }: { kind: PageKind }) {
  const page = pages[kind];

  return (
    <PublicShell>
      <section className="mx-auto w-[min(100%-2rem,1120px)] py-14 md:py-20">
        <p className="text-sm font-black text-[#1FB6A6]">{page.eyebrow}</p>
        <h1 className="mt-3 max-w-4xl text-4xl font-black leading-tight text-[#1B3A5C] md:text-5xl">{page.title}</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-[#6B7689]">{page.intro}</p>
        {kind === "contact" && <ContactFormPreview />}
      </section>

      <section className="mx-auto grid w-[min(100%-2rem,1120px)] gap-5 md:grid-cols-2">
        {page.sections.map((section) => (
          <article key={section.title} className="rounded-2xl border border-[#e5ebf2] bg-white p-6 shadow-[var(--shadow-soft)]">
            <h2 className="text-xl font-black text-[#1B3A5C]">{section.title}</h2>
            <div className="mt-3 space-y-3 text-sm leading-8 text-[#6B7689]">
              {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
          </article>
        ))}
      </section>
    </PublicShell>
  );
}
