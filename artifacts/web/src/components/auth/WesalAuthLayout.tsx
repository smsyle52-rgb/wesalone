import { useState, type ReactNode } from "react";
import { ArrowLeft, Check, Moon, Sun } from "lucide-react";
import "@/styles/wesal-auth.css";

function Mark({ size = 45 }: { size?: number }) {
  return (
    <img
      src="/assets/wesal/wesal-logo-mark.png"
      alt=""
      aria-hidden="true"
      className="auth-logo-mark"
      style={{ width: size, height: size }}
    />
  );
}

export function WesalLogo() {
  return (
    <span className="wesal-auth-logo" dir="rtl">
      <Mark />
      <span>
        <strong>وصال ون</strong>
        <small>Wesal One</small>
      </span>
    </span>
  );
}

function AuthMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="auth-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Visual({
  title,
  subtitle,
  bullets,
}: {
  title: string;
  subtitle: string;
  bullets: string[];
}) {
  return (
    <aside className="auth-visual">
      <div className="auth-visual-grid" />
      <div className="auth-visual-glow" />
      <div className="auth-preview-card">
        <div className="auth-preview-top">
          <span>متصل</span>
          <b>وصال ون</b>
        </div>
        <img
          src="/assets/wesal/agents-hero-reference.png"
          alt="وكلاء وصال ون"
          loading="eager"
        />
        <div className="auth-preview-floating">
          <span className="live-dot" />
          الوكلاء يعملون الآن
        </div>
      </div>
      <div className="auth-copy">
        <h2>{title}</h2>
        <p>{subtitle}</p>
        <ul>
          {bullets.map((bullet) => (
            <li key={bullet}>
              <Check />
              {bullet}
            </li>
          ))}
        </ul>
      </div>
      <div className="auth-metrics">
        <AuthMetric value="RTL" label="تجربة عربية" />
        <AuthMetric value="24/7" label="تشغيل مستمر" />
        <AuthMetric value="آمن" label="عزل وخصوصية" />
      </div>
    </aside>
  );
}

export function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285f4"
        d="M22.6 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.8h3.6c2.1-2 3.3-4.8 3.3-8.1"
      />
      <path
        fill="#34a853"
        d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1a6.4 6.4 0 0 1-6.2-4.5H2.2V17A11 11 0 0 0 12 23"
      />
      <path
        fill="#fbbc05"
        d="M5.8 14.1a6.5 6.5 0 0 1 0-4.2V7.1H2.2A11 11 0 0 0 1 12c0 1.8.4 3.5 1.2 4.9z"
      />
      <path
        fill="#ea4335"
        d="M12 5.4c1.6 0 3.1.6 4.2 1.6l3.2-3.1A10.6 10.6 0 0 0 12 1a11 11 0 0 0-9.8 6.1l3.6 2.8A6.4 6.4 0 0 1 12 5.4"
      />
    </svg>
  );
}

export function AuthLayout({
  children,
  title,
  subtitle,
  bullets,
}: {
  children: ReactNode;
  title: string;
  subtitle: string;
  bullets: string[];
}) {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("wesal-theme") !== "light";
  });

  function toggleTheme() {
    setDark((value) => {
      const next = !value;
      localStorage.setItem("wesal-theme", next ? "dark" : "light");
      return next;
    });
  }

  return (
    <div className={`wesal-auth ${dark ? "dark" : "light"}`} dir="rtl">
      <div className="auth-shell">
        <Visual title={title} subtitle={subtitle} bullets={bullets} />
        <section className="auth-form-panel">
          <header className="auth-header">
            <a href="/" aria-label="وصال ون">
              <WesalLogo />
            </a>
            <div>
              <button
                type="button"
                onClick={toggleTheme}
                className="auth-secondary auth-icon-button"
                aria-label="تغيير المظهر"
              >
                {dark ? <Moon /> : <Sun />}
              </button>
              <a href="/" className="auth-secondary auth-site-link">
                الموقع
                <ArrowLeft />
              </a>
            </div>
          </header>

          <main className="auth-form-wrap">{children}</main>

          <footer className="auth-footer">
            © 2026 وصال ون ·{" "}
            <a className="auth-link" href="/privacy">
              الخصوصية
            </a>{" "}
            ·{" "}
            <a className="auth-link" href="/terms">
              الشروط
            </a>
          </footer>
        </section>
      </div>
    </div>
  );
}
