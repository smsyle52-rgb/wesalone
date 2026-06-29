import { Link } from "wouter";
import "@/styles/wesal-marketing.css";

type PageKind = "about" | "privacy" | "terms" | "contact" | "products" | "dataDeletion";

type PageSection = {
  title: string;
  body: string[];
  bullets?: string[];
};

type PublicPage = {
  title: string;
  eyebrow: string;
  intro: string;
  updated?: string;
  sections: PageSection[];
};

const SUPPORT_EMAIL = "support@wesal.one";
const SUPPORT_PHONE = "+967 775 324 950";

const pages: Record<PageKind, PublicPage> = {
  about: {
    eyebrow: "من نحن",
    title: "وصال ون يبني تشغيلًا أوضح لتجار اليمن والمنطقة",
    intro: "نساعد الأنشطة التجارية على جمع المحادثات، تنظيم المتابعة، وربط المعرفة والمنتجات في لوحة واحدة سهلة الاستخدام.",
    sections: [
      { title: "رسالتنا", body: ["نؤمن أن صاحب النشاط لا يحتاج أدوات كثيرة ومتفرقة حتى يخدم عملاءه جيدًا. يحتاج نظامًا واضحًا يجمع الرسائل، يوضح الأولويات، ويحفظ معرفة النشاط بطريقة تفيد الفريق والوكيل الذكي."] },
      { title: "من نخدم", body: ["نخدم المتاجر الصغيرة والمتوسطة، مقدمي الخدمات، العيادات، المعاهد، والمشاريع التي تعتمد على واتساب وإنستغرام وماسنجر وتيليجرام لاستقبال العملاء والطلبات."] },
      { title: "رؤيتنا", body: ["أن تصبح وصال ون طبقة التشغيل اليومية للتواصل التجاري في السوق اليمني والعربي: بسيطة، موثوقة، ومناسبة لطريقة عمل الفرق الصغيرة."] },
    ],
  },
  privacy: {
    eyebrow: "سياسة الخصوصية",
    title: "سياسة خصوصية وصال ون",
    intro: "توضح هذه السياسة ما هي البيانات التي نحتاجها لتشغيل وصال ون، وكيف نستخدمها ونحميها عند تصفح الموقع أو استخدام حسابك داخل المنصة.",
    updated: "آخر تحديث: 29 يونيو 2026",
    sections: [
      {
        title: "من نحن ونطاق السياسة",
        body: [
          "وصال ون منصة لإدارة محادثات العملاء، تنظيم الفريق، متابعة الطلبات، وتشغيل المعرفة والأتمتة من مكان واحد. تنطبق هذه السياسة على الموقع وصفحات التسجيل والدخول ولوحة التحكم والخدمات المرتبطة بالحساب.",
          "إذا كنت تستخدم وصال ون لصالح متجر أو شركة أو فريق، فأنت مسؤول عن إدارة بيانات تلك الجهة وصلاحيات المستخدمين المرتبطين بها داخل المنصة.",
        ],
      },
      {
        title: "البيانات التي نجمعها",
        body: ["نجمع فقط البيانات التي نحتاجها لتشغيل الحساب، تقديم الخدمة، دعمك عند الحاجة، وحماية المنصة من إساءة الاستخدام."],
        bullets: [
          "بيانات الحساب: الاسم، البريد الإلكتروني، اسم مساحة العمل، ورقم الهاتف إذا أدخلته.",
          "بيانات الجلسة والأمان: معلومات تسجيل الدخول، الكوكيز الضرورية، وسجلات الوصول التي تساعدنا على حماية الحساب.",
          "بيانات العمل: المحادثات، الوسوم، المهام، الملاحظات، الطلبات، والملفات التي يضيفها فريقك داخل المنصة.",
          "بيانات القنوات المرتبطة: معلومات الربط اللازمة لعرض المحادثات وتشغيل القنوات المتصلة داخل حسابك.",
          "بيانات الاشتراك والدعم: الخطة الحالية، بيانات الفوترة الأساسية، ورسائل الدعم التي ترسلها لنا.",
        ],
      },
      {
        title: "كيف نستخدم البيانات",
        body: [
          "نستخدم البيانات لتسجيل الدخول، عرض المحتوى الصحيح داخل الحساب، تشغيل المحادثات والمهام والتقارير، وتقديم الدعم الفني عند الحاجة.",
          "لا نبيع بياناتك، ولا نستخدمها في الإعلانات، ولا نشاركها إلا بالقدر الضروري لتشغيل وصال ون أو عند وجود التزام قانوني واضح.",
        ],
      },
      {
        title: "أغراض المعالجة",
        body: ["استخدام البيانات في وصال ون محصور في الأغراض التشغيلية الواضحة والمتوقعة من منصة لإدارة المحادثات والعمل."],
        bullets: [
          "إنشاء الحسابات ومساحات العمل وإدارة تسجيل الدخول.",
          "تشغيل صندوق الوارد، الردود، التحويل للفريق، الأتمتة، التقارير، المنتجات، والمعرفة.",
          "حفظ التفضيلات والصلاحيات وسجلات التدقيق ومنع إساءة الاستخدام.",
          "تقديم الدعم الفني، معالجة البلاغات، وتحسين استقرار الخدمة.",
          "إدارة الاشتراك والفوترة والنقاط وطلبات الدفع.",
          "الامتثال للمتطلبات النظامية أو طلبات المنصات المتكاملة عندما تكون لازمة.",
        ],
      },
      {
        title: "المشاركة والمعالجون الفرعيون",
        body: [
          "لا نبيع بياناتك أو بيانات عملائك. وقد نشارك بيانات محدودة مع مزودي الاستضافة أو قواعد البيانات أو البريد أو الحماية بالقدر الذي يلزم فقط لتشغيل وصال ون.",
          "أي خدمة خارجية تربطها داخل حسابك تظل خاضعة أيضًا لشروط ذلك المزود، لكن استخدامنا لها داخل وصال ون يظل محصورًا في تشغيل حسابك.",
        ],
      },
      {
        title: "الاحتفاظ بالبيانات",
        body: [
          "نحتفظ بالبيانات طوال مدة وجود الحساب أو مساحة العمل، أو طالما كانت ضرورية لتشغيل الخدمة، حل النزاعات، الامتثال، منع الاحتيال، أو حفظ سجلات محاسبية وتشغيلية مشروعة.",
          "عند حذف الحساب أو طلب حذف البيانات، نحذف أو نعطل البيانات المرتبطة وفق الإمكانات الفنية والالتزامات النظامية والتعاقدية. قد تبقى نسخ احتياطية محدودة لفترة قصيرة إلى أن تنتهي دورة النسخ الاحتياطي.",
        ],
      },
      {
        title: "الأمان",
        body: [
          "نستخدم ضوابط وصول، فصل مساحات العمل، صلاحيات، سجلات تدقيق، وحماية للأسرار والتكاملات. نحد الوصول الداخلي إلى البيانات حسب الحاجة التشغيلية.",
          "لا توجد خدمة إلكترونية آمنة بنسبة مطلقة، لكننا نعمل على تقليل المخاطر ومعالجة الثغرات والتصرف بسرعة عند وجود بلاغ أمني.",
        ],
      },
      {
        title: "حقوقك وخياراتك",
        body: ["يمكنك طلب الوصول إلى بياناتك، تصحيحها، فصل القنوات، تصدير ما يمكن تصديره، أو حذف مساحة العمل وبياناتها وفق القيود المشروعة."],
        bullets: [
          "لفصل قناة مرتبطة: استخدم إعدادات القنوات أو تواصل معنا.",
          "لحذف بياناتك أو بيانات مساحة العمل: استخدم صفحة حذف البيانات أو أرسل طلبًا إلى البريد الموضح أدناه.",
          "لتعديل بيانات الحساب: استخدم إعدادات الحساب أو راسلنا إذا احتجت مساعدة.",
        ],
      },
      {
        title: "الأطفال والبيانات الحساسة",
        body: [
          "وصال ون مخصص للأنشطة التجارية وليس موجهًا للأطفال. لا نطلب من المستخدمين إدخال بيانات صحية أو مالية حساسة لعملائهم إلا إذا كان ذلك ضروريًا لطبيعة نشاطهم ومسؤوليتهم القانونية.",
          "لا تقدم وصال ون خدمات تمويل، إقراض، تصنيف ائتماني، أو قرارات مالية آلية. أي بيانات دفع أو فواتير تُستخدم لإدارة اشتراك الخدمة فقط.",
        ],
      },
      {
        title: "التواصل وتحديثات السياسة",
        body: [
          `لأي طلب خصوصية أو حذف أو استفسار أمني، راسلنا على ${SUPPORT_EMAIL} أو عبر واتساب ${SUPPORT_PHONE}.`,
          "قد نحدّث هذه السياسة عند إضافة ميزات أو تكاملات جديدة. سنعرض تاريخ آخر تحديث أعلى الصفحة، ويعد استمرار استخدام الخدمة بعد التحديث قبولًا بالنسخة الجديدة.",
        ],
      },
    ],
  },
  terms: {
    eyebrow: "الشروط والأحكام",
    title: "شروط استخدام منصة وصال ون",
    intro: "باستخدامك وصال ون فإنك توافق على هذه الشروط التي تنظّم استخدام الحساب والخدمة أثناء التجربة أو الاشتراك.",
    updated: "آخر تحديث: 29 يونيو 2026",
    sections: [
      { title: "استخدام الخدمة", body: ["يستخدم العميل وصال ون لأغراض مشروعة، ويلتزم بالحفاظ على سرية حسابه وإدارة أعضاء فريقه ومراجعة المحتوى الذي يتم إدخاله أو إرساله من خلال المنصة."] },
      { title: "المحتوى والبيانات", body: ["تبقى مسؤولية البيانات والمحادثات والملفات التي تدخلها إلى وصال ون على صاحب الحساب أو الجهة التي يمثلها. يجب التأكد من أن لديك الحق في استخدام هذه البيانات داخل المنصة."] },
      { title: "الخدمة والتحديثات", body: ["قد نحدث بعض الميزات أو الواجهات أو حدود الاستخدام لتحسين الخدمة أو الأمان أو الاستقرار، وسنعرض النسخة الأحدث من الشروط عبر هذه الصفحة عند الحاجة."] },
      { title: "حدود المسؤولية", body: ["وصال ون يساعدك على تنظيم العمل وتسهيل المتابعة، لكنه لا يغني عن المراجعة البشرية في القرارات الحساسة أو البيانات التي قد تؤثر على العملاء أو العمليات المالية أو التشغيلية."] },
    ],
  },
  contact: {
    eyebrow: "تواصل معنا",
    title: "يسعدنا سماعك",
    intro: "أرسل لنا استفسارك أو طلب تجربة، وسنعود إليك بالمعلومات المناسبة لنشاطك.",
    sections: [
      { title: "بيانات التواصل", body: [`البريد: ${SUPPORT_EMAIL}`, `واتساب: ${SUPPORT_PHONE}`, "الاستجابة: عادة خلال يوم عمل في أيام الدوام."] },
      { title: "طلبات الخصوصية والحذف", body: ["لطلب حذف البيانات أو إلغاء ربط القنوات، استخدم صفحة حذف البيانات أو أرسل طلبًا من بريد مالك مساحة العمل لتسريع التحقق."] },
    ],
  },
  products: {
    eyebrow: "منتجاتنا وخدماتنا",
    title: "منصة واحدة لتشغيل محادثات العملاء",
    intro: "وصال ون يجمع الأدوات التي يحتاجها النشاط للرد، المتابعة، المعرفة، المنتجات، الحملات، والتقارير.",
    sections: [
      { title: "صندوق وارد موحد", body: ["إدارة محادثات واتساب، إنستغرام، ماسنجر وتيليجرام في واجهة واحدة مع وسوم وحالات ومهام داخلية."] },
      { title: "وكيل ذكي مساعد", body: ["اقتراح ردود مبنية على ذاكرة المحادثة وقاعدة المعرفة والكتالوج، مع وضع ثقة يمنع الإرسال التلقائي إلا بشروط واضحة."] },
      { title: "كتالوج ومنتجات", body: ["مزامنة قراءة فقط من كتالوج Meta والمنشورات والإعلانات، لتصبح المنتجات قابلة للاسترجاع داخل ردود الوكيل."] },
      { title: "حملات وتحليلات", body: ["قوالب، حملات، أتمتة، وتقارير تساعد صاحب النشاط على فهم الأداء وتحسين سرعة الرد."] },
    ],
  },
  dataDeletion: {
    eyebrow: "حذف البيانات",
    title: "تعليمات حذف بياناتك من وصال ون",
    intro: "توضح هذه الصفحة كيف يمكنك طلب حذف حسابك أو حذف بيانات مساحة العمل أو إزالة بيانات قناة مرتبطة من داخل وصال ون.",
    updated: "آخر تحديث: 29 يونيو 2026",
    sections: [
      {
        title: "ما الذي يمكنك طلب حذفه؟",
        body: ["يمكنك طلب حذف بيانات الحساب، أو مساحة العمل بالكامل، أو بيانات قناة محددة، بما في ذلك المحادثات والمهام والمنتجات والملفات والملاحظات والبيانات التشغيلية المرتبطة بها داخل وصال ون."],
      },
      {
        title: "طريقة طلب الحذف",
        body: ["لطلب الحذف، أرسل رسالة من البريد المرتبط بملكية الحساب أو مساحة العمل إلى البريد الموضح أدناه. نستخدم بيانات الحساب للتحقق من أنك مخول بالطلب قبل التنفيذ."],
        bullets: [
          `البريد: ${SUPPORT_EMAIL}`,
          "عنوان الرسالة المقترح: طلب حذف بيانات وصال ون",
          "اذكر اسم مساحة العمل، البريد المسجل، وهل الطلب يخص الحساب كاملًا أم قناة أو بيانات محددة فقط.",
        ],
      },
      {
        title: "ما الذي يحدث بعد إرسال الطلب؟",
        body: [
          "بعد التحقق من الطلب، نبدأ مراجعة نطاق الحذف المطلوب ثم نحذف البيانات أو نعطلها حسب نوعها وما إذا كانت مرتبطة بمساحة العمل بالكامل أو بجزء محدد منها.",
          "إذا كان الطلب يخص قناة واحدة فقط، نحذف بيانات تلك القناة ونبقي بقية الحساب تعمل بشكل طبيعي ما لم تطلب خلاف ذلك.",
        ],
      },
      {
        title: "مدة المعالجة",
        body: [
          "نبدأ معالجة الطلب بعد التحقق منه. وغالبًا يتم التنفيذ خلال 7 إلى 30 يومًا حسب حجم البيانات ونطاق الطلب.",
          "قد تبقى بعض النسخ الاحتياطية المؤقتة لفترة محدودة إلى أن تكتمل دورة النسخ الاحتياطي، وقد نحتفظ بسجلات محدودة إذا كان ذلك لازمًا للحماية أو الالتزام أو توثيق العمليات.",
        ],
      },
      {
        title: "ماذا يحدث بعد الحذف؟",
        body: [
          "بعد اكتمال الحذف قد تفقد الوصول إلى المحادثات، القنوات، التقارير، الأتمتة، والملفات المرتبطة بالبيانات المحذوفة.",
          "لا يمكن ضمان استعادة البيانات بعد اكتمال الحذف النهائي.",
        ],
      },
    ],
  },
};

