// @ts-nocheck
import * as React from "react";
import "@/styles/wesal-marketing.css";

// BrandMark — شارة دائرية زجاجية بحرف W ذي ثلاث شرائح مصمتة (مطابق لشعار وصال ون)
// كرة كحلية ثلاثية الأبعاد + أقواس زرقاء + لمعان، وحرف W بتدرّج تركوازي→أزرق.

function BrandMark({ size = 44, mono = false }) {
  const id = React.useId().replace(/:/g, "");
  const sphere = `sp-${id}`, rim = `rm-${id}`, band = `bn-${id}`,
        topg = `tg-${id}`, botg = `bg-${id}`, wf = `wf-${id}`, wf2 = `wf2-${id}`,
        clip = `cl-${id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" style={{ display: "block" }}>
      <defs>
        <radialGradient id={sphere} cx="42%" cy="32%" r="78%">
          <stop offset="0%" stopColor={mono ? "#2A3550" : "#1A4178"} />
          <stop offset="45%" stopColor={mono ? "#161E33" : "#0E2A52"} />
          <stop offset="100%" stopColor={mono ? "#0A0F1C" : "#04122B"} />
        </radialGradient>
        <radialGradient id={rim} cx="50%" cy="50%" r="50%">
          <stop offset="88%" stopColor="#2563EB" stopOpacity="0" />
          <stop offset="97%" stopColor="#4D80FF" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#22D3EE" stopOpacity="0.4" />
        </radialGradient>
        <linearGradient id={band} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#1E3A8A" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={topg} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#BAE6FD" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#BAE6FD" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={botg} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#22D3EE" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={wf} x1="0.3" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor={mono ? "#F1F5F9" : "#A5F3FC"} />
          <stop offset="45%" stopColor={mono ? "#CBD5E1" : "#34D7EE"} />
          <stop offset="100%" stopColor={mono ? "#94A3B8" : "#1FA9D8"} />
        </linearGradient>
        <linearGradient id={wf2} x1="0.3" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor={mono ? "#E2E8F0" : "#7DD3FC"} />
          <stop offset="55%" stopColor={mono ? "#B6C2D1" : "#2BB7E6"} />
          <stop offset="100%" stopColor={mono ? "#7C8AA0" : "#1690C8"} />
        </linearGradient>
        <clipPath id={clip}><circle cx="60" cy="60" r="57" /></clipPath>
      </defs>

      <circle cx="60" cy="60" r="57" fill={`url(#${sphere})`} />
      <g clipPath={`url(#${clip})`}>
        <path d="M-10 78 Q40 58 130 92" fill="none" stroke={`url(#${band})`} strokeWidth="3.5" opacity="0.7" />
        <path d="M-10 96 Q55 70 130 104" fill="none" stroke={`url(#${band})`} strokeWidth="4" opacity="0.55" />
        <path d="M-10 40 Q60 30 130 52" fill="none" stroke={`url(#${band})`} strokeWidth="2.5" opacity="0.4" />
        <ellipse cx="58" cy="30" rx="44" ry="24" fill={`url(#${topg})`} />
        <ellipse cx="60" cy="80" rx="26" ry="10" fill={`url(#${botg})`} opacity="0.6" />
      </g>
      <circle cx="60" cy="60" r="57" fill={`url(#${rim})`} />

      <g strokeLinejoin="round" strokeLinecap="round">
        <path d="M31 39 L48 35 L47 83 Z" fill={`url(#${wf})`} stroke={`url(#${wf})`} strokeWidth="9" />
        <path d="M57 35 L74 39 L64 83 Z" fill={`url(#${wf2})`} stroke={`url(#${wf2})`} strokeWidth="9" />
        <path d="M80 38 L94 42 L88 65 Z" fill={`url(#${wf})`} stroke={`url(#${wf})`} strokeWidth="8" />
      </g>
    </svg>
  );
}

function BrandLogo({ variant = "horizontal", size = 44, mono = false, tone = "auto", className = "" }) {
  // الأصل الرسمي للشعار — الصورة المرجعية نفسها
  const FULL = "/assets/wesal/wesal-logo.png";   // الشارة الدائرية الكاملة (بداخلها الاسم)
  const MARK = "/assets/wesal/wesal-mark.png";    // حرف W فقط (للأيقونات والـ favicon)

  // أيقونة دائرية (حرف W فقط)
  if (variant === "icon") {
    return (
      <img
        src={MARK}
        alt="وصال ون"
        width={size}
        height={size}
        className={className}
        style={{ width: size, height: size, objectFit: "cover", borderRadius: "50%", display: "block" }}
      />
    );
  }

  // أيقونة تطبيق (حرف W داخل مربّع بزوايا)
  if (variant === "appIcon") {
    return (
      <img
        src={MARK}
        alt="وصال ون"
        width={size}
        height={size}
        className={className}
        style={{ width: size, height: size, objectFit: "cover", borderRadius: size * 0.22, display: "block", boxShadow: "0 6px 18px rgba(8,17,39,0.35)" }}
      />
    );
  }

  // horizontal / compact → الشارة الدائرية الكاملة (الاسم مضمّن داخلها)
  return (
    <img
      src={FULL}
      alt="وصال ون — Wesal One"
      className={className}
      style={{ height: size, width: "auto", objectFit: "contain", display: "block" }}
    />
  );
}

// ChannelIcons — أيقونات القنوات الأربعة بألوانها الحقيقية، SVG inline (بدون صور خارجية)
// تستخدم للهيرو وأسفل dashboard

function WhatsAppIcon({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#25D366" />
      <path
        d="M16 7.3c-4.8 0-8.7 3.9-8.7 8.7 0 1.54.4 3 1.16 4.3L7.3 24.7l4.55-1.19c1.26.69 2.69 1.05 4.15 1.05 4.8 0 8.7-3.9 8.7-8.7S20.8 7.3 16 7.3z"
        fill="#fff"
      />
      <path
        d="M20.66 18.06c-.25-.13-1.49-.74-1.72-.82-.23-.08-.4-.13-.57.13-.16.25-.65.82-.8.99-.15.16-.29.18-.54.06-.25-.13-1.06-.39-2.02-1.25-.75-.66-1.25-1.49-1.4-1.74-.15-.25-.02-.39.11-.51.11-.11.25-.29.38-.44.12-.15.16-.25.25-.42.08-.16.04-.31-.02-.44-.06-.13-.57-1.37-.78-1.87-.2-.49-.41-.42-.57-.43-.15-.01-.31-.01-.48-.01-.16 0-.44.06-.66.31-.23.25-.87.85-.87 2.08 0 1.23.89 2.41 1.02 2.58.13.16 1.75 2.67 4.24 3.75.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.49-.61 1.7-1.2.21-.59.21-1.09.15-1.2-.06-.11-.23-.18-.48-.31z"
        fill="#25D366"
      />
    </svg>
  );
}

