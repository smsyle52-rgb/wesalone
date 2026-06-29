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
    intro: "توضح هذه السياسة كيف تجمع وصال ون البيانات وتستخدمها وتحميها عند استخدام الموقع، إنشاء الحساب، تسجيل الدخول عبر Google، أو ربط قنوات Meta وWhatsApp وخدمات التواصل.",
    updated: "آخر تحديث: 29 يونيو 2026",
    sections: [
      {
        title: "من نحن ونطاق السياسة",
        body: [
          "وصال ون منصة SaaS لإدارة محادثات العملاء، الفرق، القنوات، المنتجات، الأتمتة، والتقارير. تنطبق هذه السياسة على موقع وصال ون، تطبيق الويب، صفحات التسجيل والدخول، وأي تكامل رسمي يتم ربطه من داخل مساحة العمل.",
          "إذا استخدمت وصال ون نيابة عن شركة أو متجر، فأنت تقر بأنك مخول بإدارة بيانات تلك الجهة وعملائها داخل المنصة.",
        ],
      },
      {
        title: "البيانات التي نجمعها",
        body: ["نجمع فقط البيانات اللازمة لإنشاء الحساب وتشغيل الخدمة وتقديم الدعم وحماية المنصة."],
        bullets: [
          "بيانات الحساب: الاسم، البريد الإلكتروني، رقم الهاتف عند إدخاله، اسم الشركة أو مساحة العمل، حالة التحقق والصلاحيات.",
          "بيانات تسجيل الدخول: جلسات الدخول، ملفات تعريف الارتباط الضرورية، ومعلومات أمان مثل عناوين IP وسجلات الوصول.",
          "بيانات العملاء والمحادثات: الرسائل، معرفات القنوات، أسماء العملاء، أرقام الهاتف أو المعرفات العامة التي تصل من القناة، الوسوم، المهام، الطلبات، والملاحظات التي يدخلها فريقك.",
          "بيانات القنوات والتكاملات: معرفات صفحات أو حسابات Meta/WhatsApp، حالة الربط، صلاحيات الوصول، tokens أو أسرار اتصال مخزنة بشكل آمن لاستخدامها في تشغيل التكامل.",
          "بيانات التشغيل والفوترة: الخطة، حالة الاشتراك، أرصدة نقاط الذكاء، طلبات الدفع، الفواتير أو إثباتات الدفع عند رفعها من المستخدم.",
          "بيانات الدعم: الرسائل التي ترسلها لنا، المرفقات، وملاحظات معالجة طلبات الدعم.",
        ],
      },
      {
        title: "Google Sign-In واستخدام بيانات Google",
        body: [
          "عند اختيار تسجيل الدخول بواسطة Google، نستخدم بيانات Google الأساسية اللازمة للمصادقة فقط، مثل الاسم والبريد الإلكتروني ومعرف الحساب وصورة الملف إن وفرتها Google. نستخدم هذه البيانات لإنشاء حسابك، ربطه بمساحة العمل، التحقق من الهوية، وتأمين الجلسة.",
          "لا نستخدم بيانات Google لأغراض إعلانية، ولا نبيعها، ولا ننقلها لأطراف ثالثة إلا بقدر ما يلزم لتشغيل الخدمة أو الالتزام بالقانون أو بناءً على طلبك.",
        ],
      },
      {
        title: "Meta وWhatsApp والقنوات المتصلة",
        body: [
          "عند ربط قنوات Meta مثل WhatsApp Business أو Instagram أو Messenger، نعالج البيانات اللازمة لإظهار المحادثات، مزامنة حالة القنوات، إرسال الردود التي يطلبها المستخدم، حفظ سجل المحادثة، تشغيل الأتمتة، وإعداد التقارير.",
          "لا نبيع بيانات Meta أو WhatsApp، ولا نستخدمها لإنشاء ملفات إعلانية خارج خدمة وصال ون. استخدام هذه البيانات محدود بتشغيل مساحة عملك، دعمك، تحسين الأمان، وإصلاح الأعطال.",
        ],
      },
      {
        title: "أغراض المعالجة",
        body: ["نستخدم البيانات للأغراض الواضحة والمتوقعة من تشغيل منصة محادثات وأعمال."],
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
          "لا نبيع بياناتك أو بيانات عملائك. قد نشارك بيانات محدودة مع مزودي استضافة، قواعد بيانات، بريد إلكتروني، تحليلات تشغيلية، أو مزودي تكامل فقط بقدر ما يلزم لتقديم الخدمة وحمايتها.",
          "عند استخدام تكامل خارجي مثل Google أو Meta، يخضع استخدامك لذلك التكامل أيضًا لشروط وسياسات المزود الخارجي.",
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
          "لفصل قناة Meta أو WhatsApp: استخدم إعدادات القنوات أو تواصل معنا.",
          "لحذف بياناتك أو بيانات مساحة العمل: استخدم صفحة حذف البيانات أو أرسل طلبًا إلى البريد الموضح أدناه.",
          "لإلغاء الوصول من Google أو Meta: يمكنك أيضًا إدارة الأذونات من حسابك لدى المزود الخارجي.",
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
    intro: "باستخدامك للمنصة، فإنك توافق على هذه الشروط التي تنظّم العلاقة بينك وبين وصال ون أثناء فترة التجربة أو الاشتراك.",
    updated: "آخر تحديث: 29 يونيو 2026",
    sections: [
      { title: "استخدام الخدمة", body: ["يلتزم المستخدم باستخدام المنصة لأغراض تجارية مشروعة، وبإدارة صلاحيات فريقه ومسؤولية المحتوى الذي يرفعه أو يرسله عبر القنوات المرتبطة."] },
      { title: "التكاملات الخارجية", body: ["تعتمد بعض الميزات على مزودين خارجيين مثل Google وMeta. قد تتغير سياسات هذه المزودات أو متطلبات المراجعة، ويلتزم صاحب الحساب بإعداد تطبيقاته وأذوناته بشكل صحيح."] },
      { title: "حدود المسؤولية", body: ["توفر وصال ون أدوات لتنظيم التواصل واقتراح الردود. لا ينبغي الاعتماد على الردود الآلية لاتخاذ قرارات حساسة دون مراجعة بشرية."] },
      { title: "التعديلات", body: ["قد نقوم بتحديث هذه الشروط عند إضافة خدمات جديدة أو تغيّر المتطلبات التشغيلية، وسيتم توفير النسخة الأحدث عبر هذه الصفحة."] },
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
    intro: "هذه الصفحة مخصصة للمستخدمين ومراجعات Google وMeta لتوضيح طريقة طلب حذف الحساب، بيانات مساحة العمل، أو بيانات القنوات المتصلة.",
    updated: "آخر تحديث: 29 يونيو 2026",
    sections: [
      {
        title: "ما الذي يمكنك طلب حذفه؟",
        body: ["يمكنك طلب حذف بيانات الحساب أو مساحة العمل أو القنوات المتصلة، بما في ذلك بيانات محادثات العملاء، معرفات القنوات، ملفات المعرفة، المنتجات، المهام، السجلات التشغيلية غير الملزمة قانونيًا، وأي بيانات دعم مرتبطة بالطلب."],
      },
      {
        title: "طريقة طلب الحذف",
        body: ["لإرسال طلب حذف بيانات، أرسل رسالة من بريد مالك مساحة العمل إلى البريد الموضح أدناه. نستخدم بريد المالك أو معلومات الحساب للتحقق من أنك مخول بطلب الحذف."],
        bullets: [
          `البريد: ${SUPPORT_EMAIL}`,
          "عنوان الرسالة المقترح: طلب حذف بيانات وصال ون",
          "اذكر اسم مساحة العمل، البريد المسجل، القنوات المطلوب حذفها، وهل تريد حذف الحساب كاملًا أو حذف تكامل محدد فقط.",
        ],
      },
      {
        title: "حذف بيانات Meta أو WhatsApp",
        body: [
          "إذا سجّلت الدخول أو ربطت قناة عبر Meta، يمكنك طلب حذف بيانات القناة من وصال ون عبر هذه الصفحة. يمكنك كذلك إزالة صلاحيات التطبيق من إعدادات حسابك لدى Meta.",
          "بعد التحقق من الطلب، نفصل القناة ونحذف أو نعطل البيانات المتزامنة المرتبطة بها من أنظمة وصال ون، ما لم يكن الاحتفاظ ببعض السجلات لازمًا لأسباب قانونية أو أمنية أو محاسبية.",
        ],
      },
      {
        title: "حذف بيانات Google",
        body: [
          "إذا استخدمت Google Sign-In، يمكنك طلب حذف بيانات الحساب المرتبطة بتسجيل الدخول مثل البريد والاسم ومعرف Google المخزن لدينا. يمكنك أيضًا إزالة وصول التطبيق من إعدادات حساب Google لديك.",
        ],
      },
      {
        title: "مدة المعالجة",
        body: [
          "نبدأ مراجعة الطلب بعد استلامه والتحقق من المالك. عادة نعالج الطلب خلال 7 إلى 30 يومًا حسب حجم البيانات ونوع التكاملات المرتبطة.",
          "قد تبقى نسخ احتياطية مؤقتة إلى حين انتهاء دورة النسخ الاحتياطي، وقد نحتفظ بسجلات محدودة إذا كانت مطلوبة للامتثال، منع الاحتيال، حماية الحقوق، أو إثبات عمليات الفوترة.",
        ],
      },
      {
        title: "ماذا يحدث بعد الحذف؟",
        body: [
          "قد تفقد الوصول إلى المحادثات، القنوات، التقارير، الأتمتة، والملفات المرتبطة بالمساحة المحذوفة. لا يمكن ضمان استعادة البيانات بعد إتمام الحذف.",
          "إذا كان الطلب يخص قناة واحدة فقط، سنحذف بيانات تلك القناة ونبقي باقي مساحة العمل تعمل ما لم تطلب خلاف ذلك.",
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

function PublicLogo({ compact = false }: { compact?: boolean }) {
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
            <div className="footer-bottom-links">
              <Link href="/privacy">الخصوصية</Link>
              <span>·</span>
              <Link href="/data-deletion">حذف البيانات</Link>
              <span>·</span>
              <Link href="/terms">الشروط</Link>
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

      <section className="container-page grid gap-5 md:grid-cols-2">
        {page.sections.map((section) => (
          <article key={section.title} className="surface rounded-2xl p-6">
            <h2 className="text-xl font-black">{section.title}</h2>
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
      </section>
    </PublicShell>
  );
}
