import {
  BrandLogo,
  FeatureCards,
  FinalCTA,
  Footer,
  HowItWorks,
  LandingHero,
  StatsSection,
  Testimonials,
} from "@/components/landing/WesalLandingSections";

const navItems = [
  { href: "#home", label: "الرئيسية" },
  { href: "#features", label: "المزايا" },
  { href: "#how", label: "كيف يعمل" },
  { href: "#testimonials", label: "آراء العملاء" },
];

export default function LandingPage() {
  return (
    <main dir="rtl" className="min-h-screen overflow-hidden bg-[#f7fbff] text-[#0d2544]">
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/86 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-[min(100%-2rem,1180px)] items-center justify-between gap-4">
          <BrandLogo />
          <nav className="hidden items-center gap-8 md:flex" aria-label="روابط الصفحة">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-sm font-semibold text-slate-600 transition hover:text-[#075bd8]"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <a
              href="/login"
              className="hidden rounded-lg px-4 py-2 text-sm font-bold text-[#0b3360] transition hover:bg-slate-100 sm:inline-flex"
            >
              تسجيل الدخول
            </a>
            <a
              href="/register"
              className="rounded-lg bg-[#075bd8] px-5 py-2.5 text-sm font-bold text-white shadow-[0_14px_30px_rgba(7,91,216,.24)] transition hover:-translate-y-0.5 hover:bg-[#064fc0]"
            >
              ابدأ الآن
            </a>
          </div>
        </div>
      </header>

      <LandingHero />
      <FeatureCards />
      <StatsSection />
      <HowItWorks />
      <Testimonials />
      <FinalCTA />
      <Footer />
    </main>
  );
}
