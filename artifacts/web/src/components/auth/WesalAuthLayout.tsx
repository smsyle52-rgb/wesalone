import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import "@/styles/wesal-auth.css";

type AuthLayoutProps = {
  children: ReactNode;
  visualTitle: string;
  visualSubtitle: string;
  visualBullets: string[];
};

type AuthFieldProps = {
  id: string;
  label: string;
  type?: string;
  icon?: ReactNode;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  hint?: string;
  error?: string | null;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

const LOGO = "/assets/wesal/wesal-logo.png";
const MARK = "/assets/wesal/wesal-mark.png";

export function WesalLogo() {
  return <img src={LOGO} alt="وصال ون - Wesal One" className="h-14 w-auto object-contain" />;
}

export function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5.4c-.2 1.2-.9 2.2-2 2.9v2.4h3.2c1.9-1.7 3-4.3 3-7z" fill="#4285F4" />
      <path d="M12 22c2.7 0 5-1 6.6-2.6l-3.2-2.4c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3.1v2.5C4.7 19.5 8.1 22 12 22z" fill="#34A853" />
      <path d="M6.4 13.9c-.2-.6-.3-1.2-.3-1.9s.1-1.3.3-1.9V7.6H3.1A10 10 0 0 0 2 12c0 1.6.4 3.1 1.1 4.4l3.3-2.5z" fill="#FBBC05" />
      <path d="M12 6.5c1.5 0 2.8.5 3.8 1.5l2.8-2.8C16.9 3.7 14.7 2.7 12 2.7 8.1 2.7 4.7 5.2 3.1 8.7l3.3 2.5c.8-2.4 3-4.7 5.6-4.7z" fill="#EA4335" />
    </svg>
  );
}

export function AuthThemeToggle() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("wesal-theme") !== "light";
  });

  useEffect(() => {
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(dark ? "dark" : "light");
    localStorage.setItem("wesal-theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <button
      type="button"
      onClick={() => setDark((value) => !value)}
      aria-label={dark ? "الوضع النهاري" : "الوضع الليلي"}
      className="relative grid h-10 w-10 place-items-center rounded-xl border border-line text-soft transition hover:text-[color:var(--primary-hi)]"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`absolute transition-all duration-300 ${dark ? "opacity-0 -rotate-90 scale-50" : "opacity-100"}`}>
        <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`absolute transition-all duration-300 ${dark ? "opacity-100" : "opacity-0 rotate-90 scale-50"}`}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>
  );
}

export function AuthField({ id, label, type = "text", icon, placeholder, required, autoComplete, hint, error, value, onChange }: AuthFieldProps) {
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  const isPassword = type === "password";
  const actualType = isPassword && show ? "text" : type;

  return (
    <div className="w-full">
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-bold">
        {label}
        {required && <span style={{ color: "var(--secondary)" }}> *</span>}
      </label>
      <div
        className={`relative flex items-center rounded-xl border transition ${focused ? "ring-2" : ""}`}
        style={{
          background: "rgba(255,255,255,0.03)",
          borderColor: error ? "#EF4444" : focused ? "var(--primary-hi)" : "var(--line)",
          boxShadow: focused ? "0 0 0 4px rgba(37,99,235,0.15)" : "none",
        }}
      >
        {icon && <span className="text-mute shrink-0 ps-3 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
        <input
          id={id}
          type={actualType}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          value={value}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="flex-1 bg-transparent px-3 py-3 text-[14px] outline-none placeholder:text-mute"
          dir={type === "email" || type === "password" || type === "tel" ? "ltr" : "auto"}
          style={{ color: "var(--fg)" }}
        />
        {isPassword && (
          <button type="button" onClick={() => setShow((state) => !state)} className="text-mute pe-3 transition hover:text-[color:var(--fg)]" aria-label={show ? "إخفاء" : "إظهار"}>
            {show ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><path d="M1 1l22 22" /></svg>
            )}
          </button>
        )}
      </div>
      {error && <div className="mt-1 text-[11px] font-bold text-red-400">{error}</div>}
      {!error && hint && <div className="text-mute mt-1 text-[11px]">{hint}</div>}
    </div>
  );
}

export function OrDivider({ label = "أو" }: { label?: string }) {
  return (
    <div className="text-mute my-5 flex items-center gap-3 text-[11px]">
      <div className="h-px flex-1" style={{ background: "var(--line)" }} />
      <span>{label}</span>
      <div className="h-px flex-1" style={{ background: "var(--line)" }} />
    </div>
  );
}

export function GoogleButton({ loading, disabled, onClick, label }: { loading: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-[rgba(255,255,255,0.04)] text-[13px] font-bold transition hover:bg-[rgba(255,255,255,0.08)] disabled:cursor-not-allowed disabled:opacity-60">
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" /> : <GoogleIcon />}
      <span>{label}</span>
    </button>
  );
}

function ChannelOrb({ label, className, background, delay }: { label: string; className: string; background: string; delay: number }) {
  return (
    <span className={`float-y absolute grid h-12 w-12 place-items-center rounded-2xl border border-white/10 text-sm font-black text-white shadow-xl ${className}`} style={{ background, animationDelay: `${delay}s` }}>
      {label}
    </span>
  );
}