function InstagramIcon({ size = 28 }) {
  const id = React.useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={`ig-${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#F58529" />
          <stop offset="35%" stopColor="#DD2A7B" />
          <stop offset="70%" stopColor="#8134AF" />
          <stop offset="100%" stopColor="#515BD4" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="32" height="32" rx="9" fill={`url(#ig-${id})`} />
      <rect x="8" y="8" width="16" height="16" rx="5" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="16" cy="16" r="3.6" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="21.2" cy="10.8" r="1.1" fill="#fff" />
    </svg>
  );
}

function MessengerIcon({ size = 28 }) {
  const id = React.useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={`mg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00B2FF" />
          <stop offset="100%" stopColor="#006AFF" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill={`url(#mg-${id})`} />
      <path
        d="M16 6.5c-5.5 0-9.8 4-9.8 9.1 0 2.9 1.4 5.4 3.6 7.1v3.5l3.3-1.8c.9.3 1.9.4 2.9.4 5.5 0 9.8-4 9.8-9.1S21.5 6.5 16 6.5zm1 12.3l-2.5-2.6-4.9 2.6L15.4 13l2.5 2.6L22.8 13l-5.8 5.8z"
        fill="#fff"
      />
    </svg>
  );
}

function TelegramIcon({ size = 28 }) {
  const id = React.useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={`tg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2AABEE" />
          <stop offset="100%" stopColor="#229ED9" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill={`url(#tg-${id})`} />
      <path
        d="M7.7 15.6l16-6.2c.7-.3 1.4.2 1.2 1l-2.7 12.8c-.2.7-.6.9-1.3.6L17 21.1l-1.9 1.8c-.2.2-.4.4-.8.4l.3-4.2 7.6-6.9c.3-.3-.1-.5-.5-.2l-9.4 5.9-4-1.3c-.9-.3-.9-.9.4-1z"
        fill="#fff"
      />
    </svg>
  );
}

function ChannelIcons({ animated = true, size = 56, withLabels = false }) {
  const items = [
    { Comp: WhatsAppIcon,   name: "WhatsApp"  },
    { Comp: InstagramIcon,  name: "Instagram" },
    { Comp: MessengerIcon,  name: "Messenger" },
    { Comp: TelegramIcon,   name: "Telegram"  },
  ];
  return (
    <div className="flex items-center justify-center gap-5 sm:gap-7 flex-wrap" dir="ltr">
      {items.map((it, i) => (
        <div
          key={it.name}
          className="flex flex-col items-center gap-2"
        >
          <div
            className={`relative grid place-items-center rounded-2xl bg-white shadow-[0_10px_30px_-12px_rgba(20,55,170,0.35)] ring-1 ring-blue-100 ${animated ? "channel-float" : ""}`}
            style={{
              width: size,
              height: size,
              animationDelay: `${i * 0.45}s`,
            }}
          >
            <it.Comp size={size * 0.62} />
            {animated && (
              <span
                className="absolute inset-0 rounded-2xl channel-ping pointer-events-none"
                style={{ animationDelay: `${i * 0.9}s` }}
              />
            )}
          </div>
          {withLabels && (
            <span className="text-xs text-slate-500 font-medium">{it.name}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// gabster-mini-ui.jsx — واجهات UI مصغّرة حقيقية لكل قسم ميزة
// تستخدم داخل Pillar بدلاً من أيقونة كبيرة وحدها.

// مساعد: شارة قناة دائرية صغيرة
function ChBadge({ kind, size = 14 }) {
  const map = {
    wa: { bg: "#25D366", l: "W" },
    ig: { bg: "linear-gradient(135deg,#F58529,#DD2A7B,#515BD4)", l: "I" },
    mg: { bg: "#0084FF", l: "M" },
    tg: { bg: "#2AABEE", l: "T" },
  };
  const c = map[kind] || map.wa;
  return (
    <span className="grid place-items-center rounded-full text-white font-bold ring-2"
      style={{ width: size, height: size, background: c.bg, fontSize: size * 0.55, ringColor: "var(--card)" }}>
      {c.l}
    </span>
  );
}

// ============ 1) صندوق الوارد الموحد — Mini Inbox غني ============
function MiniUIInbox() {
  const tabs = [
    { id: "all", l: "الكل",      count: 24 },
    { id: "wa",  l: "WhatsApp",  count: 12 },
    { id: "ig",  l: "Instagram", count: 6  },
    { id: "mg",  l: "Messenger", count: 4  },
    { id: "tg",  l: "Telegram",  count: 2  },
  ];
  const [tab, setTab] = React.useState("all");

  const allRows = [
    { ch: "wa", n: "عميل واتساب",    m: "متى يتم توصيل الطلب؟",              t: "11:42", u: 2, c: "#25D366", status: "جديد",      sCol: "var(--secondary)", active: true },
    { ch: "wa", n: "متجر الخليج",     m: "تم تحديث حالة الشحن",                t: "11:18",       c: "#1B5CE8", status: "مفتوحة",   sCol: "var(--primary-hi)" },
    { ch: "ig", n: "عميل إنستغرام",   m: "هل المنتج متوفر؟",                  t: "10:50", u: 1, c: "#DD2A7B", status: "تحتاج رد", sCol: "#F59E0B" },
    { ch: "tg", n: "استفسار توصيل",   m: "أحتاج تعديل العنوان",                t: "10:21",       c: "#2AABEE", status: "متابعة",    sCol: "#8B5CF6" },
  ];
  const rows = tab === "all" ? allRows : allRows.filter((r) => r.ch === tab);

  return (
    <div className="mini-inbox-card relative" dir="rtl">
      {/* glow ناعم خلف الواجهة */}
      <div className="absolute -inset-6 -z-10 pointer-events-none" style={{
        background: "radial-gradient(50% 50% at 50% 30%, color-mix(in srgb, var(--primary) 25%, transparent), transparent 70%)",
        filter: "blur(40px)",
      }} />

      {/* شريط علوي */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: "color-mix(in srgb, var(--primary) 18%, transparent)", color: "var(--primary-hi)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 13l3-8h10l3 8"/><path d="M4 13v6h16v-6"/><path d="M4 13h5l1 2h4l1-2h5"/></svg>
          </div>
          <div className="text-[12.5px] font-extrabold">صندوق الوارد</div>
          <span className="text-[9.5px] font-extrabold text-white px-1.5 py-0.5 rounded-full" style={{ background: "var(--primary)" }}>24</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-mute">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--secondary)", boxShadow: "0 0 8px var(--secondary)" }}></span>
          مزامنة حيّة
        </div>
      </div>

      {/* Tabs قنوات */}
      <div className="mini-inbox-tabs flex items-center gap-1 px-3 py-2.5 border-b overflow-x-auto" style={{ borderColor: "var(--line)" }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition whitespace-nowrap ${active ? "text-white" : "text-soft hover:bg-white/[0.04]"}`}
              style={active ? { background: "var(--primary)" } : { border: "1px solid var(--line)" }}>
              {t.l}
              <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full" style={{ background: active ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.06)" }}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {/* قائمة المحادثات */}
      <div className="divide-y" style={{ "--tw-divide-opacity": 1 }}>
        {rows.map((r, i) => {
          const isActive = r.active;
          return (
            <div key={i} className="inbox-row flex items-start gap-2.5 px-4 py-3 cursor-pointer"
              style={{
                borderInlineStartWidth: isActive ? 3 : 0,
                borderInlineStartStyle: "solid",
                borderInlineStartColor: isActive ? "var(--primary-hi)" : "transparent",
                background: isActive ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "transparent",
                borderBottom: i < rows.length - 1 ? "1px solid var(--line)" : "none",
                animation: `fade-up .55s cubic-bezier(.22,1,.36,1) ${0.08 * i}s both`,
              }}>
              <div className="relative shrink-0">
                <div className="w-9 h-9 rounded-full grid place-items-center text-white text-[12px] font-extrabold" style={{ background: r.c }}>
                  {r.n.charAt(0)}
                </div>
                <div className="absolute -bottom-0.5 -start-0.5"><ChBadge kind={r.ch} size={14} /></div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-extrabold truncate">{r.n}</span>
                  <span className="text-[9.5px] text-mute shrink-0">{r.t}</span>
                </div>
                <p className="text-[11px] text-soft truncate mt-0.5">{r.m}</p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: `color-mix(in srgb, ${r.sCol} 14%, transparent)`, color: r.sCol }}>
                    <span className="w-1 h-1 rounded-full" style={{ background: r.sCol }}></span>
                    {r.status}
                  </span>
                </div>
              </div>
              {r.u && <span className="text-[9.5px] font-extrabold text-white rounded-full px-1.5 py-0.5 shrink-0 mt-1" style={{ background: "var(--secondary)" }}>{r.u}</span>}
            </div>
          );
        })}
      </div>

      {/* بطاقة فرز ذكي */}
      <div className="m-3 p-3 rounded-xl" style={{ background: "color-mix(in srgb, var(--secondary) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--secondary) 28%, transparent)" }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: "color-mix(in srgb, var(--secondary) 22%, transparent)", color: "var(--secondary)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>
            </span>
            <div className="leading-tight">
              <div className="text-[11.5px] font-extrabold">فرز ذكي</div>
              <div className="text-[10px] text-soft">تم رفع أولوية <span className="font-bold" style={{ color: "var(--secondary)" }}>8 محادثات</span> تحتاج رد سريع</div>
            </div>
          </div>
          <button className="text-[10px] font-extrabold px-2.5 py-1.5 rounded-md text-white shrink-0" style={{ background: "var(--primary)" }}>عرض</button>
        </div>
      </div>
    </div>
  );
}

// ============ 2) فريق ومهام — Operations Board (Kanban) ============
function MiniUITeam() {
  const cols = [
    { id: "new",  l: "جديد",           c: "var(--secondary)" },
    { id: "wip",  l: "قيد المعالجة",  c: "var(--primary-hi)" },
    { id: "wait", l: "بانتظار العميل", c: "#F59E0B" },
    { id: "done", l: "مكتمل",          c: "#10B981" },
  ];

  const tasks = {
    new: [
      { ch: "wa", title: "محادثة واتساب — تحتاج رد سريع", priority: "عالية", priCol: "#EF4444", assignee: "عضو الدعم 1", sla: "متبقي 12د" },
      { ch: "ig", title: "إنستغرام — سؤال عن التوفر",     priority: "متوسطة", priCol: "#F59E0B", assignee: "فريق المبيعات", sla: "متبقي 28د" },
    ],
    wip: [
      { ch: "wa", title: "طلب #1842 — استفسار توصيل",     priority: "عالية", priCol: "#EF4444", assignee: "فريق الشحن", sla: "متبقي 8د" },
      { ch: "mg", title: "متجر الخليج — متابعة شحن",       priority: "متوسطة", priCol: "#F59E0B", assignee: "عضو الدعم 2", sla: "متبقي 45د" },
    ],
    wait: [
      { ch: "tg", title: "تعديل عنوان الطلب",              priority: "منخفضة", priCol: "var(--secondary)", assignee: "فريق الشحن", sla: "بانتظار رد" },
    ],
    done: [
      { ch: "ig", title: "استفسار سعر الجملة",             priority: "متوسطة", priCol: "#F59E0B", assignee: "فريق المبيعات", sla: "أُغلق ✓" },
    ],
  };

  return (
    <div className="operations-board relative" dir="rtl">
      {/* glow خلف الواجهة */}
      <div className="absolute -inset-6 -z-10 pointer-events-none" style={{
        background: "radial-gradient(50% 50% at 50% 30%, color-mix(in srgb, var(--primary) 25%, transparent), transparent 70%)",
        filter: "blur(40px)",
      }} />

      {/* شريط علوي */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: "color-mix(in srgb, var(--primary) 18%, transparent)", color: "var(--primary-hi)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="8" r="2.2"/></svg>
          </div>
          <div className="text-[12.5px] font-extrabold">لوحة التشغيل</div>
          <span className="text-[9.5px] font-extrabold text-white px-1.5 py-0.5 rounded-full" style={{ background: "var(--primary)" }}>12 مهمة نشطة</span>
        </div>
        <button className="inline-flex items-center gap-1.5 text-[10.5px] font-extrabold px-3 py-1.5 rounded-lg text-white" style={{ background: "linear-gradient(135deg, var(--primary), var(--secondary))" }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>
          توزيع تلقائي
        </button>
      </div>

      {/* Kanban */}
      <div className="kanban-grid p-3 gap-2.5">
        {cols.map((col) => (
          <div key={col.id} className="rounded-xl p-2.5 flex flex-col gap-2" style={{ background: "rgba(0,0,0,0.18)", border: "1px solid var(--line)" }}>
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: col.c, boxShadow: `0 0 8px ${col.c}` }}></span>
                <span className="text-[10.5px] font-extrabold">{col.l}</span>
              </div>
              <span className="text-[9.5px] text-mute font-bold">{tasks[col.id].length}</span>
            </div>

            {tasks[col.id].map((t, i) => (
              <div key={i} className="task-card p-2.5 rounded-lg cursor-pointer"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--line)",
                  animation: `fade-up .55s cubic-bezier(.22,1,.36,1) ${0.06 * i}s both`,
                }}>
                <div className="flex items-center justify-between mb-1.5">
                  <ChBadge kind={t.ch} size={14}/>
                  <span className="inline-flex items-center gap-1 text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-md"
                    style={{ background: `color-mix(in srgb, ${t.priCol} 16%, transparent)`, color: t.priCol }}>
                    <span className="w-1 h-1 rounded-full" style={{ background: t.priCol }}></span>
                    {t.priority}
                  </span>
                </div>

                <p className="text-[10.5px] font-bold leading-tight line-clamp-2 mb-2">{t.title}</p>

                <div className="flex items-center justify-between gap-1 pt-2 border-t" style={{ borderColor: "var(--line)" }}>
                  <div className="flex items-center gap-1 min-w-0">
                    <div className="w-4 h-4 rounded-full grid place-items-center text-white text-[7px] font-extrabold shrink-0" style={{ background: "linear-gradient(135deg, var(--primary), var(--secondary))" }}>ع</div>
                    <span className="text-[9px] text-soft truncate">{t.assignee}</span>
                  </div>
                  <span className="text-[8.5px] font-bold shrink-0 flex items-center gap-0.5" style={{ color: t.sla.includes("12") || t.sla.includes("8د") ? "#EF4444" : "var(--fg-mute)" }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                    {t.sla}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* بطاقة اقتراح توزيع */}
      <div className="m-3 mt-0 p-3 rounded-xl" style={{ background: "color-mix(in srgb, var(--secondary) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--secondary) 28%, transparent)" }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0" style={{ background: "color-mix(in srgb, var(--secondary) 22%, transparent)", color: "var(--secondary)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>
            </span>
            <div className="leading-tight min-w-0">
              <div className="text-[11.5px] font-extrabold">اقتراح توزيع</div>
              <div className="text-[10px] text-soft">تحويل <span className="font-bold" style={{ color: "var(--secondary)" }}>5 محادثات</span> إلى فريق الشحن (كلمات: توصيل، شحن، عنوان)</div>
            </div>
          </div>
          <button className="text-[10px] font-extrabold px-2.5 py-1.5 rounded-md text-white shrink-0" style={{ background: "var(--primary)" }}>تطبيق</button>
        </div>
      </div>
    </div>
  );
}

// ============ 3) تقارير — Analytics Dashboard ============
function MiniChartLine({ pts, color, height = 56, animated = true }) {
  let d = `M ${pts[0]} ${height - pts[1]}`;
  for (let i = 2; i < pts.length; i += 2) d += ` L ${pts[i]} ${height - pts[i + 1]}`;
  const id = React.useId();
  const pathRef = React.useRef(null);
  const [len, setLen] = React.useState(0);
  React.useEffect(() => {
    if (pathRef.current) setLen(pathRef.current.getTotalLength());
  }, []);
  return (
    <svg width="100%" height={height} viewBox={`0 0 200 ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`mc-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={`${d} L 195 ${height} L 5 ${height} Z`} fill={`url(#mc-${id})`} />
      <path ref={pathRef} d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={animated && len ? { strokeDasharray: len, strokeDashoffset: len, animation: `drawLine 1.6s ease-out .2s forwards` } : {}}/>
      {/* نقاط على الخط */}
      {pts.filter((_, i) => i % 2 === 0).map((x, idx) => {
        const y = height - pts[idx * 2 + 1];
        return <circle key={idx} cx={x} cy={y} r="2.2" fill={color} opacity="0.85"/>;
      })}
    </svg>
  );
}
function MiniBars({ vals, color, height = 56 }) {
  const max = Math.max(...vals);
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {vals.map((v, i) => (
        <div key={i} className="flex-1 rounded-t" style={{ height: `${(v/max)*100}%`, background: color, opacity: 0.4 + (v/max)*0.6 }} />
      ))}
    </div>
  );
}

function MiniUIAnalytics() {
  const [range, setRange] = React.useState("7");
  const ranges = [{id:"1",l:"اليوم"},{id:"7",l:"٧ أيام"},{id:"30",l:"٣٠ يوم"}];

  const kpis = [
    { l: "متوسط الرد",     v: "2.5 د", d: "-22%", icon: "clock", c: "var(--secondary)", dir: "down-good" },
    { l: "رضا العملاء",     v: "96%",   d: "+4%",  icon: "smile", c: "#22D3EE",          dir: "up" },
    { l: "محادثات اليوم",   v: "1,250", d: "+18%", icon: "chart", c: "var(--primary-hi)", dir: "up" },
    { l: "مهام مكتملة",     v: "87%",   d: "+9%",  icon: "check", c: "#10B981",          dir: "up" },
  ];

  const channels = [
    { l: "WhatsApp",   v: 52, c: "#25D366" },
    { l: "Instagram",  v: 24, c: "#DD2A7B" },
    { l: "Messenger",  v: 16, c: "#0084FF" },
    { l: "Telegram",   v: 8,  c: "#2AABEE" },
  ];

  return (
    <div className="analytics-dashboard relative" dir="rtl">
      {/* glow خلف الواجهة */}
      <div className="absolute -inset-6 -z-10 pointer-events-none" style={{
        background: "radial-gradient(50% 50% at 50% 30%, color-mix(in srgb, var(--secondary) 22%, transparent), transparent 70%)",
        filter: "blur(40px)",
      }} />

      {/* شريط علوي */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: "color-mix(in srgb, var(--secondary) 18%, transparent)", color: "var(--secondary)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20V8M10 20V4M16 20v-8M3 20h18"/></svg>
          </div>
          <div className="text-[12.5px] font-extrabold">لوحة التحليلات</div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="inline-flex p-0.5 rounded-lg gap-0.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)" }}>
            {ranges.map((r) => {
              const active = range === r.id;
              return (
                <button key={r.id} onClick={() => setRange(r.id)}
                  className={`px-2 py-1 rounded-md text-[10px] font-extrabold transition whitespace-nowrap ${active ? "text-white" : "text-soft"}`}
                  style={active ? { background: "var(--primary)" } : {}}>
                  {r.l}
                </button>
              );
            })}
          </div>
          <button className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2.5 py-1.5 rounded-lg text-white" style={{ background: "linear-gradient(135deg, var(--primary), var(--secondary))" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            تصدير
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-grid p-3 gap-2">
        {kpis.map((k, i) => (
          <div key={k.l} className="kpi-card p-3 rounded-xl"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--line)",
              animation: `fade-up .55s cubic-bezier(.22,1,.36,1) ${0.06 * i}s both`,
            }}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] text-mute font-bold">{k.l}</div>
              <span className="w-6 h-6 rounded-md grid place-items-center" style={{ background: `color-mix(in srgb, ${k.c} 16%, transparent)`, color: k.c }}>
                {k.icon === "clock" && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>}
                {k.icon === "smile" && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4 4 0 007 0"/><circle cx="9" cy="10" r=".8" fill="currentColor"/><circle cx="15" cy="10" r=".8" fill="currentColor"/></svg>}
                {k.icon === "chart" && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 20V8M10 20V4M16 20v-8M3 20h18"/></svg>}
                {k.icon === "check" && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="20 6 9 17 4 12"/></svg>}
              </span>
            </div>
            <div className="text-2xl font-extrabold">{k.v}</div>
            <div className="text-[10px] font-extrabold mt-1 flex items-center gap-1" style={{ color: (k.dir === "up" || k.dir === "down-good") ? "var(--secondary)" : "#EF4444" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ transform: k.dir === "up" ? "" : "rotate(180deg)" }}><polyline points="6 14 12 8 18 14"/></svg>
              {k.d}
              <span className="text-mute font-bold">عن الفترة السابقة</span>
            </div>
          </div>
        ))}
      </div>

      {/* Chart + Channels */}
      <div className="px-3 pb-3 grid lg:grid-cols-[1.4fr,1fr] gap-2">
        {/* Line chart */}
        <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)" }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-extrabold">حجم المحادثات</div>
            <div className="flex items-center gap-1 text-[9.5px] text-mute">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--primary-hi)" }}></span>
              المحادثات
            </div>
          </div>
          <MiniChartLine
            pts={[6,12, 28,22, 50,18, 72,32, 94,28, 116,42, 138,36, 160,50, 182,44]}
            color="#4D80FF"
            height={84}
          />
          <div className="flex justify-between text-[8.5px] text-mute mt-1.5">
            <span>س</span><span>أ</span><span>ث</span><span>ر</span><span>خ</span><span>ج</span><span>س</span>
          </div>
        </div>

        {/* Channels distribution */}
        <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)" }}>
          <div className="text-[11px] font-extrabold mb-2.5">توزيع القنوات</div>
          <div className="space-y-2.5">
            {channels.map((ch) => (
              <div key={ch.l}>
                <div className="flex items-center justify-between text-[10.5px] mb-1">
                  <span className="flex items-center gap-1.5 font-bold">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: ch.c }}></span>
                    {ch.l}
                  </span>
                  <span className="font-extrabold text-mute">{ch.v}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${ch.v}%`, background: ch.c, boxShadow: `0 0 8px ${ch.c}55` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* تنبيه ذكي */}
      <div className="m-3 mt-0 p-3 rounded-xl" style={{ background: "color-mix(in srgb, #F59E0B 12%, transparent)", border: "1px solid color-mix(in srgb, #F59E0B 32%, transparent)" }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0" style={{ background: "color-mix(in srgb, #F59E0B 22%, transparent)", color: "#F59E0B" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.41 0z"/></svg>
            </span>
            <div className="leading-tight min-w-0">
              <div className="text-[11.5px] font-extrabold">تنبيه ذكي</div>
              <div className="text-[10px] text-soft">ارتفع ضغط محادثات <span className="font-bold" style={{ color: "#F59E0B" }}>واتساب 18%</span> خلال آخر ساعتين</div>
            </div>
          </div>
          <button className="text-[10px] font-extrabold px-2.5 py-1.5 rounded-md text-white shrink-0" style={{ background: "var(--primary)" }}>عرض التفاصيل</button>
        </div>
      </div>
    </div>
  );
}

// ============ 4) أتمتة — Automation Flow كامل ============
function _FlowNode({ step, title, text, chip, chipColor = "var(--primary-hi)", icon, color, delay = 0 }) {
  return (
    <div className="automation-node relative p-3 rounded-xl flex flex-col gap-1.5 w-[180px] shrink-0"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid var(--line)",
        animation: `fade-up .6s cubic-bezier(.22,1,.36,1) ${delay}s both`,
      }}>
      {/* رأس: رقم خطوة + أيقونة */}
      <div className="flex items-center justify-between">
        <span className="text-[8.5px] font-extrabold tracking-wider" style={{ color }}>الخطوة {step}</span>
        <span className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
          {icon}
        </span>
      </div>
      {/* العنوان */}
      <div className="text-[11.5px] font-extrabold leading-tight">{title}</div>
      {/* النص */}
      <p className="text-[10px] text-soft leading-relaxed line-clamp-2">{text}</p>
      {/* الشارة */}
      <div className="mt-1 inline-flex items-center self-start gap-1 text-[9px] font-extrabold px-1.5 py-0.5 rounded-md"
        style={{ background: `color-mix(in srgb, ${chipColor} 14%, transparent)`, color: chipColor }}>
        <span className="w-1 h-1 rounded-full" style={{ background: chipColor }}></span>
        {chip}
      </div>
    </div>
  );
}

function _FlowArrow({ vertical = false }) {
  if (vertical) {
    return (
      <div className="flex flex-col items-center" aria-hidden="true">
        <div className="w-px h-6 flow-line" />
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    );
  }
  // أفقي: في RTL يجب أن يشير للجهة اليسرى (التدفق من اليمين لليسار)
  return (
    <div className="flex items-center shrink-0" aria-hidden="true">
      <div className="relative w-10 h-px flow-line">
        <span className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full flow-dot" style={{ background: "var(--secondary)", boxShadow: "0 0 8px var(--secondary)" }}/>
      </div>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: "scaleX(-1)" }}><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  );
}

function MiniUIAutomation() {
  const steps = [
    { step: 1, title: "رسالة واردة",    text: "أحتاج تعديل عنوان التوصيل",      chip: "WhatsApp",    chipColor: "#25D366",          color: "#25D366",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a8 8 0 01-11.6 7.2L4 21l1.8-5.4A8 8 0 1121 12z"/></svg> },
    { step: 2, title: "تحليل النية",     text: "نية العميل: تعديل طلب",          chip: "AI",          chipColor: "var(--primary-hi)", color: "var(--primary-hi)",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg> },
    { step: 3, title: "وسم ذكي",        text: "توصيل · طلب نشط",                chip: "تلقائي",      chipColor: "#F59E0B",          color: "#F59E0B",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg> },
    { step: 4, title: "إجراء تلقائي",   text: "تحويل إلى فريق الشحن",           chip: "فريق الشحن",   chipColor: "#8B5CF6",          color: "#8B5CF6",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg> },
    { step: 5, title: "متابعة",          text: "إنشاء مهمة بمهلة 15د",          chip: "SLA",         chipColor: "var(--secondary)",  color: "var(--secondary)",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> },
  ];

  return (
    <div className="automation-flow-card relative" dir="rtl">
      {/* glow خلف الواجهة */}
      <div className="absolute -inset-6 -z-10 pointer-events-none" style={{
        background: "radial-gradient(50% 50% at 50% 30%, color-mix(in srgb, var(--secondary) 22%, transparent), transparent 70%)",
        filter: "blur(40px)",
      }} />

      {/* شريط علوي */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: "color-mix(in srgb, var(--secondary) 18%, transparent)", color: "var(--secondary)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>
          </div>
          <div className="text-[12.5px] font-extrabold">مسار التشغيل التلقائي</div>
          <span className="text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-full" style={{ background: "color-mix(in srgb, var(--secondary) 18%, transparent)", color: "var(--secondary)" }}>● فعّال</span>
        </div>
        <button className="text-[10px] font-bold px-2.5 py-1.5 rounded-md text-soft" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)" }}>
          تعديل المسار
        </button>
      </div>

      {/* Flow — أفقي على الديسكتوب، عمودي على الجوال */}
      <div className="p-4 automation-flow" dir="rtl">
        {/* Desktop: horizontal RTL */}
        <div className="hidden md:flex items-stretch gap-0 overflow-x-auto pb-2 mini-flow-scroll">
          {steps.map((s, i) => (
            <React.Fragment key={s.step}>
              <_FlowNode {...s} delay={0.08 * i} />
              {i < steps.length - 1 && <_FlowArrow />}
            </React.Fragment>
          ))}
        </div>
        {/* Mobile: vertical */}
        <div className="flex md:hidden flex-col items-center gap-0">
          {steps.map((s, i) => (
            <React.Fragment key={s.step}>
              <div className="w-full max-w-[260px]"><_FlowNode {...s} delay={0.08 * i} /></div>
              {i < steps.length - 1 && <_FlowArrow vertical />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* قاعدة التشغيل + نتيجة التنفيذ */}
      <div className="grid lg:grid-cols-2 gap-2.5 px-4 pb-4">
        {/* قاعدة التشغيل */}
        <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)" }}>
          <div className="flex items-center gap-1.5 mb-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--primary-hi)" }}><path d="M6 3v18M18 3v18M3 8h18M3 16h18"/></svg>
            <div className="text-[11px] font-extrabold">قاعدة التشغيل</div>
          </div>
          <div className="text-[10.5px] leading-relaxed text-soft">
            <div>
              <span className="text-mute">إذا احتوت الرسالة على: </span>
              {["توصيل","شحن","عنوان"].map((w, i) => (
                <span key={w} className="inline-flex items-center text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-md mx-0.5"
                  style={{ background: "color-mix(in srgb, var(--primary) 14%, transparent)", color: "var(--primary-hi)" }}>{w}</span>
              ))}
            </div>
            <div className="mt-2 space-y-1">
              <span className="text-mute font-bold text-[10px]">نفّذ:</span>
              {[
                "إضافة وسم: توصيل",
                "تحويل إلى: فريق الشحن",
                "إنشاء مهمة متابعة",
              ].map((a, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded grid place-items-center" style={{ background: "color-mix(in srgb, var(--secondary) 22%, transparent)", color: "var(--secondary)" }}>
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </span>
                  <span className="text-[10px]">{a}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* نتيجة التنفيذ */}
        <div className="rounded-xl p-3" style={{ background: "color-mix(in srgb, var(--secondary) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--secondary) 28%, transparent)" }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--secondary)", boxShadow: "0 0 8px var(--secondary)" }}></span>
              <div className="text-[11px] font-extrabold">نتيجة التنفيذ</div>
            </div>
            <span className="text-[9.5px] text-mute">منذ ٣د</span>
          </div>
          <div className="space-y-1.5">
            {[
              { l: "تم تحويل المحادثة",            v: "فريق الشحن"   },
              { l: "تم إنشاء مهمة",                 v: "#WSL-1842"     },
              { l: "تم تحديث حالة العميل",         v: "طلب نشط"      },
            ].map((r, i) => (
              <div key={i} className="flex items-center justify-between text-[10.5px]">
                <span className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded-full grid place-items-center" style={{ background: "var(--secondary)" }}>
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </span>
                  <span>{r.l}</span>
                </span>
                <span className="font-extrabold" style={{ color: "var(--secondary)" }}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// gabster-platform-dashboard.jsx — Dashboard فاخر خاص بقسم Platform Preview فقط
// (لا يُستخدم في الـ Hero — الـ Hero يبقى على DashboardMockup الأصلي)

function _PCh({ kind, size = 14 }) {
  const map = {
    wa: { bg: "#25D366",                                                  glyph: "W" },
    ig: { bg: "linear-gradient(135deg,#F58529,#DD2A7B,#515BD4)",          glyph: "I" },
    mg: { bg: "#0084FF",                                                  glyph: "M" },
    tg: { bg: "#2AABEE",                                                  glyph: "T" },
  };
  const c = map[kind] || map.wa;
  return (
    <span className="grid place-items-center rounded-full text-white font-extrabold"
      style={{ width: size, height: size, background: c.bg, fontSize: size * 0.55, border: "2px solid var(--card-solid)" }}>
      {c.glyph}
    </span>
  );
}

function _SideIcon({ name, size = 16 }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  const map = {
    inbox:    <g {...s}><path d="M4 13l3-8h10l3 8"/><path d="M4 13v6h16v-6"/><path d="M4 13h5l1 2h4l1-2h5"/></g>,
    team:     <g {...s}><circle cx="9" cy="8" r="3"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="8" r="2.2"/><path d="M14 19c0-2 2-3.5 4-3.5s3 1.2 3 3"/></g>,
    chart:    <g {...s}><path d="M4 20V8M10 20V4M16 20v-8M3 20h18"/></g>,
    bolt:     <g {...s}><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></g>,
    gear:     <g {...s}><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.2-1.7l2-1.5-2-3.4-2.3 1a7 7 0 00-2.9-1.7L13 2h-2l-.6 2.7a7 7 0 00-2.9 1.7l-2.3-1-2 3.4 2 1.5a7 7 0 000 3.4l-2 1.5 2 3.4 2.3-1a7 7 0 002.9 1.7L11 22h2l.6-2.7a7 7 0 002.9-1.7l2.3 1 2-3.4-2-1.5c.1-.5.2-1.1.2-1.7z"/></g>,
    search:   <g {...s}><circle cx="11" cy="11" r="6"/><path d="M20 20l-3.5-3.5"/></g>,
    bell:     <g {...s}><path d="M6 8a6 6 0 1112 0v5l2 2H4l2-2z"/><path d="M10 19a2 2 0 004 0"/></g>,
    spark:    <g {...s}><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></g>,
    user:     <g {...s}><circle cx="12" cy="8" r="4"/><path d="M4 22c0-4 4-7 8-7s8 3 8 7"/></g>,
    tag:      <g {...s}><path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/></g>,
    pkg:      <g {...s}><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></g>,
    arrow:    <g {...s}><path d="M5 12h14M12 5l7 7-7 7"/></g>,
    plus:     <g {...s}><path d="M12 5v14M5 12h14"/></g>,
    clock:    <g {...s}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></g>,
    smile:    <g {...s}><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4 4 0 007 0"/><circle cx="9" cy="10" r=".8" fill="currentColor"/><circle cx="15" cy="10" r=".8" fill="currentColor"/></g>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{map[name]}</svg>;
}

// ====== Component ======
function PlatformDashboard() {
  // المحادثة النشطة + داعمها للتفاعل البسيط (hover)
  const conversations = [
    { id: 0, ch: "wa", name: "عميل واتساب",   msg: "مرحباً، أريد معرفة حالة الشحن",         time: "11:42 ص", color: "#25D366", unread: 2 },
    { id: 1, ch: "wa", name: "متجر الهدى",     msg: "وصل استفسار جديد عن الطلب #1842",      time: "11:18 ص", color: "#1B5CE8", unread: 0 },
    { id: 2, ch: "ig", name: "عميل إنستغرام",  msg: "هل المنتج متوفر؟",                       time: "10:50 ص", color: "#DD2A7B", unread: 1 },
    { id: 3, ch: "mg", name: "متجر الخليج",    msg: "تم تحديث حالة الشحن",                    time: "10:21 ص", color: "#0084FF", unread: 0 },
    { id: 4, ch: "tg", name: "استفسار توصيل",  msg: "أحتاج تعديل العنوان",                    time: "09:48 ص", color: "#2AABEE", unread: 0 },
  ];
  const [activeId, setActive] = React.useState(0);
  const active = conversations.find((c) => c.id === activeId) || conversations[0];

  return (
    <div
      className="platform-dash-window relative rounded-[24px] overflow-hidden"
      style={{
        background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)) , var(--card-solid)",
        border: "1px solid var(--line-strong)",
        boxShadow: "0 60px 120px -30px rgba(2,6,23,0.85), inset 0 1px 0 rgba(255,255,255,0.08)",
      }}
    >
      {/* glow خفيف خلف الإطار */}
      <div className="absolute -inset-8 -z-10 pointer-events-none" style={{
        background: "radial-gradient(40% 60% at 20% 30%, rgba(37,99,235,0.32), transparent 70%), radial-gradient(40% 60% at 80% 70%, rgba(34,211,238,0.22), transparent 70%)",
        filter: "blur(48px)",
      }} />

      {/* ====== App window chrome ====== */}
      <div className="window-chrome flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--line)" }}>
        <span className="window-dot" style={{ background: "#FF5F57" }} />
        <span className="window-dot" style={{ background: "#FEBC2E" }} />
        <span className="window-dot" style={{ background: "#28C840" }} />
        <div className="ms-3 flex items-center gap-2">
          <BrandLogo variant="icon" size={16} />
          <div className="text-[11.5px] font-bold text-soft">وصال ون <span className="text-mute">— صندوق الوارد</span></div>
        </div>
        <div className="ms-auto flex items-center gap-1.5 text-[10px] text-mute">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--secondary)", boxShadow: "0 0 8px var(--secondary)" }}></span>
          متّصل
        </div>
      </div>

      {/* ====== KPI strip (3 مؤشرات فقط) ====== */}
      <div className="px-4 py-2.5 border-b flex items-center gap-4 overflow-x-auto" style={{ borderColor: "var(--line)", background: "rgba(0,0,0,0.16)" }}>
        {[
          { l: "متوسط الرد",     v: "2.5 د", c: "var(--secondary)", icon: "clock"  },
          { l: "رضا العملاء",     v: "96%",   c: "#22D3EE",          icon: "smile"  },
          { l: "محادثات اليوم",   v: "1,250", c: "var(--primary-hi)",icon: "chart"  },
        ].map((k) => (
          <div key={k.l} className="flex items-center gap-2 shrink-0">
            <span className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: `color-mix(in srgb, ${k.c} 16%, transparent)`, color: k.c }}>
              <_SideIcon name={k.icon} size={14}/>
            </span>
            <div className="leading-tight">
              <div className="text-[9px] text-mute">{k.l}</div>
              <div className="text-[12px] font-extrabold">{k.v}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ====== Body: 4 zones ====== */}
      <div className="dash-body grid" style={{ minHeight: 460 }}>
        {/* Zone 1: Sidebar */}
        <aside className="dash-sidebar p-2.5 border-s flex flex-col" style={{ background: "rgba(2,6,23,0.45)", borderColor: "var(--line)" }}>
          <div className="flex items-center gap-2 p-2 rounded-lg mb-2" style={{ background: "rgba(255,255,255,0.04)" }}>
            <div className="w-7 h-7 rounded-md grid place-items-center text-white text-[10px] font-extrabold" style={{ background: "linear-gradient(135deg, var(--primary), var(--secondary))" }}>W</div>
            <div className="leading-tight min-w-0">
              <div className="text-[10.5px] font-bold truncate">حساب المتجر</div>
              <div className="text-[8.5px] text-mute">المدير</div>
            </div>
          </div>
          <nav className="space-y-1">
            {[
              { i: "inbox", l: "صندوق الوارد", active: true, badge: 24 },
              { i: "team",  l: "الفريق" },
              { i: "chart", l: "التقارير" },
              { i: "bolt",  l: "الأتمتة" },
              { i: "gear",  l: "الإعدادات" },
            ].map((n) => (
              <button key={n.l} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-bold transition ${n.active ? "text-white" : "text-soft hover:bg-white/5"}`}
                style={n.active ? { background: "var(--primary)" } : {}}>
                <_SideIcon name={n.i} size={13}/>
                <span className="truncate">{n.l}</span>
                {n.badge && <span className="ms-auto text-[8px] font-extrabold px-1.5 py-0.5 rounded-full" style={{ background: n.active ? "rgba(255,255,255,0.25)" : "var(--secondary)", color: n.active ? "#fff" : "#fff" }}>{n.badge}</span>}
              </button>
            ))}
          </nav>
          <div className="mt-auto pt-3 border-t" style={{ borderColor: "var(--line)" }}>
            <div className="text-[8.5px] text-mute mb-1.5">الفريق · ٤ متاحون</div>
            <div className="flex items-center -space-x-1.5 space-x-reverse">
              {["#1B5CE8","#22D3EE","#F59E0B","#8B5CF6"].map((c, i) => (
                <div key={i} className="w-6 h-6 rounded-full ring-2" style={{ background: c, borderColor: "var(--card-solid)", boxShadow: "0 0 0 2px var(--card-solid)" }} />
              ))}
            </div>
          </div>
        </aside>

        {/* Zone 2: قائمة المحادثات */}
        <section className="dash-list border-s flex flex-col" style={{ background: "rgba(0,0,0,0.10)", borderColor: "var(--line)" }}>
          <div className="p-3 border-b" style={{ borderColor: "var(--line)" }}>
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg mb-2" style={{ background: "rgba(255,255,255,0.04)" }}>
              <_SideIcon name="search" size={12}/>
              <span className="text-[10.5px] text-mute">ابحث في المحادثات</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-[11.5px] font-extrabold">المحادثات</div>
              <div className="flex gap-1 text-[8.5px]">
                <span className="px-1.5 py-0.5 rounded-full text-white font-extrabold" style={{ background: "var(--primary)" }}>الكل 24</span>
                <span className="px-1.5 py-0.5 rounded-full text-mute" style={{ background: "rgba(255,255,255,0.05)" }}>غير مقروءة</span>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            {conversations.map((c) => {
              const isActive = c.id === activeId;
              return (
                <button key={c.id} onClick={() => setActive(c.id)}
                  className={`w-full text-start flex items-start gap-2 px-3 py-2.5 border-b transition ${isActive ? "" : "hover:bg-white/[0.03]"}`}
                  style={{
                    borderColor: "var(--line)",
                    background: isActive ? "color-mix(in srgb, var(--primary) 16%, transparent)" : "transparent",
                    borderInlineEndWidth: isActive ? 3 : 0,
                    borderInlineEndColor: isActive ? "var(--primary-hi)" : "transparent",
                    borderInlineEndStyle: "solid",
                  }}>
                  <div className="relative shrink-0">
                    <div className="w-8 h-8 rounded-full grid place-items-center text-white text-[11px] font-extrabold" style={{ background: c.color }}>
                      {c.name.charAt(0)}
                    </div>
                    <span className="absolute -bottom-0.5 -start-0.5"><_PCh kind={c.ch} size={13}/></span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-extrabold truncate">{c.name}</span>
                      <span className="text-[8.5px] text-mute shrink-0">{c.time}</span>
                    </div>
                    <p className="text-[10px] text-soft truncate mt-0.5">{c.msg}</p>
                  </div>
                  {c.unread > 0 && (
                    <span className="text-[8.5px] font-extrabold text-white rounded-full px-1.5 py-0.5" style={{ background: "var(--secondary)" }}>{c.unread}</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Zone 3: المحادثة المفتوحة */}
        <section className="dash-thread flex-1 min-w-0 flex flex-col" style={{ background: "rgba(255,255,255,0.02)" }}>
          {/* thread header */}
          <div className="px-4 py-3 border-b flex items-center gap-2.5" style={{ borderColor: "var(--line)" }}>
            <div className="relative">
              <div className="w-9 h-9 rounded-full grid place-items-center text-white text-[12px] font-extrabold" style={{ background: active.color }}>{active.name.charAt(0)}</div>
              <span className="absolute -bottom-0.5 -start-0.5"><_PCh kind={active.ch} size={14}/></span>
            </div>
            <div className="leading-tight">
              <div className="text-[12px] font-extrabold">{active.name}</div>
              <div className="text-[10px] flex items-center gap-1" style={{ color: "var(--secondary)" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--secondary)", boxShadow: "0 0 6px var(--secondary)" }}></span>
                نشط الآن
              </div>
            </div>
            <div className="ms-auto flex items-center gap-1.5">
              <button className="w-7 h-7 grid place-items-center rounded-lg text-mute hover:bg-white/5"><_SideIcon name="bell" size={13}/></button>
              <button className="w-7 h-7 grid place-items-center rounded-lg text-mute hover:bg-white/5"><_SideIcon name="user" size={13}/></button>
            </div>
          </div>

          {/* messages */}
          <div className="flex-1 p-4 space-y-2.5 overflow-hidden">
            <div className="max-w-[75%] me-auto rounded-2xl rounded-bs-md px-3 py-2 text-[11.5px] leading-relaxed" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)" }}>
              مرحباً، أريد معرفة حالة الشحن
              <div className="text-[8.5px] text-mute mt-0.5">11:41 ص</div>
            </div>
            <div className="max-w-[75%] ms-auto rounded-2xl rounded-be-md px-3 py-2 text-[11.5px] leading-relaxed text-white" style={{ background: "var(--primary)" }}>
              أهلاً بك، طلبك قيد التجهيز وسيتم تحديثك خلال 1-3 أيام عمل.
              <div className="text-[8.5px] mt-0.5 text-blue-200">11:43 ص ✓✓</div>
            </div>
            <div className="max-w-[75%] me-auto rounded-2xl rounded-bs-md px-3 py-2 text-[11.5px] leading-relaxed" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)" }}>
              ممتاز، شكراً لكم 🙏
              <div className="text-[8.5px] text-mute mt-0.5">11:44 ص</div>
            </div>
          </div>

          {/* smart reply card */}
          <div className="mx-4 mb-3 p-3 rounded-xl" style={{ background: "color-mix(in srgb, var(--secondary) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--secondary) 30%, transparent)" }}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-extrabold" style={{ color: "var(--secondary)" }}>
                <_SideIcon name="spark" size={12}/>
                ردّ ذكي مقترح
              </div>
              <span className="text-[9px] text-mute">من Wesal AI</span>
            </div>
            <p className="text-[11px] leading-relaxed mb-2">"الطلب قيد التوصيل وسيصلك اليوم قبل المغرب. كود التتبع: <span className="font-bold" dir="ltr">WSL-2841</span>"</p>
            <div className="flex items-center gap-1.5">
              <button className="text-[10px] font-extrabold text-white px-3 py-1.5 rounded-md" style={{ background: "var(--primary)" }}>استخدام الرد</button>
              <button className="text-[10px] font-bold px-3 py-1.5 rounded-md text-soft" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)" }}>تعديل</button>
            </div>
          </div>

          {/* composer */}
          <div className="p-3 border-t flex items-center gap-2" style={{ borderColor: "var(--line)" }}>
            <div className="flex-1 text-[10.5px] text-mute rounded-lg px-3 py-2.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)" }}>اكتب رسالة...</div>
            <button className="w-9 h-9 grid place-items-center rounded-lg text-white" style={{ background: "var(--primary)" }}>
              <_SideIcon name="arrow" size={14}/>
            </button>
          </div>
        </section>

        {/* Zone 4: Side Panel */}
        <aside className="dash-panel border-s p-4 flex flex-col gap-4" style={{ background: "rgba(0,0,0,0.20)", borderColor: "var(--line)" }}>
          {/* عميل */}
          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-11 h-11 rounded-full grid place-items-center text-white text-base font-extrabold" style={{ background: active.color }}>{active.name.charAt(0)}</div>
              <div className="min-w-0">
                <div className="text-[12px] font-extrabold truncate">{active.name}</div>
                <div className="text-[9.5px] text-mute">عميل · QR-2841</div>
              </div>
            </div>
            <div className="space-y-1.5 text-[10.5px]">
              {[
                { l: "الحالة",  v: <span className="font-bold" style={{ color: "var(--secondary)" }}>● جديد</span> },
                { l: "القناة",  v: <span className="flex items-center gap-1 font-bold"><_PCh kind={active.ch} size={11}/> WhatsApp</span> },
                { l: "آخر طلب", v: <span className="font-bold font-mono" dir="ltr">#1842</span> },
              ].map((r, i) => (
                <div key={i} className="flex items-center justify-between py-1 border-b" style={{ borderColor: "var(--line)" }}>
                  <span className="text-mute">{r.l}</span>
                  <span>{r.v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* وسوم */}
          <div>
            <div className="text-[10px] font-bold text-mute mb-2">الوسوم</div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { l: "توصيل",   c: "var(--primary-hi)" },
                { l: "طلب نشط", c: "var(--secondary)" },
                { l: "VIP",     c: "#F59E0B" },
              ].map((t) => (
                <span key={t.l} className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-1 rounded-md"
                  style={{ background: `color-mix(in srgb, ${t.c} 16%, transparent)`, color: t.c }}>
                  <_SideIcon name="tag" size={9}/>
                  {t.l}
                </span>
              ))}
            </div>
          </div>

          {/* آخر طلب card */}
          <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold">
                <_SideIcon name="pkg" size={13}/>
                الطلب <span className="font-mono" dir="ltr">#1842</span>
              </div>
              <span className="text-[9px] font-bold" style={{ color: "var(--secondary)" }}>قيد التوصيل</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
              <div className="h-full rounded-full" style={{ width: "75%", background: "linear-gradient(90deg, var(--primary), var(--secondary))" }} />
            </div>
            <div className="flex justify-between text-[8px] text-mute mt-1.5">
              <span>تم الطلب</span><span>تجهيز</span><span>شُحن</span><span>وصل</span>
            </div>
          </div>

          {/* إجراءات سريعة */}
          <div className="mt-auto">
            <div className="text-[10px] font-bold text-mute mb-2">إجراء سريع</div>
            <div className="space-y-1.5">
              <button className="w-full flex items-center justify-center gap-2 h-9 rounded-lg text-[11px] font-extrabold text-white" style={{ background: "var(--primary)" }}>
                <_SideIcon name="arrow" size={12}/>
                تحويل للفريق
              </button>
              <button className="w-full flex items-center justify-center gap-2 h-9 rounded-lg text-[11px] font-extrabold text-soft" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)" }}>
                <_SideIcon name="plus" size={12}/>
                إنشاء مهمة
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// Wesal × Gabster — Nav + Hero (AI-agents hero merged into the full page)

function ThemeToggle2() {
  const [dark, setDark] = React.useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("wesal-theme");
    if (saved === "light") return false;
    return true;
  });
  React.useEffect(() => {
    const r = document.documentElement;
    r.classList.remove("dark", "light");
    r.classList.add(dark ? "dark" : "light");
    localStorage.setItem("wesal-theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <button
      onClick={() => setDark((d) => !d)}
      aria-label={dark ? "الوضع النهاري" : "الوضع الليلي"}
      className="relative w-10 h-10 grid place-items-center rounded-xl border border-line text-soft hover:text-[color:var(--primary)] transition"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className={`absolute transition-all duration-300 ${dark ? "opacity-0 -rotate-90 scale-50" : "opacity-100"}`}>
        <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
      </svg>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className={`absolute transition-all duration-300 ${dark ? "opacity-100" : "opacity-0 rotate-90 scale-50"}`}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    </button>
  );
}

function LangPill() {
  const [lang, setLang] = React.useState("ar");
  return (
    <button
      onClick={() => setLang((l) => (l === "ar" ? "en" : "ar"))}
      className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-line text-[12px] font-bold text-soft hover:text-[color:var(--primary)] transition"
      aria-label="اللغة"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 010 18"/><path d="M12 3a14 14 0 000 18"/></svg>
      {lang === "ar" ? "EN" : "ع"}
    </button>
  );
}

function GabsterNav() {
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const links = [
    { l: "المنصة",       h: "#preview"   },
    { l: "المزايا",       h: "#features"  },
    { l: "الأسعار",       h: "#pricing"   },
    { l: "قصص النجاح",   h: "#stories"   },
    { l: "الموارد",       h: "#resources" },
    { l: "تواصل معنا",   h: "#contact"   },
  ];
  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 border-b ${scrolled ? "shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)]" : ""}`}
      style={{
        background: scrolled ? "color-mix(in srgb, var(--bg) 86%, transparent)" : "color-mix(in srgb, var(--bg) 55%, transparent)",
        borderBottomColor: scrolled ? "var(--line)" : "transparent",
        backdropFilter: scrolled ? "blur(16px) saturate(160%)" : "blur(8px)",
        WebkitBackdropFilter: scrolled ? "blur(16px) saturate(160%)" : "blur(8px)",
      }}
    >
      <div className="container-page h-16 flex items-center justify-between gap-4">
        <a href="#home" className="shrink-0 wesal-logo-lockup" aria-label="وصال ون — Wesal One">
          <img src="/assets/wesal/wesal-w.png" alt="" aria-hidden="true" className="wesal-logo-icon" />
          <span className="wesal-logo-text">
            <span className="wesal-logo-ar">وصال ون</span>
            <span className="wesal-logo-en">Wesal One</span>
          </span>
        </a>

        <nav className="hidden lg:flex items-center gap-6">
          {links.map((l) => (
            <a key={l.l} href={l.h} className="text-[13.5px] font-semibold text-soft hover:text-[color:var(--fg)] transition">{l.l}</a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2">
            <LangPill />
            <ThemeToggle2 />
          </div>
          <a href="#pricing" className="hidden sm:inline-flex items-center h-10 px-5 rounded-xl btn-primary font-bold text-sm">ابدأ الآن</a>

          <button className="lg:hidden w-10 h-10 grid place-items-center rounded-xl border border-line text-soft" onClick={() => setOpen((o)=>!o)} aria-label="القائمة">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {open ? <path d="M18 6L6 18M6 6l12 12"/> : <g><path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/></g>}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="lg:hidden border-t border-line" style={{ background: "var(--bg)" }}>
          <div className="container-page py-3 flex flex-col gap-1">
            {links.map((l) => (
              <a key={l.l} href={l.h} onClick={() => setOpen(false)} className="text-sm font-semibold text-soft py-2.5 border-b border-line last:border-0">{l.l}</a>
            ))}
            <div className="flex items-center gap-2 mt-3">
              <LangPill />
              <ThemeToggle2 />
              <a href="#pricing" onClick={()=>setOpen(false)} className="ms-auto inline-flex items-center h-10 px-5 rounded-xl btn-primary font-bold text-sm">ابدأ الآن</a>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

// ===== خلفية Hero — cinematic dark + glows =====
function HeroBackdrop() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
      <div className="absolute top-[-15%] right-[-10%] w-[680px] h-[680px] rounded-full" style={{
        background: "radial-gradient(circle, rgba(37,99,235,0.50), transparent 65%)", filter: "blur(80px)",
      }} />
      <div className="absolute top-[20%] left-[28%] w-[560px] h-[560px] rounded-full" style={{
        background: "radial-gradient(circle, rgba(34,211,238,0.34), transparent 62%)", filter: "blur(90px)",
      }} />
      <div className="absolute bottom-[-20%] left-[-10%] w-[520px] h-[520px] rounded-full" style={{
        background: "radial-gradient(circle, rgba(20,184,166,0.18), transparent 65%)", filter: "blur(85px)",
      }} />
      <div className="absolute inset-0 grid-bg grid-bg-mask" style={{ opacity: 0.5 }} />
    </div>
  );
}

// ===== مكوّنات أيقونات صغيرة =====
function Spark({ size = 16, color = "var(--secondary)" }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M12 2l1.6 5.3L19 9l-5.4 1.7L12 16l-1.6-5.3L5 9l5.4-1.7z"/></svg>;
}

// ===== كروت الهيرو العائمة =====
function HeroConnectCard() {
  const icons = [WhatsAppIcon, InstagramIcon, MessengerIcon, TelegramIcon];
  return (
    <div className="surface rounded-2xl p-4 w-[244px] shadow-[0_24px_60px_-18px_rgba(0,0,0,0.55)]">
      <div className="flex items-center justify-between">
        <span className="font-extrabold text-[15px]">منصة أعمال متصلة</span>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" strokeWidth="1.8"><path d="M7 9a3 3 0 100 6c1.4 0 2.3-1 3-2 .7 1 1.6 2 3 2a3 3 0 100-6c-1.4 0-2.3 1-3 2-.7-1-1.6-2-3-2z"/></svg>
      </div>
      <p className="text-[12.5px] text-mute mt-2 leading-relaxed">إدارة المحادثات والعمليات من قناتك المفضّلة</p>
      <div className="flex gap-2 mt-3.5" dir="ltr">
        {icons.map((Icon, i) => (
          <div key={i} className="w-[42px] h-[42px] rounded-xl surface-soft border border-line grid place-items-center">
            <Icon size={24} />
          </div>
        ))}
      </div>
    </div>
  );
}

function HeroInboxCard() {
  const rows = [
    { Icon: WhatsAppIcon,  n: "شركة النور",   p: "تم استلام الطلب بنجاح", t: "2m" },
    { Icon: InstagramIcon, n: "متجر القمة",   p: "هل المنتج متوفر؟",       t: "5m" },
    { Icon: MessengerIcon, n: "مؤسسة الرؤية", p: "أرسلوا لنا التفاصيل",    t: "7m" },
    { Icon: TelegramIcon,  n: "حلول الأعمال", p: "شكرًا على المتابعة",     t: "13m" },
  ];
  return (
    <div className="surface rounded-2xl p-4 w-[256px] shadow-[0_24px_60px_-18px_rgba(0,0,0,0.55)]">
      <div className="font-extrabold text-[15px] mb-2">صندوق وارد موحّد</div>
      <div className="flex flex-col gap-0.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2.5 px-1.5 py-2 rounded-xl hover:bg-[color:var(--bg-muted)] transition">
            <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0"><r.Icon size={34} /></span>
            <div className="flex-1 min-w-0 text-start">
              <div className="text-[13px] font-bold leading-tight">{r.n}</div>
              <div className="text-[11.5px] text-mute truncate mt-0.5">{r.p}</div>
            </div>
            <span className="text-[11px] text-mute shrink-0" dir="ltr">{r.t}</span>
          </div>
        ))}
      </div>
      <a href="#preview" className="flex items-center gap-1.5 mt-2 px-1.5 py-1.5 text-[13px] font-bold" style={{ color: "var(--secondary)" }}>
        عرض جميع المحادثات
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>
      </a>
    </div>
  );
}

function HeroPerfCard() {
  return (
    <div className="surface rounded-2xl p-4 w-[206px] shadow-[0_24px_60px_-18px_rgba(0,0,0,0.55)]">
      <div className="font-extrabold text-[14px] mb-3">أداء الأذكياء</div>
      <div className="flex items-center gap-3">
        <div className="relative w-16 h-16 shrink-0">
          <svg width="64" height="64" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="27" fill="none" stroke="rgba(120,150,220,0.16)" strokeWidth="7"/>
            <circle cx="32" cy="32" r="27" fill="none" stroke="url(#pgrad)" strokeWidth="7" strokeLinecap="round" strokeDasharray="170" strokeDashoffset="5.4" transform="rotate(-90 32 32)"/>
            <defs><linearGradient id="pgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3B7BFF"/><stop offset="1" stopColor="#22D3EE"/></linearGradient></defs>
          </svg>
          <div className="absolute inset-0 grid place-items-center font-extrabold text-[13.5px]">96.8%</div>
        </div>
        <div className="text-[12px] text-mute">
          <div className="font-extrabold text-[14px] mb-0.5" style={{ color: "var(--fg)" }}>معدل النجاح</div>
          أداء أعلى من المتوسط
        </div>
      </div>
      <svg className="mt-3 w-full" height="54" viewBox="0 0 190 54" preserveAspectRatio="none">
        <defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3B7BFF" stopOpacity=".35"/><stop offset="1" stopColor="#3B7BFF" stopOpacity="0"/></linearGradient></defs>
        <path d="M2 44 L34 38 L64 41 L96 26 L128 29 L160 15 L188 7 L188 54 L2 54 Z" fill="url(#spk)"/>
        <path d="M2 44 L34 38 L64 41 L96 26 L128 29 L160 15 L188 7" fill="none" stroke="#4D86FF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="188" cy="7" r="3.2" fill="#22D3EE"/>
      </svg>
      <div className="flex items-center gap-1.5 mt-2 text-[12px] font-bold" style={{ color: "var(--secondary)" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>
        تحسّن هذا الأسبوع
      </div>
    </div>
  );
}

function HeroTasksCard() {
  const tasks = [
    { l: "رد على الاستفسارات",       done: true  },
    { l: "تحديث حالة الطلبات",        done: true  },
    { l: "متابعة العملاء المحتملين",  done: false },
  ];
  return (
    <div className="surface rounded-2xl p-4 w-[200px] shadow-[0_24px_60px_-18px_rgba(0,0,0,0.55)]">
      <div className="font-extrabold text-[14.5px] mb-3">المهام الذكية</div>
      <div className="flex flex-col gap-2.5">
        {tasks.map((t, i) => (
          <div key={i} className={`flex items-center gap-2.5 text-[13px] ${t.done ? "" : "text-mute"}`}>
            {t.done ? (
              <span className="w-5 h-5 rounded-lg grid place-items-center shrink-0" style={{ background: "linear-gradient(135deg,#1E9E8F,#22D3EE)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#04101f" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
              </span>
            ) : (
              <span className="w-5 h-5 rounded-lg border-2 border-line shrink-0"></span>
            )}
            {t.l}
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== هالة + حلقات خلف الهولوغرام =====
function HoloStage() {
  return (
    <div className="relative mx-auto w-[280px]">
      {/* halo */}
      <div className="absolute -inset-10 -z-10 pointer-events-none" style={{
        background: "radial-gradient(50% 50% at 50% 42%, rgba(45,130,255,0.42), rgba(34,211,238,0.16) 55%, transparent 76%)",
        filter: "blur(10px)",
      }} />
      {/* rings */}
      <div className="absolute inset-0 -z-10 grid place-items-center pointer-events-none">
        <div className="relative" style={{ width: "150%", aspectRatio: "1/1" }}>
          <div className="absolute inset-0 rounded-full orbit-ring--slow" style={{ border: "1px solid var(--line-strong)" }} />
          <div className="absolute inset-[12%] rounded-full orbit-ring--rev" style={{ border: "1px dashed var(--line)" }} />
        </div>
      </div>
      <div className="relative rounded-2xl overflow-hidden" style={{
        border: "1px solid var(--line)",
        boxShadow: "0 50px 100px -30px rgba(2,6,23,0.8)",
        aspectRatio: "3/4",
      }}>
        <image-slot
          id="wesal-hero-holo"
          shape="rect"
          fit="cover"
          placeholder="ضع صورة الهولوغرام (وكيل الذكاء الاصطناعي + اللابتوب)"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        ></image-slot>
      </div>
    </div>
  );
}

// ===== مكوّنات مشتركة: نص الهيرو + حبوب الميزات + صورة الهولوغرام =====
const PILLS = [
  { l: "صندوق وارد موحّد", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" strokeWidth="1.9"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg> },
  { l: "تحويل للبشري",     icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" strokeWidth="1.9"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"/></svg> },
  { l: "ردود ذكية",        icon: <Spark size={15} color="var(--secondary)" /> },
  { l: "أتمتة متقدمة",     icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" strokeWidth="1.8"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg> },
];

function HeroText({ centered = false, fs = "clamp(30px,4vw,48px)" }) {
  const align = centered ? "center" : "right";
  return (
    <div style={{ textAlign: align }}>
      <div style={{ display:"inline-flex", alignItems:"center", gap:8, fontSize:13, fontWeight:700, padding:"7px 18px", borderRadius:999, background:"rgba(255,255,255,0.04)", border:"1px solid var(--line-strong)", color:"#CFE0FF", whiteSpace:"nowrap" }}>
        <Spark size={14} color="var(--secondary)" /> منصة ذكاء اصطناعي لإدارة أعمالك ونموّك
      </div>
      <div style={{ fontWeight:900, fontSize:fs, lineHeight:1.16, letterSpacing: 0, marginTop:18, color:"#FBFDFF" }}>
        وكلاء ذكاء اصطناعي<br/>
        يديرون <span style={{ background:"linear-gradient(90deg,#4D86FF,#22D3EE)", WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" }}>أعمالك</span> باحتراف
      </div>
      <p style={{ marginTop:20, fontSize:17, lineHeight:1.95, color:"var(--fg-soft, #A9B6CE)", maxWidth:580, marginInlineStart: centered?"auto":0 }}>
        وصال ون، منصة سهلة الاستخدام توحّد تواصل العملاء، وتدير الردود وتُسرّع المبيعات وخدمة العملاء من مكان واحد. ابدأ الربط والتشغيل خلال دقائق، واترك للوكلاء الأذكياء إدارة المهام المتكررة ومساعدة فريقك بكفاءة أعلى.
      </p>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginTop:24, flexWrap:"wrap", justifyContent: centered ? "center" : "flex-start" }}>
        <a href="#pricing" className="btn-primary" style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"14px 28px", borderRadius:14, fontWeight:800, fontSize:16, color:"#fff", textDecoration:"none" }}>
          ابدأ الآن
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>
        </a>
        <a href="#contact" className="btn-ghost" style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"14px 26px", borderRadius:14, fontWeight:800, fontSize:16, textDecoration:"none", color:"var(--fg)" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          اطلب عرضًا تجريبيًا
        </a>
      </div>
      <p style={{ marginTop:14, fontSize:13.5, color:"var(--fg-mute, #7F8DA8)" }}>ربط وتشغيل خلال دقائق &nbsp;•&nbsp; تجربة مجانية <b style={{ color:"var(--fg-soft, #A9B6CE)" }}>14 يوم</b></p>
    </div>
  );
}

function HeroPills({ style = {} }) {
  return (
    <div style={{ display:"flex", gap:10, flexWrap:"wrap", ...style }}>
      {PILLS.map((p) => (
        <span key={p.l} style={{ display:"inline-flex", alignItems:"center", gap:7, padding:"10px 16px", borderRadius:13, background:"rgba(255,255,255,0.03)", border:"1px solid var(--line)", color:"#CBD6EA", fontSize:14, fontWeight:600 }}>
          {p.icon} {p.l}
        </span>
      ))}
    </div>
  );
}

function HoloImage({ style = {} }) {
  return (
    <div style={{ position:"relative", ...style }}>
      <div style={{ position:"absolute", inset:"-20% -10%", background:"radial-gradient(50% 50% at 50% 44%, rgba(45,130,255,0.42), rgba(34,211,238,0.16) 55%, transparent 76%)", filter:"blur(10px)", pointerEvents:"none", zIndex:0 }} />
      <img src="/assets/wesal/hero-hologram.png" alt="" style={{ width:"100%", height:"100%", objectFit:"contain", position:"relative", zIndex:1, display:"block", filter:"brightness(1.25) contrast(1.08) saturate(1.12)" }} />
    </div>
  );
}

// ===== Desktop Hero — fixed 1672×690 canvas, scaled by container width =====
function HeroDesktop() {
  const wrapRef = React.useRef(null);
  const [sc, setSc] = React.useState(1);
  React.useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const update = () => { const w = el.clientWidth; if (w > 0) setSc(w / 1672); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  const W = 1672, H = 690;
  return (
    <div ref={wrapRef} style={{ position:"relative", width:"100%", height: H * sc, overflow:"hidden" }}>
      <div style={{ position:"absolute", top:0, left:0, width:W, height:H, transformOrigin:"top left", transform:`scale(${sc})` }}>

        {/* ── الهالة خلف الهولوغرام ── */}
        <div style={{ position:"absolute", left:250, top:30, width:640, height:630, background:"radial-gradient(50% 50% at 50% 44%, rgba(37,99,235,0.38), rgba(34,211,238,0.18) 55%, transparent 76%)", filter:"blur(12px)", pointerEvents:"none" }} />

        {/* ── حلقات أوربيتال ── */}
        <div style={{ position:"absolute", left:300, top:60, width:545, height:560, display:"grid", placeItems:"center", pointerEvents:"none" }}>
          <div style={{ position:"relative", width:"130%", aspectRatio:"1/1" }}>
            <div className="orbit-ring--slow" style={{ position:"absolute", inset:0, borderRadius:"50%", border:"1px solid var(--line-strong)" }} />
            <div className="orbit-ring--rev" style={{ position:"absolute", inset:"12%", borderRadius:"50%", border:"1px dashed var(--line)" }} />
          </div>
        </div>

        {/* ── صورة الهولوغرام ── */}
        <img src="/assets/wesal/hero-hologram.png" alt="" style={{ position:"absolute", left:300, top:0, width:545, height:H, objectFit:"contain", zIndex:2, pointerEvents:"none", filter:"brightness(1.28) contrast(1.1) saturate(1.15)" }} />

        {/* ── بطاقة: منصة أعمال متصلة (أعلى يسار) ── */}
        <div style={{ position:"absolute", left:40, top:38, zIndex:5 }} className="float-y">
          <HeroConnectCard />
        </div>

        {/* ── بطاقة: صندوق وارد موحّد (وسط يسار) ── */}
        <div style={{ position:"absolute", left:40, top:280, zIndex:5 }} className="float-y">
          <HeroInboxCard />
        </div>

        {/* ── بطاقة: أداء الأذكياء (أعلى يمين الهولوغرام) ── */}
        <div style={{ position:"absolute", left:786, top:66, zIndex:5 }} className="float-y">
          <HeroPerfCard />
        </div>

        {/* ── بطاقة: المهام الذكية (يمين الهولوغرام وسط) ── */}
        <div style={{ position:"absolute", left:826, top:342, zIndex:5 }} className="float-y">
          <HeroTasksCard />
        </div>

        {/* ── النص الرئيسي (يمين) ── */}
        <div style={{ position:"absolute", right:30, top:40, width:625, textAlign:"right", zIndex:6, direction:"rtl" }}>
          <HeroText fs="60px" />
        </div>

        {/* ── حبوب الميزات (أسفل يمين) ── */}
        <div style={{ position:"absolute", right:30, top:592, direction:"rtl", zIndex:6 }}>
          <HeroPills />
        </div>

      </div>
    </div>
  );
}

// ===== Mobile/Tablet Hero (< lg) =====
function HeroMobile() {
  return (
    <div className="lg:hidden container-page" style={{ paddingTop:24, paddingBottom:32 }}>
      <div className="text-center"><HeroText centered fs="clamp(32px,7vw,46px)" /></div>
      <div style={{ marginTop:28, display:"flex", justifyContent:"center" }}>
        <HoloImage style={{ width:"min(300px, 80vw)", height:"auto", aspectRatio:"545/690" }} />
      </div>
      <div style={{ marginTop:24, display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:12, maxWidth:580, marginInline:"auto", justifyItems:"center" }}>
        <HeroConnectCard /><HeroPerfCard />
        <HeroInboxCard /><HeroTasksCard />
      </div>
      <div style={{ marginTop:20, display:"flex", justifyContent:"center" }}>
        <HeroPills style={{ justifyContent:"center" }} />
      </div>
    </div>
  );
}

// ===== Hero — entry point =====
function OrbitalHero() {
  return (
    <section className="relative overflow-hidden" id="home" style={{ paddingBottom: 16 }}>
      <HeroBackdrop />
      {/* Desktop: fixed-scale canvas, full section width */}
      <div className="hidden lg:block">
        <HeroDesktop />
      </div>
      {/* Mobile / Tablet */}
      <HeroMobile />
    </section>
  );
}

// IntersectionObserver لعناصر .reveal
function useReveal() {
  React.useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("in"); }),
      { threshold: 0.12 }
    );
    document.querySelectorAll(".reveal:not(.in)").forEach((el) => io.observe(el));
    return () => io.disconnect();
  });
}

// Wesal × Gabster — Sections: PlatformPreview (enhanced) + Pillars (with mini UIs) + Stats + Partners + Testimonials

// ============ Platform Preview — Dashboard + Side Panel ============
function PlatformPreview() {
  const [tab, setTab] = React.useState("inbox");
  const tabs = [
    { id: "inbox",   l: "صندوق الوارد" },
    { id: "team",    l: "الفريق"        },
    { id: "reports", l: "التقارير"      },
    { id: "autom",   l: "الأتمتة"        },
  ];
  return (
    <section id="preview" className="platform-preview-section">
      <div className="container-page">
        <div className="platform-preview-header">
          <div className="reveal platform-preview-badge inline-flex items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-mute">
            <span className="w-6 h-px" style={{ background: "var(--primary)" }} />
            داخل المنصة
            <span className="w-6 h-px" style={{ background: "var(--primary)" }} />
          </div>
          <h2 className="reveal platform-preview-title text-3xl sm:text-5xl font-extrabold leading-[1.15]">
            نظرة على <span className="grad-text">منصة وصال ون</span>
          </h2>
          <p className="reveal platform-preview-description mx-auto max-w-2xl text-[15px] text-soft">
            صندوق وارد، فريق، تقارير، وأتمتة — كل ذلك في تجربة عربية واحدة سلسة.
          </p>

          {/* Tabs */}
          <div className="reveal platform-preview-tabs flex justify-center">
            <div className="inline-flex p-1 rounded-xl surface gap-1" role="tablist">
              {tabs.map((t) => {
                const active = tab === t.id;
                return (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={`px-4 py-2 rounded-lg text-[13px] font-bold transition whitespace-nowrap ${active ? "text-white" : "text-soft"}`}
                    style={active ? { background: "var(--primary)" } : {}}>
                    {t.l}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="reveal relative mx-auto platform-dashboard-frame" style={{ maxWidth: 1180 }}>
          {/* glow خفيف خلف الإطار */}
          <div className="absolute -inset-10 rounded-[40px] pointer-events-none -z-10" style={{
            background: "radial-gradient(80% 60% at 50% 0%, color-mix(in srgb, var(--primary) 22%, transparent), transparent 70%)",
            filter: "blur(50px)",
          }}></div>

          {tab === "inbox" && <PlatformDashboard />}
          {tab === "team"    && <MiniUITeam />}
          {tab === "reports" && <MiniUIAnalytics />}
          {tab === "autom"   && <MiniUIAutomation />}
        </div>

        <p className="reveal mt-6 text-center text-[12px] text-mute">
          حرّك مؤشر الماوس فوق اللوحة لتجربة التفاعل ↔
        </p>
      </div>
    </section>
  );
}

// لوحة جانبية: بيانات العميل + الوسوم + اقتراح ردّ
function PreviewSidePanel() {
  return (
    <aside className="flex flex-col gap-4">
      {/* بيانات العميل */}
      <div>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full grid place-items-center text-white text-base font-bold" style={{ background: "var(--primary)" }}>W</div>
          <div className="min-w-0">
            <div className="text-[14px] font-extrabold">عميل واتساب</div>
            <div className="text-[11px] text-mute">عميل منذ 2024 · 12 طلب</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="surface-soft rounded-lg p-2 border border-line">
            <div className="text-[9px] text-mute">القيمة</div>
            <div className="text-[12px] font-extrabold">1,420 ر.س</div>
          </div>
          <div className="surface-soft rounded-lg p-2 border border-line">
            <div className="text-[9px] text-mute">الرضا</div>
            <div className="text-[12px] font-extrabold" style={{ color: "var(--secondary)" }}>96%</div>
          </div>
        </div>
      </div>

      {/* الوسوم */}
      <div>
        <div className="text-[11px] font-bold text-mute mb-2">الوسوم</div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { l: "VIP",          c: "#F59E0B" },
            { l: "استفسار طلب",   c: "var(--primary)" },
            { l: "متابعة",        c: "var(--secondary)" },
          ].map((t) => (
            <span key={t.l} className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ background: `color-mix(in srgb, ${t.c} 14%, transparent)`, color: t.c }}>● {t.l}</span>
          ))}
        </div>
      </div>

      {/* حالة الطلب */}
      <div>
        <div className="text-[11px] font-bold text-mute mb-2">آخر طلب · #WSL-2841</div>
        <div className="surface-soft rounded-lg p-2.5 border border-line">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold">قيد التوصيل</span>
            <span className="text-[10px] text-mute">اليوم</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
            <div className="h-full rounded-full" style={{ width: "75%", background: "linear-gradient(90deg, var(--primary), var(--secondary))" }} />
          </div>
          <div className="flex justify-between text-[8px] text-mute mt-1">
            <span>تم الطلب</span><span>تحت التجهيز</span><span>شُحن</span><span>وصل</span>
          </div>
        </div>
      </div>

      {/* اقتراح رد ذكي */}
      <div className="rounded-xl p-3 border border-line" style={{ background: "color-mix(in srgb, var(--secondary) 10%, transparent)" }}>
        <div className="flex items-center gap-1.5 text-[11px] font-bold mb-1.5" style={{ color: "var(--secondary)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>
          اقتراح ردّ ذكي
        </div>
        <p className="text-[11px] leading-relaxed">"أهلاً بك، طلبك قيد التجهيز وسيتم تحديثك خلال 1-3 أيام. كود التتبع: <span className="font-bold">WSL-2841</span>"</p>
        <div className="flex items-center gap-1.5 mt-2">
          <button className="text-[10px] font-bold px-2.5 py-1 rounded-md text-white" style={{ background: "var(--primary)" }}>إرسال</button>
          <button className="text-[10px] font-bold px-2.5 py-1 rounded-md border border-line">تعديل</button>
        </div>
      </div>
    </aside>
  );
}

// ============ Platform intro (header for pillars section) ============
function PlatformIntro() {
  return (
    <section id="features" className="surface-soft py-14 sm:py-20 border-y border-line">
      <div className="container-page text-center">
        <div className="inline-flex items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-mute reveal">
          <span className="w-6 h-px" style={{ background: "var(--primary)" }} />
          القدرات
          <span className="w-6 h-px" style={{ background: "var(--primary)" }} />
        </div>
        <h2 className="reveal mt-3 text-3xl sm:text-5xl font-extrabold leading-[1.15]">
          أربع قدرات تعمل معاً <span className="grad-text">في منصة واحدة</span>
        </h2>
        <p className="reveal mt-4 mx-auto max-w-2xl text-[15px] sm:text-[17px] leading-[1.9] text-soft">
          من استقبال الرسالة حتى التقرير النهائي — كل خطوة في مكانها، بلا تنقّل بين تطبيقات.
        </p>
      </div>
    </section>
  );
}

// ============ Pillar — نص نصف + UI mockup نصف ============
function Pillar({ kicker, title, desc, bullets, side = "right", color = "var(--primary)", visual }) {
  return (
    <div className="container-page py-14 sm:py-20">
      <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-center">
        <div className={`lg:col-span-5 reveal ${side === "right" ? "lg:order-1" : "lg:order-2"}`}>
          <div className="inline-flex items-center gap-2 text-[11px] font-bold tracking-wider uppercase" style={{ color }}>
            <span className="w-6 h-px" style={{ background: color }} />
            {kicker}
          </div>
          <h3 className="mt-3 text-3xl sm:text-4xl font-extrabold leading-[1.2]">{title}</h3>
          <p className="mt-4 text-[15px] sm:text-[16px] leading-[1.95] text-soft max-w-xl">{desc}</p>
          <ul className="mt-6 space-y-2.5">
            {bullets.map((b) => (
              <li key={b} className="flex items-center gap-2.5 text-[14px] text-soft">
                <span className="w-5 h-5 rounded-full grid place-items-center" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>
        <div className={`lg:col-span-7 reveal ${side === "right" ? "lg:order-2" : "lg:order-1"}`}>
          {/* halo خلف الـ visual */}
          <div className="relative">
            <div className="absolute -inset-6 rounded-[28px] pointer-events-none -z-10" style={{
              background: `radial-gradient(60% 60% at 50% 50%, color-mix(in srgb, ${color} 22%, transparent), transparent 70%)`,
              filter: "blur(40px)",
            }} />
            <div className="lift">{visual}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeaturePillars() {
  return (
    <>
      <PlatformIntro />
      <Pillar
        kicker="Communicate · تواصل"
        title="صندوق وارد موحّد لكل قنواتك"
        desc="اجمع محادثات واتساب، إنستغرام، ماسنجر، وتيليجرام في واجهة واحدة، ورتّبها حسب القناة، الحالة، والأولوية."
        bullets={["جميع القنوات في مكان واحد", "فرز ذكي حسب الأولوية", "متابعة المحادثات بدون ضياع"]}
        side="right"
        color="var(--primary)"
        visual={<MiniUIInbox />}
      />
      <Pillar
        kicker="Operate · شغّل"
        title="وزّع المحادثات والمهام على فريقك"
        desc="حوّل كل محادثة إلى مهمة واضحة، عيّنها للعضو المناسب، وتابع حالة الردود والإنجاز من لوحة تشغيل واحدة."
        bullets={["توزيع تلقائي حسب القناة أو الأولوية", "متابعة حالة كل محادثة", "تنبيهات للمهام المتأخرة"]}
        side="left"
        color="var(--secondary)"
        visual={<MiniUITeam />}
      />
      <Pillar
        kicker="Analyze · حلّل"
        title="اعرف أداء فريقك من تقارير واضحة"
        desc="تابع سرعة الرد، رضا العملاء، حجم المحادثات، وأداء القنوات من لوحة تحليلات واحدة تساعدك على اتخاذ قرارات أسرع."
        bullets={["قياس متوسط سرعة الرد", "معرفة القنوات الأكثر ضغطاً", "تتبع رضا العملاء والإنجاز"]}
        side="right"
        color="var(--secondary)"
        visual={<MiniUIAnalytics />}
      />
      <Pillar
        kicker="Act · نفّذ"
        title="حوّل المحادثات إلى إجراءات تلقائية"
        desc="أنشئ مسارات ذكية تبدأ من رسالة العميل وتنتهي بإجراء واضح: رد جاهز، وسم، تحويل للفريق، أو إنشاء مهمة متابعة."
        bullets={["تشغيل تلقائي حسب كلمات العميل", "تحويل المحادثات للفريق المناسب", "إنشاء مهام وردود ذكية بدون تدخل يدوي"]}
        side="left"
        color="#8B5CF6"
        visual={<MiniUIAutomation />}
      />
    </>
  );
}

// ============ Stats — glass strip متّصل بالـ Hero ============
function StatsBar() {
  const shield = <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 9.5C8 19.2 5 15.5 5 11V6z"/><path d="M9.5 12l1.8 1.8L15 10"/></svg>;
  const smile  = <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" strokeLinecap="round"/><circle cx="9" cy="10" r=".5" fill="currentColor"/><circle cx="15" cy="10" r=".5" fill="currentColor"/></svg>;
  const bld    = <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 9h2M9 13h2M9 17h2M13 9h2M13 13h2M13 17h2"/></svg>;
  const chat   = <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12a8 8 0 01-11.5 7.2L4 21l1.8-5.5A8 8 0 1121 12z"/></svg>;
  const clock  = <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2" strokeLinecap="round"/></svg>;
  // ترتيب LTR: أمان (يسار) ← 98% ← +10K ← +2M ← 24/7 (يمين)
  const stats = [
    { v: "أمان وخصوصية", l: "بمعايير عالمية متقدمة", ic: shield, lead: true },
    { v: "98%",  l: "معدل رضا العملاء",      ic: smile },
    { v: "+10K", l: "شركات تثق بنا",          ic: bld  },
    { v: "+2M",  l: "محادثة مُدارة شهريًا",   ic: chat },
    { v: "24/7", l: "أداء مستمر",             ic: clock },
  ];
  return (
    <section className="relative" style={{ zIndex: 6 }}>
      <div className="stats-strip">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-6" dir="ltr">
          {stats.map((s, i) => (
            <div key={s.l} dir="rtl" className={`reveal relative flex items-center justify-center gap-3.5 ${s.lead ? "flex-row-reverse" : "flex-row"}`}>
              <span className="w-11 h-11 rounded-xl grid place-items-center shrink-0" style={{ background: "rgba(96,142,255,0.10)", border: "1px solid var(--line)", color: "var(--secondary)" }}>
                {s.ic}
              </span>
              <div className={s.lead ? "text-start" : "text-end"}>
                <div className={`font-extrabold ${s.lead ? "text-[19px] sm:text-[21px]" : "text-[24px] sm:text-[26px]"}`} style={{ color: "var(--fg)" }}>{s.v}</div>
                <div className="mt-1 text-[12.5px] text-mute font-semibold">{s.l}</div>
              </div>
              {i < stats.length - 1 && (
                <div className="hidden lg:block absolute top-1/2 -translate-y-1/2 -start-2 h-9 w-px" style={{ background: "var(--line)" }}></div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============ Partners strip — شعارات متحركة ============
function PartnersStrip() {
  const partners = ["متجر الخليج","متجر الهدى","فريق الشحن","منصة تجارة","مركز دعم","متجر العناية","شركة الأفق","حلول","أركان","ProSpace","TechWave","LineMart","Souqly","BlueWave","Marina","النخبة"];
  const items = [...partners, ...partners];
  return (
    <section id="stories" className="py-12 border-y border-line overflow-hidden" style={{ background: "var(--bg)" }}>
      <div className="container-page text-center mb-6">
        <div className="text-[12px] font-bold tracking-wider uppercase text-mute reveal">+200 علامة تجارية تعتمد على وصال ون</div>
      </div>
      <div className="relative">
        <div className="absolute inset-y-0 start-0 w-24 z-10" style={{ background: "linear-gradient(90deg, var(--bg), transparent)" }}></div>
        <div className="absolute inset-y-0 end-0 w-24 z-10" style={{ background: "linear-gradient(-90deg, var(--bg), transparent)" }}></div>
        <div className="flex gap-10 partner-track w-max" dir="ltr">
          {items.map((p, i) => (
            <div key={i} className="shrink-0 h-10 px-4 grid place-items-center surface rounded-xl text-[13px] font-bold text-mute opacity-70 hover:opacity-100 transition" style={{ fontFamily: "'Tajawal', sans-serif" }}>
              {p}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============ Testimonials — شهادات الفرق والمتاجر ============
function GabsterTestimonials() {
  const items = [
    {
      title: "قلّلنا ضياع المحادثات",
      text:  "أصبح الفريق يرى كل محادثات واتساب وإنستغرام من مكان واحد، وصار من السهل معرفة من يتابع كل طلب.",
      name:  "متجر الخليج", role: "متجر إلكتروني", c: "var(--primary-hi)",
    },
    {
      title: "التوزيع صار أوضح",
      text:  "قبل وصال ون كانت المحادثات تتداخل بين الفريق. الآن كل محادثة لها حالة، أولوية، وعضو مسؤول عنها.",
      name:  "مركز دعم", role: "فريق خدمة عملاء", c: "var(--secondary)",
    },
    {
      title: "التقارير اختصرت علينا الوقت",
      text:  "صرنا نعرف القنوات الأكثر ضغطاً ومتوسط سرعة الرد بدون تجميع يدوي للأرقام.",
      name:  "متجر الهدى", role: "تجارة إلكترونية", c: "#F59E0B",
    },
    {
      title: "المتابعة أصبحت أسهل",
      text:  "المهام والتنبيهات ساعدتنا نتابع طلبات الشحن والتعديل بدون نسيان.",
      name:  "فريق الشحن", role: "عمليات وتوصيل", c: "#8B5CF6",
    },
  ];

  return (
    <section id="testimonials" className="testimonials-section">
      <div className="container-page">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="reveal text-3xl sm:text-4xl font-extrabold leading-[1.2]">
            فرق تستخدم وصال ون <span className="grad-text">لتنظيم محادثاتها</span>
          </h2>
          <p className="reveal mt-3 text-[14.5px] text-soft leading-relaxed">
            من المتاجر الصغيرة إلى فرق الدعم، تساعد وصال ون على تقليل الفوضى، تسريع الردود، وتحويل المحادثات إلى إجراءات قابلة للمتابعة.
          </p>
        </div>

        {/* Cards grid */}
        <div className="testimonials-grid">
          {items.map((it, i) => (
            <div key={it.name} className="testimonial-card p-6 reveal flex flex-col"
              style={{ animation: `fade-up .55s cubic-bezier(.22,1,.36,1) ${0.08 * i}s both` }}>
              {/* quote icon + stars */}
              <div className="flex items-start justify-between mb-3">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style={{ color: it.c, opacity: 0.4 }} aria-hidden="true">
                  <path d="M7 7h4v4H8c0 2 1 3 3 3v3c-4 0-6-2-6-6V7zm9 0h4v4h-3c0 2 1 3 3 3v3c-4 0-6-2-6-6V7z"/>
                </svg>
                <div className="flex items-center gap-0.5">
                  {[0,1,2,3,4].map((s) => (
                    <span key={s} className="w-1.5 h-1.5 rounded-full" style={{ background: it.c, boxShadow: `0 0 6px ${it.c}` }}></span>
                  ))}
                </div>
              </div>

              {/* title + text */}
              <div className="text-[15px] font-extrabold leading-tight mb-2">{it.title}</div>
              <p className="text-[13px] text-soft leading-[1.85] flex-1">{it.text}</p>

              {/* footer: name + role */}
              <div className="mt-5 pt-4 flex items-center gap-2.5" style={{ borderTop: "1px solid var(--line)" }}>
                <div className="w-9 h-9 rounded-lg grid place-items-center text-white text-[12px] font-extrabold shrink-0" style={{ background: `linear-gradient(135deg, ${it.c}, var(--primary))` }}>
                  {it.name.charAt(0)}
                </div>
                <div className="leading-tight min-w-0">
                  <div className="text-[12.5px] font-extrabold truncate">{it.name}</div>
                  <div className="text-[10.5px] text-mute truncate">{it.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Wesal × Gabster — Pricing + FinalCTA + Footer

function PricingToggle({ yearly, setYearly }) {
  return (
    <div className="inline-flex items-center gap-2 p-1 rounded-xl"
         style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)" }}
         role="tablist" aria-label="نوع الاشتراك">
      {[
        { id: false, l: "شهري" },
        { id: true,  l: "سنوي" },
      ].map((opt) => {
        const active = yearly === opt.id;
        return (
          <button key={String(opt.id)} onClick={() => setYearly(opt.id)}
            className={`relative px-4 py-2 rounded-lg text-[13px] font-extrabold transition whitespace-nowrap ${active ? "text-white" : "text-soft"}`}
            style={active ? { background: "var(--primary)" } : {}}>
            {opt.l}
            {opt.id && (
              <span className="absolute -top-2 -end-2 text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-full text-white" style={{ background: "var(--secondary)", boxShadow: "0 0 12px color-mix(in srgb, var(--secondary) 60%, transparent)" }}>فوترة سنوية</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PriceCard({ name, desc, priceLabel, priceNote, features, cta, href = "/register", featured, delay = 0 }) {
  return (
    <div
      className={`pricing-card relative p-7 flex flex-col reveal ${featured ? "featured" : ""}`}
      style={{ animation: `fade-up .6s cubic-bezier(.22,1,.36,1) ${delay}s both` }}>
      {featured && (
        <div className="absolute -top-3 right-1/2 translate-x-1/2 text-[10px] font-extrabold tracking-wider px-3 py-1 rounded-full text-white whitespace-nowrap"
             style={{ background: "linear-gradient(135deg, var(--primary), var(--secondary))", boxShadow: "0 8px 20px -6px color-mix(in srgb, var(--primary) 50%, transparent)" }}>
          الأكثر اختياراً
        </div>
      )}

      {/* اسم الخطة */}
      <h3 className="text-xl font-extrabold">{name}</h3>
      <p className="mt-1.5 text-[12.5px] text-soft leading-relaxed min-h-[44px]">{desc}</p>

      <div className="mt-5">
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-extrabold">{priceLabel}</span>
        </div>
        <div className="text-[11px] text-mute mt-1">{priceNote}</div>
      </div>

      {/* فاصل ناعم بين السعر والمزايا */}
      <div className="mt-6 mb-5 h-px" style={{ background: "var(--line)" }}/>

      {/* المزايا */}
      <ul className="space-y-2.5 flex-1">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[12.5px] text-soft leading-relaxed">
            <span className="mt-0.5 w-4 h-4 rounded-full grid place-items-center shrink-0"
                  style={{ background: featured ? "color-mix(in srgb, var(--secondary) 22%, transparent)" : "color-mix(in srgb, var(--primary) 14%, transparent)",
                           color: featured ? "var(--secondary)" : "var(--primary-hi)" }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {/* CTA — أسفل البطاقة */}
      <a href={href} className={`mt-6 inline-flex w-full items-center justify-center px-5 py-3 rounded-xl font-extrabold text-[13.5px] transition ${featured ? "btn-primary" : "btn-ghost"}`}>
        {cta}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="ms-1.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </a>
    </div>
  );
}

function Pricing() {
  const [yearly, setYearly] = React.useState(false);
  return (
    <section id="pricing" className="pricing-section">
      <div className="container-page">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-8">
          <h2 className="reveal text-3xl sm:text-5xl font-extrabold leading-[1.15]">
            اختر الخطة المناسبة <span className="grad-text">لفريقك</span>
          </h2>
          <p className="reveal mt-4 text-[14.5px] text-soft leading-relaxed">
            التسعير الفعلي يظهر داخل تبويب الفوترة في مساحة العمل حسب الخطة، القنوات، الوكلاء، ونقاط الذكاء المتاحة.
          </p>

          <div className="reveal mt-6 flex justify-center">
            <PricingToggle yearly={yearly} setYearly={setYearly} />
          </div>
        </div>

        {/* Cards */}
        <div className="pricing-grid mt-10">
          <PriceCard
            name="التجربة"
            desc="ابدأ بتجربة المنصة، إنشاء مساحة العمل، وفهم سير المحادثات قبل اختيار الخطة."
            priceLabel="تجربة مجانية"
            priceNote={yearly ? "يمكن التحويل لاحقاً إلى فوترة سنوية من لوحة الفوترة." : "بدون بطاقة دفع عند إنشاء الحساب."}
            cta="أنشئ حساباً"
            features={[
              "صندوق وارد موحّد",
              "إعداد مساحة العمل",
              "تجربة ربط القنوات المتاحة",
              "تجربة الوكيل الذكي",
              "متابعة الخطة من تبويب الفوترة",
            ]}
            delay={0}
          />
          <PriceCard
            name="التشغيل"
            desc="للأنشطة التي تحتاج إدارة محادثات يومية مع فريق، قنوات، ردود ذكية، وتقارير تشغيل."
            priceLabel="حسب الخطة"
            priceNote={yearly ? "الفوترة السنوية متاحة من داخل النظام عند تفعيلها." : "تعرض الحدود والسعر الحقيقي داخل إعدادات الفوترة."}
            cta="ابدأ التجربة"
            featured
            features={[
              "حدود قنوات ووكلاء حسب الخطة",
              "نقاط ذكاء شهرية حسب الاشتراك",
              "توزيع ومتابعة للفريق",
              "تقارير وتشغيل يومي",
              "إرسال طلب دفع من تبويب الفوترة",
            ]}
            delay={0.08}
          />
          <PriceCard
            name="الأعمال"
            desc="للفرق التي تحتاج إعدادات أوسع، صلاحيات، متابعة خاصة، وتخصيص حدود التشغيل."
            priceLabel="حسب الطلب"
            priceNote="نتفق على الحدود، الدعم، والقنوات حسب حجم الفريق والاستخدام."
            cta="تواصل معنا"
            href="/contact"
            features={[
              "حدود تشغيل مخصصة",
              "قنوات ووكلاء حسب الحاجة",
              "صلاحيات وأدوار",
              "إعداد ومتابعة مخصصة",
              "مراجعة متطلبات الخصوصية والتكاملات",
            ]}
            delay={0.16}
          />
        </div>

        {/* ملاحظة */}
        <p className="reveal mt-8 text-center text-[12px] text-mute">
          الأسعار والحدود النهائية تعتمد على بيانات الإنتاج المعروضة داخل الفوترة، ولا تُعد هذه البطاقات فاتورة أو عرضاً ملزماً.
        </p>
      </div>
    </section>
  );
}

// ====== FAQ ======
function FAQ() {
  const items = [
    { q: "هل وصال ون مناسب للمتاجر الصغيرة؟",
      a: "نعم. يمكنك البدء بالتجربة ثم اختيار الخطة المناسبة من تبويب الفوترة داخل مساحة العمل." },
    { q: "هل يدعم واتساب وإنستغرام وماسنجر؟",
      a: "نعم، الفكرة الأساسية هي جمع محادثات القنوات المختلفة في صندوق وارد موحّد، مع ترتيبها حسب الحالة والأولوية." },
    { q: "هل يمكن توزيع المحادثات على الفريق؟",
      a: "نعم. يمكن تعيين المحادثات لأعضاء الفريق، متابعة حالة كل محادثة، وإنشاء مهام مرتبطة بها." },
    { q: "هل توجد ردود ذكية أو اقتراحات؟",
      a: "نعم. يمكن للمنصة اقتراح ردود جاهزة بناءً على سياق المحادثة، مع إمكانية تعديل الرد قبل إرساله." },
    { q: "هل أستطيع متابعة أداء الفريق؟",
      a: "نعم. تعرض لوحة التحليلات مؤشرات مثل متوسط سرعة الرد، حجم المحادثات، القنوات الأكثر ضغطاً، ونسبة الإنجاز." },
    { q: "هل يمكن تخصيص الخطة حسب احتياجنا؟",
      a: "نعم. في خطة الأعمال يمكن تخصيص القنوات، عدد الأعضاء، حدود نقاط الذكاء، والتكاملات حسب احتياج الفريق." },
  ];
  const [open, setOpen] = React.useState(0);
  return (
    <section id="resources" className="faq-section">
      <div className="container-page">
        <div className="mx-auto" style={{ maxWidth: 880 }}>
          <div className="text-center mb-10 sm:mb-12">
            <h2 className="reveal text-3xl sm:text-5xl font-extrabold leading-[1.15]">
              أسئلة شائعة <span className="grad-text">قبل البدء</span>
            </h2>
            <p className="reveal mt-4 text-[14.5px] text-soft leading-relaxed max-w-xl mx-auto">
              إجابات سريعة على أهم الأسئلة حول استخدام وصال ون لتنظيم محادثات العملاء وتشغيل الفريق.
            </p>
          </div>

          <div className="space-y-3">
            {items.map((it, i) => {
              const isOpen = open === i;
              return (
                <div
                  key={i}
                  className={`faq-item reveal overflow-hidden ${isOpen ? "open" : ""}`}
                  style={{ animation: `fade-up .55s cubic-bezier(.22,1,.36,1) ${i * 0.05}s both` }}
                >
                  <button
                    onClick={() => setOpen(isOpen ? -1 : i)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center justify-between gap-4 px-5 sm:px-6 py-4 sm:py-5 text-start"
                  >
                    <span className="text-[15px] sm:text-[16px] font-bold leading-[1.5] pe-2">{it.q}</span>
                    <span
                      className="faq-toggle-icon shrink-0 w-8 h-8 grid place-items-center rounded-full"
                      style={{
                        background: "color-mix(in srgb, var(--primary) 12%, transparent)",
                        color: "var(--primary-hi)",
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </span>
                  </button>
                  <div
                    className="grid transition-all duration-300 ease-out"
                    style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                  >
                    <div className="overflow-hidden">
                      <p className="px-5 sm:px-6 pb-5 text-[13.5px] sm:text-[14px] text-soft leading-[1.9]">
                        {it.a}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

// ===== Final CTA — glass card =====
function FinalCTABig() {
  const trust = [
    "إعداد سريع",
    "مناسب للفرق والمتاجر",
    "دعم عربي",
  ];
  return (
    <section className="final-cta-section" id="cta">
      <div className="container-page">
        <div className="final-cta-card reveal" style={{ animation: "fade-up .7s cubic-bezier(.22,1,.36,1) both" }}>
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-3xl sm:text-5xl font-extrabold leading-[1.15]">
              ابدأ بتنظيم <span className="grad-text">محادثات عملائك</span> اليوم
            </h2>
            <p className="mt-5 text-[14.5px] sm:text-[16px] text-soft leading-relaxed">
              اجمع قنواتك، وزّع المحادثات على فريقك، وتابع الأداء من منصة واحدة مصممة لتجربة عربية حديثة.
            </p>

            <div className="final-cta-actions mt-8 flex items-center justify-center gap-3 flex-wrap">
            <a href="/register" className="final-cta-btn-primary">
                ابدأ الآن
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
              </a>
              <a href="/contact" className="final-cta-btn-ghost">
                تواصل معنا
              </a>
            </div>

            <div className="final-cta-trust mt-7">
              {trust.map((t) => (
                <span key={t}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ===== Footer =====
function GabsterFooter() {
  const product = ["المنصة", "صندوق الوارد", "توزيع المهام", "التحليلات", "الأتمتة"];
  const company = ["الأسعار", "قصص العملاء", "الموارد", "تواصل معنا"];
  return (
    <footer id="contact" className="footer">
      <div className="container-page">
        <div className="footer-grid">
          {/* Brand */}
          <div>
            <BrandLogo variant="horizontal" size={64} />
            <p className="mt-4 text-[13px] text-soft leading-relaxed max-w-sm">
              منصة عربية لتنظيم محادثات العملاء، توزيع المهام، ومتابعة أداء الفريق من مكان واحد.
            </p>
            <p className="mt-3 text-[12px] text-mute">
              مصممة لتجربة عربية RTL.
            </p>
          </div>

          {/* Product */}
          <div>
            <div className="footer-col-title">المنتج</div>
            <ul className="space-y-2.5">
              {product.map((l) => (
                <li key={l}><a href="#" className="footer-link">{l}</a></li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <div className="footer-col-title">الشركة</div>
            <ul className="space-y-2.5">
              {company.map((l) => (
                <li key={l}><a href="#" className="footer-link">{l}</a></li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <div className="footer-col-title">التواصل</div>
            <ul className="space-y-2.5">
              <li className="footer-contact-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2"/>
                  <path d="M3 7l9 6 9-6"/>
                </svg>
                <span dir="ltr">support@wesal.one</span>
              </li>
              <li className="footer-contact-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.5 13.5a8.4 8.4 0 01-1.5 4.7L20 22l-3.9-1a8.5 8.5 0 11-4.6-15.6 8.5 8.5 0 019 8.1z"/>
                </svg>
                <span>واتساب: <span dir="ltr">+967 775 324 950</span></span>
              </li>
              <li className="footer-contact-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1118 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                <span>صنعاء، اليمن</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <div>© 2026 وصال ون. جميع الحقوق محفوظة.</div>
          <div className="footer-bottom-links">
            <a href="/privacy">سياسة الخصوصية</a>
            <span>·</span>
            <a href="/data-deletion">حذف البيانات</a>
            <span>·</span>
            <a href="/terms">شروط الاستخدام</a>
          </div>
        </div>
      </div>
    </footer>
  );
}


export default function WesalSourceMarketingPage() {
  useReveal();
  return (
    <div className="wesal-source-page page-wrap" dir="rtl">
      <GabsterNav />
      <main>
        <OrbitalHero />
        <StatsBar />
        <PlatformPreview />
        <FeaturePillars />
        <PartnersStrip />
        <GabsterTestimonials />
        <Pricing />
        <FAQ />
        <FinalCTABig />
      </main>
      <GabsterFooter />
    </div>
  );
}