const navLinks: Array<[string, string]> = [
  ["المنتجات", "/products"],
  ["من نحن", "/about"],
  ["الخصوصية", "/privacy"],
  ["حذف البيانات", "/data-deletion"],
  ["الشروط", "/terms"],
  ["تواصل معنا", "/contact"],
];

const legalPages = new Set<PageKind>(["privacy", "terms", "dataDeletion"]);

function sectionId(title: string) {
  return `section-${title.replace(/\s+/g, "-").replace(/[^\u0621-\u064Aa-zA-Z0-9-]/g, "").toLowerCase()}`;
}

function PublicLogo({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return <img src="/brand/logo-mark.svg" alt="وصال ون" className="h-9 w-auto" />;
  }

  return (
    <Link href="/" className="inline-flex items-center gap-3">
      <img src="/assets/wesal/wesal-w.png" alt="" className={compact ? "h-10 w-auto" : "h-12 w-auto"} />
      <span className="flex flex-col leading-none">
        <strong className="text-[17px] font-black text-white">وصال ون</strong>
        <span className="mt-1 text-[10px] font-black tracking-[.16em] text-cyan-300">Wesal One</span>
      </span>
    </Link>
  );
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <main dir="rtl" className="wesal-source-page min-h-screen overflow-x-hidden bg-[var(--bg)] text-[var(--fg)]">
      <header className="sticky top-0 z-50 border-b border-line bg-[color-mix(in_srgb,var(--bg)_86%,transparent)] backdrop-blur">
        <div className="container-page flex min-h-20 items-center justify-between gap-4 py-3">
          <PublicLogo />
          <nav className="hidden items-center gap-5 text-sm font-bold text-soft lg:flex">
            {navLinks.map(([label, href]) => <Link key={href} href={href} className="transition hover:text-[var(--fg)]">{label}</Link>)}
          </nav>
          <Link href="/register" className="btn-primary rounded-xl px-5 py-3 text-sm font-black">ابدأ الآن</Link>
        </div>
      </header>
      {children}
      <footer className="footer mt-16">
        <div className="container-page">
          <div className="footer-grid">
            <div>
              <PublicLogo compact />
              <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-soft">منصة عربية لتنظيم محادثات العملاء، القنوات، الفريق، والأتمتة من مكان واحد.</p>
            </div>
            <div>
              <div className="footer-col-title">الصفحات</div>
              <ul className="space-y-2.5">
                {navLinks.slice(0, 4).map(([label, href]) => <li key={href}><Link href={href} className="footer-link">{label}</Link></li>)}
              </ul>
            </div>
            <div>
              <div className="footer-col-title">قانوني</div>
              <ul className="space-y-2.5">
                <li><Link href="/privacy" className="footer-link">سياسة الخصوصية</Link></li>
                <li><Link href="/data-deletion" className="footer-link">حذف البيانات</Link></li>
                <li><Link href="/terms" className="footer-link">شروط الاستخدام</Link></li>
              </ul>
            </div>
            <div>
              <div className="footer-col-title">التواصل</div>
              <ul className="space-y-2.5">
                <li className="footer-contact-item"><span dir="ltr">{SUPPORT_EMAIL}</span></li>
                <li className="footer-contact-item"><span dir="ltr">{SUPPORT_PHONE}</span></li>
                <li className="footer-contact-item"><span>صنعاء، اليمن</span></li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <div>© 2026 وصال ون. جميع الحقوق محفوظة.</div>
            <div className="footer-bottom-links flex flex-wrap items-center gap-2">
              <Link href="/privacy" className="rounded-full border border-line px-3 py-1.5 text-[12px] font-bold text-soft transition hover:border-[var(--secondary)]/40 hover:text-white">الخصوصية</Link>
              <Link href="/data-deletion" className="rounded-full border border-line px-3 py-1.5 text-[12px] font-bold text-soft transition hover:border-[var(--secondary)]/40 hover:text-white">حذف البيانات</Link>
              <Link href="/terms" className="rounded-full border border-line px-3 py-1.5 text-[12px] font-bold text-soft transition hover:border-[var(--secondary)]/40 hover:text-white">الشروط</Link>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}