function AuthVisual({ visualTitle, visualSubtitle, visualBullets }: AuthLayoutProps) {
  return (
    <div className="relative hidden h-full min-h-screen overflow-hidden lg:block" style={{ background: "linear-gradient(135deg, #050A18 0%, #0B1530 60%, #050A18 100%)" }}>
      <div className="pointer-events-none absolute right-[-10%] top-[-10%] h-[520px] w-[520px] rounded-full" style={{ background: "radial-gradient(circle, rgba(37,99,235,0.55), transparent 65%)", filter: "blur(80px)" }} />
      <div className="pointer-events-none absolute bottom-[-15%] left-[-10%] h-[440px] w-[440px] rounded-full" style={{ background: "radial-gradient(circle, rgba(34,211,238,0.45), transparent 65%)", filter: "blur(90px)" }} />
      <div className="grid-bg absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_80%_70%_at_50%_50%,#000_30%,transparent_80%)]" />

      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="relative aspect-square w-[min(560px,80%)]">
          <div className="orbit-ring--slow absolute inset-0 rounded-full border border-[rgba(90,140,255,0.28)]">
            <div className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 shadow-[0_0_14px_#22D3EE]" />
          </div>
          <div className="orbit-ring--rev absolute inset-[12%] rounded-full border border-dashed border-[rgba(90,140,255,0.22)]" />
          <ChannelOrb label="W" background="#25D366" delay={0} className="left-1/2 top-[8%] -translate-x-1/2" />
          <ChannelOrb label="I" background="linear-gradient(135deg,#F58529,#DD2A7B,#515BD4)" delay={0.4} className="right-[6%] top-1/2 -translate-y-1/2" />
          <ChannelOrb label="M" background="#0084FF" delay={0.8} className="bottom-[8%] left-1/2 -translate-x-1/2" />
          <ChannelOrb label="T" background="#2AABEE" delay={1.2} className="left-[6%] top-1/2 -translate-y-1/2" />
          <div className="absolute inset-0 grid place-items-center">
            <div className="relative">
              <div className="orb-pulse absolute h-[140px] w-[140px] rounded-full" style={{ margin: "-70px", background: "radial-gradient(circle, rgba(37,99,235,0.7), transparent 70%)", filter: "blur(20px)" }} />
              <div className="grid h-[112px] w-[112px] place-items-center rounded-full" style={{ background: "radial-gradient(circle at 30% 30%, #4D80FF 0%, #2563EB 45%, #0F1F3D 100%)", boxShadow: "inset 0 -8px 24px rgba(0,0,0,0.5), inset 0 8px 16px rgba(255,255,255,0.15), 0 30px 60px -20px rgba(37,99,235,0.6)" }}>
                <img src={MARK} alt="" className="h-[76px] w-[76px] rounded-full object-cover" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative flex h-full min-h-screen flex-col p-8 lg:p-12">
        <div className="mt-auto max-w-md">
          <h2 className="text-2xl font-extrabold leading-[1.3] text-white lg:text-3xl">{visualTitle}</h2>
          <p className="mt-3 text-[14px] leading-[1.9] text-slate-300">{visualSubtitle}</p>
          <ul className="mt-5 space-y-2.5">
            {visualBullets.map((bullet) => (
              <li key={bullet} className="flex items-center gap-2.5 text-[13px] text-slate-200">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cyan-300/15 text-cyan-300">✓</span>
                {bullet}
              </li>
            ))}
          </ul>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold text-slate-300" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(90,140,255,0.22)" }}>
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_#22D3EE]" />
            تجربة عربية متصلة لفريقك وقنواتك
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthHeader() {
  return (
    <div className="mb-8 flex items-center justify-between">
      <a href="/" className="shrink-0"><WesalLogo /></a>
      <div className="flex items-center gap-2">
        <AuthThemeToggle />
        <a href="/" className="hidden h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-[12.5px] font-bold text-soft transition hover:text-[color:var(--fg)] sm:inline-flex">
          العودة للموقع
        </a>
      </div>
    </div>
  );
}

export function AuthLayout({ children, visualTitle, visualSubtitle, visualBullets }: AuthLayoutProps) {
  return (
    <div className="wesal-auth min-h-screen" dir="rtl">
      <div className="grid min-h-screen lg:grid-cols-2">
        <div className="hidden lg:block lg:order-2">
          <AuthVisual visualTitle={visualTitle} visualSubtitle={visualSubtitle} visualBullets={visualBullets}>
            {null}
          </AuthVisual>
        </div>
        <div className="order-1 flex flex-col p-6 sm:p-10 lg:p-14" style={{ background: "var(--bg)" }}>
          <AuthHeader />
          <div className="grid flex-1 place-items-center">
            <div className="w-full max-w-md">{children}</div>
          </div>
          <div className="text-mute mt-8 text-center text-[11px]">
            © 2026 وصال ون · <a href="/privacy" className="transition hover:text-[color:var(--fg)]">الخصوصية</a> · <a href="/data-deletion" className="transition hover:text-[color:var(--fg)]">حذف البيانات</a> · <a href="/terms" className="transition hover:text-[color:var(--fg)]">الشروط</a>
          </div>
        </div>
      </div>
    </div>
  );
}
