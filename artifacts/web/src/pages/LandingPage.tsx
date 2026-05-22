import { useEffect, useState } from "react";
import {
  BrandLogo,
  FeatureCards,
  FeatureStrip,
  FinalCTA,
  Footer,
  HowItWorks,
  LandingHero,
  ProductShowcase,
  StatsSection,
  Testimonials,
  ThemeToggle,
  type LandingTheme,
} from "@/components/landing/WesalLandingSections";

const navItems = [
  { href: "#home", label: "الرئيسية" },
  { href: "/products", label: "منتجاتنا" },
  { href: "#features", label: "المزايا" },
  { href: "#testimonials", label: "آراء العملاء" },
  { href: "/about", label: "من نحن" },
  { href: "/contact", label: "تواصل معنا" },
];

export default function LandingPage() {
  const [theme, setTheme] = useState<LandingTheme>("light");

  useEffect(() => {
    document.documentElement.style.scrollBehavior = "smooth";
    return () => {
      document.documentElement.style.scrollBehavior = "";
    };
  }, []);

  return (
    <main dir="rtl" data-landing-theme={theme} className="min-h-screen overflow-hidden bg-[#F0F7FF] text-[#1B3A5C]">
      <header className="sticky top-0 z-50 border-b border-[#dce8f5] bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-24 w-[min(100%-2rem,1180px)] items-center justify-between gap-4">
          <BrandLogo />
          <nav className="hidden items-center gap-8 md:flex" aria-label="روابط الصفحة">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} className="text-sm font-bold text-slate-600 transition hover:text-[#0B6FE8]">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <ThemeToggle theme={theme} onToggle={() => setTheme((current) => (current === "light" ? "dark" : "light"))} />
            <a
              href="/register"
              className="landing-ripple rounded-lg bg-[#0B6FE8] px-6 py-3 text-sm font-black text-white shadow-[0_14px_30px_rgba(11,111,232,.24)] transition hover:-translate-y-0.5 hover:bg-[#075dcc]"
            >
              ابدأ الآن
            </a>
          </div>
        </div>
      </header>

      <LandingHero />
      <FeatureStrip />
      <FeatureCards />
      <ProductShowcase />
      <StatsSection />
      <HowItWorks />
      <Testimonials />
      <FinalCTA />
      <Footer />
    </main>
  );
}
