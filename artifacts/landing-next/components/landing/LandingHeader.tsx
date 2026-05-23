"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const navItems = [
  { href: "#home", label: "الرئيسية" },
  { href: "#channels", label: "القنوات" },
  { href: "#features", label: "المزايا" },
  { href: "#stats", label: "الأرقام" },
  { href: "#contact", label: "تواصل معنا" },
];

export function LandingHeader() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4">
      <div className="mx-auto flex h-[74px] w-full max-w-7xl items-center justify-between gap-4 rounded-[1.4rem] border border-white/75 bg-white/82 px-4 shadow-[0_22px_70px_rgba(27,58,92,.10)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#06111f]/78 dark:shadow-[0_24px_70px_rgba(0,0,0,.34)] sm:px-5">
        <Logo />
        <nav className="hidden items-center gap-8 rounded-full border border-slate-200/70 bg-white/65 px-7 py-3 shadow-sm backdrop-blur-xl lg:flex dark:border-white/10 dark:bg-white/6" aria-label="روابط الصفحة">
          {navItems.map((item) => (
            <a key={item.href} href={item.href} className="text-sm font-bold text-slate-600 transition hover:text-wesal-blue dark:text-slate-200 dark:hover:text-cyan-300">
              {item.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setDark((value) => !value)}
            className="grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white text-wesal-primary shadow-[0_12px_30px_rgba(27,58,92,.12)] transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/10 dark:text-white"
            aria-label={dark ? "تفعيل وضع النهار" : "تفعيل وضع الليل"}
          >
            {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          <a href="#contact" className="rounded-xl bg-wesal-blue px-5 py-3 text-sm font-black text-white shadow-[0_18px_38px_rgba(11,111,232,.28)] transition hover:-translate-y-0.5 hover:bg-[#075dcc] sm:px-6">
            ابدأ الآن
          </a>
        </div>
      </div>
    </header>
  );
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <a href="#home" className="flex items-center gap-2.5 sm:gap-3" aria-label="وصال ون">
      <svg className="h-12 w-20 sm:h-14 sm:w-24" viewBox="0 0 128 76" role="img" aria-label="Wesal One logo">
        <defs>
          <linearGradient id="wesalLogoMain" x1="16" x2="118" y1="68" y2="6" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1B3A5C" />
            <stop offset=".46" stopColor="#0B6FE8" />
            <stop offset="1" stopColor="#1FB6A6" />
          </linearGradient>
          <linearGradient id="wesalLogoWing" x1="54" x2="120" y1="68" y2="5" gradientUnits="userSpaceOnUse">
            <stop stopColor="#083A82" />
            <stop offset=".62" stopColor="#0B6FE8" />
            <stop offset="1" stopColor="#32E0D1" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="#38D8CF" strokeLinecap="round" strokeWidth="6.9">
          <path d="M10 20h27" />
          <path d="M2 34h40" />
          <path d="M12 49h31" />
          <path d="M0 9h15" />
        </g>
        <path d="M27 15c8 24 18 40 30 47 8-14 18-33 29-56 9-4 21-6 37-6-11 24-27 49-47 74-12 1-22-2-31-10-11-10-21-26-30-48 4-3 8-3 12-1Z" fill="url(#wesalLogoMain)" />
        <path d="M58 62c12-25 30-46 55-62-6 16-16 35-30 57-8 11-17 14-25 5Z" fill="url(#wesalLogoWing)" />
        <path d="M69 51c14-14 27-28 38-43M75 59c12-11 22-23 30-36M61 45c11-10 21-20 30-31" stroke="#B8FFF8" strokeLinecap="round" strokeWidth="2.8" opacity=".72" />
      </svg>
      <span className="leading-tight">
        <span className={`block text-xl font-black sm:text-2xl ${light ? "text-white" : "text-wesal-primary dark:text-white"}`}>وصال ون</span>
        <span className="block text-xs font-bold tracking-[0.18em] text-wesal-accent sm:text-sm">Wesal One</span>
      </span>
    </a>
  );
}
