import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Globe2,
  Mail,
  Menu,
  MessageCircle,
  Moon,
  ShieldCheck,
  Sun,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import "@/styles/wesal-marketing.css";
import { MarketingLogo } from "./MarketingBrand";
import AgentsHologram from "./AgentsHologram";

type Theme = "dark" | "light";

const navLinks = [
  ["المنصة", "#platform"],
  ["المزايا", "#features"],
  ["الأسعار", "#pricing"],
  ["قصص النجاح", "#stories"],
  ["الموارد", "#resources"],
  ["تواصل معنا", "#contact"],
] as const;

const platformTabs = ["صندوق الوارد", "الفريق", "التقارير", "الأتمتة"];

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return localStorage.getItem("wesal-theme") === "light" ? "light" : "dark";
}

function useRevealAnimation() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("is-visible");
        });
      },
      { threshold: 0.14 },
    );

    document
      .querySelectorAll(".wesal-public .reveal")
      .forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, []);
}

function Header({
  theme,
  onToggleTheme,
}: {
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <header className="marketing-header">
      <div className="marketing-shell marketing-header-inner">
        <a href="#home" aria-label="وصال ون" className="brand-link">
          <MarketingLogo compact />
        </a>

        <nav className="desktop-nav" aria-label="التنقل الرئيسي">
          {navLinks.map(([label, href]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
        </nav>

        <div className="header-actions">
          <button
            type="button"
            className="ghost-icon"
            onClick={onToggleTheme}
            aria-label="تغيير المظهر"
          >
            {theme === "dark" ? <Moon /> : <Sun />}
          </button>
          <button type="button" className="language-button" aria-label="اللغة">
            <span>EN</span>
            <Globe2 />
          </button>
          <a href="/register" className="primary-button header-cta">
            ابدأ الآن
          </a>
          <button
            type="button"
            className="mobile-menu-button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label="فتح القائمة"
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="marketing-shell mobile-nav">
          {navLinks.map(([label, href]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
          <a href="/login" onClick={() => setOpen(false)}>
            تسجيل الدخول
          </a>
          <a
            className="primary-button"
            href="/register"
            onClick={() => setOpen(false)}
          >
            ابدأ الآن
          </a>
        </div>
      ) : null}
    </header>
  );
}

function HeroKicker() {
  return (
    <div className="hero-kicker">
      <span>+</span>
      منصة ذكاء اصطناعي لإدارة أعمالك ونموك
    </div>
  );
}

function HeroCopy() {
  return (
    <div className="hero-copy reveal">
      <HeroKicker />
      <h1>
        وكلاء ذكاء اصطناعي
        <br />
        يديرون <span>أعمالك</span>
        <br />
        باحتراف
      </h1>
      <p>
        وصال ون. منصة سهلة الاستخدام توحّد تواصل العملاء، وتدير الردود، وتسرّع
        المبيعات وخدمة العملاء من مكان واحد. ابدأ الربط والتشغيل خلال دقائق،
        واترك للوكلاء الأذكياء إدارة المهام المتكررة ومساعدة فريقك بكفاءة أعلى.
      </p>
      <div className="hero-actions">
        <a href="/register" className="primary-button large">
          ابدأ الآن
          <ArrowLeft />
        </a>
        <a href="#contact" className="secondary-button large">
          اطلب عرضاً تجريبياً
          <CalendarDays />
        </a>
      </div>
      <div className="trial-note">
        ربط وتشغيل خلال دقائق · تجربة مجانية 14 يوم
      </div>
    </div>
  );
}

function ConnectedBusinessCard() {
  return (
    <div className="floating-panel connected-card">
      <div className="panel-infinity">∞</div>
      <strong>منصة أعمال متصلة</strong>
      <p>إدارة المحادثات والعمليات من قنواتك المفضلة</p>
      <div className="channel-row">
        {[
          ["واتساب", "wa"],
          ["إنستغرام", "ig"],
          ["ماسنجر", "ms"],
          ["تيليجرام", "tg"],
        ].map(([label, type]) => (
          <span key={label} className={`channel-dot ${type}`}>
            {label.slice(0, 1)}
          </span>
        ))}
      </div>
    </div>
  );
}

function InboxPanel() {
  const rows = [
    ["2m", "شركة النور", "تم استلام الطلب بنجاح", "wa"],
    ["5m", "متجر القمة", "هل المنتج متوفر؟", "ig"],
    ["7m", "مؤسسة الرؤية", "أرسلوا لنا التفاصيل", "ms"],
    ["13m", "حلول الأعمال", "شكراً على المتابعة", "tg"],
  ];

  return (
    <div className="floating-panel inbox-card">
      <strong>صندوق وارد موحّد</strong>
      {rows.map(([time, name, text, type]) => (
        <div key={name} className="mini-conversation">
          <span>{time}</span>
          <div>
            <b>{name}</b>
            <small>{text}</small>
          </div>
          <i className={`channel-dot ${type}`}>{name.slice(0, 1)}</i>
        </div>
      ))}
      <a href="#platform">عرض جميع المحادثات ←</a>
    </div>
  );
}

function PerformancePanel() {
  return (
    <div className="floating-panel performance-card">
      <strong>أداء الأذكياء</strong>
      <div className="performance-grid">
        <div className="ring">جاهز</div>
        <div className="chart-line">
          {[30, 43, 39, 58, 53, 70, 86].map((height, index) => (
            <span key={index} style={{ height: `${height}%` }} />
          ))}
        </div>
      </div>
      <small>تحسّن هذا الأسبوع ↗</small>
    </div>
  );
}

function SmartTasksPanel() {
  const tasks = [
    "رد على الاستفسارات",
    "تحديث حالة الطلبات",
    "متابعة العملاء المحتملين",
  ];

  return (
    <div className="floating-panel tasks-card">
      <strong>المهام الذكية</strong>
      {tasks.map((task, index) => (
        <div key={task} className="task-row">
          <span className={index < 2 ? "checked" : ""}>
            {index < 2 ? <Check /> : null}
          </span>
          {task}
        </div>
      ))}
    </div>
  );
}

function HeroVisual() {
  return (
    <div className="hero-visual reveal">
      <ConnectedBusinessCard />
      <InboxPanel />
      <AgentsHologram />
      <PerformancePanel />
      <SmartTasksPanel />
    </div>
  );
}

function HeroStats() {
  const stats = [
    [ShieldCheck, "أمان وخصوصية", "بمعايير عالمية متقدمة"],
    [MessageCircle, "محادثات موحّدة", "كل القنوات في مكان واحد"],
    [UsersRound, "فرق منظمة", "تحويل ومتابعة واضحة"],
    [Clock3, "تشغيل مستمر", "جاهزية أعلى لفريقك"],
  ] as const;

  return (
    <div className="hero-stats reveal" aria-label="مزايا وصال ون">
      {stats.map(([Icon, title, subtitle]) => (
        <div key={title} className="hero-stat">
          <span>
            <Icon />
          </span>
          <div>
            <strong>{title}</strong>
            <small>{subtitle}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function HeroSection() {
  return (
    <section id="home" className="hero-section">
      <div className="hero-glow" />
      <div className="marketing-shell hero-grid">
        <HeroVisual />
        <HeroCopy />
      </div>
      <div className="marketing-shell">
        <HeroStats />
      </div>
    </section>
  );
}

function PlatformPreview() {
  const conversations = [
    ["عميل واتساب", "مرحباً، أريد معرفة حالة الطلب؟", "جديد", "wa"],
    ["متجر الخليج", "تم تحديث حالة الشحن", "مفتوح", "ms"],
    ["عميل إنستغرام", "هل المنتج متوفر؟", "تحتاج رد", "ig"],
    ["استفسار توصيل", "أحتاج تعديل العنوان", "متابع", "tg"],
  ];

  return (
    <div className="platform-window reveal">
      <div className="window-top">
        <div>
          <span />
          <span />
          <span />
        </div>
        <strong>وصال ون - صندوق الوارد</strong>
      </div>
      <div className="window-body">
        <aside className="window-side">
          <div className="avatar-lg">ع</div>
          <strong>عميل واتساب</strong>
          <small>نشط الآن</small>
          <dl>
            <div>
              <dt>القناة</dt>
              <dd>WhatsApp</dd>
            </div>
            <div>
              <dt>آخر طلب</dt>
              <dd>#1842</dd>
            </div>
          </dl>
          <button type="button">تحويل للفريق</button>
        </aside>
        <main className="chat-preview">
          <div className="chat-header">عميل واتساب · نشط الآن</div>
          <p className="bubble customer">مرحبا، أريد معرفة حالة الشحن</p>
          <p className="bubble agent">
            أهلاً بك، طلبك قيد التجهيز وسيتم تحديثك خلال يوم عمل.
          </p>
          <p className="bubble customer">ممتاز شكراً لكم 🙏</p>
          <div className="suggested-reply">
            <strong>رد ذكي مقترح</strong>
            <span>الطلب قيد التوصيل وسيصلك اليوم قبل المغرب.</span>
            <button type="button">استخدام الرد</button>
          </div>
        </main>
        <aside className="conversation-list">
          <label>ابحث في المحادثات</label>
          {conversations.map(([name, text, status, type]) => (
            <div key={name} className="conversation-row">
              <i className={`channel-dot ${type}`}>{name.slice(0, 1)}</i>
              <div>
                <strong>{name}</strong>
                <small>{text}</small>
              </div>
              <span>{status}</span>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

function PlatformSection() {
  return (
    <section id="platform" className="platform-section section-band">
      <div className="marketing-shell">
        <div className="section-heading reveal">
          <h2>
            نظرة على <span>منصة وصال ون</span>
          </h2>
          <p>صندوق وارد، فريق، تقارير وأتمتة في تجربة عربية واحدة سلسة.</p>
          <div className="tabs-row">
            {platformTabs.map((tab, index) => (
              <button
                key={tab}
                className={index === 0 ? "active" : ""}
                type="button"
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
        <PlatformPreview />
      </div>
    </section>
  );
}

function UnifiedInboxSection() {
  const benefits = [
    "جميع القنوات في مكان واحد",
    "فرز ذكي حسب الأولوية",
    "متابعة المحادثات بدون ضياع",
  ];

  return (
    <section id="features" className="inbox-section section-band">
      <div className="marketing-shell split-section">
        <div className="inbox-list-card reveal">
          <div className="card-title">
            <span>مزامنة حية</span>
            <b>صندوق الوارد</b>
          </div>
          <div className="filter-pills">
            {["الكل", "WhatsApp", "Instagram", "Messenger", "Telegram"].map(
              (item, index) => (
                <button
                  key={item}
                  type="button"
                  className={index === 0 ? "active" : ""}
                >
                  {item}
                </button>
              ),
            )}
          </div>
          {[
            ["عميل واتساب", "متى يتم توصيل الطلب؟", "جديد", "wa"],
            ["متجر الخليج", "تم تحديث حالة الشحن", "مفتوح", "ms"],
            ["عميل انستغرام", "هل المنتج متوفر؟", "تحتاج رد", "ig"],
            ["استفسار توصيل", "أحتاج تعديل العنوان", "متابع", "tg"],
          ].map(([name, text, status, type]) => (
            <div key={name} className="large-conversation-row">
              <span className={`channel-dot ${type}`}>{name.slice(0, 1)}</span>
              <div>
                <strong>{name}</strong>
                <small>{text}</small>
              </div>
              <em>{status}</em>
            </div>
          ))}
        </div>

        <div className="section-copy reveal">
          <span className="eyebrow">تواصل · COMMUNICATE</span>
          <h2>صندوق وارد موحّد لكل قنواتك</h2>
          <p>
            اجمع محادثات واتساب، إنستغرام، ماسنجر وتيليجرام في واجهة واحدة،
            ورتبها حسب القناة، الحالة، والأولوية.
          </p>
          <ul>
            {benefits.map((benefit) => (
              <li key={benefit}>
                <Check />
                {benefit}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function AutomationSection() {
  return (
    <section id="how" className="automation-section section-band">
      <div className="marketing-shell split-section reverse">
        <div className="section-copy reveal">
          <span className="eyebrow purple">ACT · نفّذ</span>
          <h2>حوّل المحادثات إلى إجراءات تلقائية</h2>
          <p>
            أنشئ مسارات ذكية تبدأ من رسالة العميل وتنتهي بإجراء واضح: رد جاهز،
            وسم، تحويل للفريق، أو إنشاء مهمة متابعة.
          </p>
          <ul>
            {[
              "تشغيل تلقائي حسب كلمات العميل",
              "تحويل المحادثات للفريق المناسب",
              "تحديث الحالة دون تداخل",
            ].map((item) => (
              <li key={item}>
                <Check />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="workflow-card reveal">
          <div className="workflow-top">
            <strong>مسار التشغيل التلقائي</strong>
            <span>مقال</span>
            <Zap />
          </div>
          <div className="workflow-steps">
            {[
              ["الخطوة 1", "رسالة واردة", "أحتاج تعديل عنوان التوصيل", "wa"],
              ["الخطوة 2", "تحليل النية", "نية العميل: تعديل طلب", "ai"],
              ["الخطوة 3", "وسم ذكي", "توصيل · طلب نشط", "tag"],
            ].map(([step, title, text, type]) => (
              <div key={step} className="workflow-step">
                <span>{step}</span>
                <strong>{title}</strong>
                <small>{text}</small>
                <i>{type}</i>
              </div>
            ))}
          </div>
          <div className="workflow-result">
            <strong>نتيجة التنفيذ</strong>
            <p>تم تحويل المحادثة · تم إنشاء مهمة · تم تحديث حالة العميل</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalSections() {
  return (
    <section id="pricing" className="closing-section section-band">
      <div className="marketing-shell closing-card reveal">
        <span className="eyebrow">ابدأ بوضوح</span>
        <h2>منصة عربية جاهزة لتشغيل محادثات البيع والخدمة</h2>
        <p>
          اربط قنواتك، جهّز فريقك، وشغّل وكلاء وصال ون مع تحكم كامل في كل خطوة.
        </p>
        <div className="closing-actions">
          <a href="/register" className="primary-button large">
            ابدأ الآن
            <ArrowLeft />
          </a>
          <a href="/login" className="secondary-button large">
            تسجيل الدخول
          </a>
        </div>
      </div>
    </section>
  );
}

export default function WesalMarketingPage() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  useRevealAnimation();

  useEffect(() => {
    localStorage.setItem("wesal-theme", theme);
  }, [theme]);

  return (
    <div className={`wesal-public ${theme}`} dir="rtl">
      <Header
        theme={theme}
        onToggleTheme={() =>
          setTheme((value) => (value === "dark" ? "light" : "dark"))
        }
      />
      <main>
        <HeroSection />
        <PlatformSection />
        <UnifiedInboxSection />
        <AutomationSection />
        <FinalSections />
      </main>
      <footer className="marketing-footer" id="contact">
        <div className="marketing-shell">
          <MarketingLogo compact />
          <div>
            <a href="mailto:hello@wesal.one">
              <Mail />
              hello@wesal.one
            </a>
            <button type="button">
              المزيد
              <ChevronDown />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