function ContactFormPreview() {
  return (
    <div className="surface mt-8 rounded-2xl p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <input className="rounded-xl border border-line bg-white/[.03] px-4 py-3 text-sm outline-none" placeholder="الاسم" />
        <input className="rounded-xl border border-line bg-white/[.03] px-4 py-3 text-sm outline-none" placeholder="البريد الإلكتروني" />
        <textarea className="min-h-32 rounded-xl border border-line bg-white/[.03] px-4 py-3 text-sm outline-none md:col-span-2" placeholder="رسالتك" />
      </div>
      <button className="btn-primary mt-4 rounded-xl px-6 py-3 font-black">إرسال الرسالة</button>
    </div>
  );
}

export default function PublicContentPage({ kind }: { kind: PageKind }) {
  const page = pages[kind];
  const isLegalPage = legalPages.has(kind);

  return (
    <PublicShell>
      <section className="relative overflow-hidden py-16 md:py-24">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute right-[-12%] top-[-20%] h-[520px] w-[520px] rounded-full" style={{ background: "radial-gradient(circle, rgba(37,99,235,0.32), transparent 65%)", filter: "blur(80px)" }} />
          <div className="absolute bottom-[-30%] left-[-12%] h-[440px] w-[440px] rounded-full" style={{ background: "radial-gradient(circle, rgba(34,211,238,0.20), transparent 65%)", filter: "blur(90px)" }} />
          <div className="grid-bg absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_80%_70%_at_50%_20%,#000_25%,transparent_80%)]" />
        </div>
        <div className="container-page">
          <p className="text-sm font-black text-[var(--secondary)]">{page.eyebrow}</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black leading-tight md:text-6xl">{page.title}</h1>
          <p className="mt-6 max-w-3xl text-base leading-8 text-soft md:text-lg">{page.intro}</p>
          {page.updated && <p className="mt-4 text-sm font-bold text-mute">{page.updated}</p>}
          {kind === "contact" && <ContactFormPreview />}
        </div>
      </section>

      <section className={`container-page grid gap-5 ${isLegalPage ? "xl:grid-cols-[280px_minmax(0,1fr)]" : "md:grid-cols-2"}`}>
        {isLegalPage && (
          <aside className="surface h-fit rounded-2xl p-5 xl:sticky xl:top-28">
            <p className="text-sm font-black text-[var(--secondary)]">دليل الصفحة</p>
            <p className="mt-2 text-[13px] leading-7 text-soft">يمكنك الانتقال مباشرة إلى القسم الذي تحتاجه ثم العودة لبقية البنود بالترتيب.</p>
            <ol className="mt-4 space-y-2.5">
              {page.sections.map((section, index) => (
                <li key={section.title}>
                  <a
                    href={`#${sectionId(section.title)}`}
                    className="flex items-start gap-3 rounded-xl border border-line/80 bg-white/[0.02] px-3 py-3 text-sm transition hover:border-[var(--secondary)]/40 hover:bg-white/[0.04]"
                  >
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--primary)] text-[11px] font-black text-white">
                      {index + 1}
                    </span>
                    <span className="font-bold text-white">{section.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </aside>
        )}

        <div className={`grid gap-5 ${isLegalPage ? "md:grid-cols-1 xl:grid-cols-2" : "md:grid-cols-2"} ${isLegalPage ? "" : "md:col-span-2"}`}>
          {page.sections.map((section, index) => (
            <article key={section.title} id={sectionId(section.title)} className="surface scroll-mt-28 rounded-2xl p-6">
              <div className="flex items-center gap-3">
                {isLegalPage && (
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_88%,black)] text-sm font-black text-white">
                    {index + 1}
                  </span>
                )}
                <h2 className="text-xl font-black">{section.title}</h2>
              </div>
              <div className="mt-4 space-y-3 text-sm leading-8 text-soft">
                {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
              {section.bullets && (
                <ul className="mt-4 space-y-2.5 text-sm leading-7 text-soft">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2.5">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--secondary)]" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </section>
    </PublicShell>
  );
}
