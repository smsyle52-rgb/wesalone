import { CTA } from "@/components/landing/CTA";
import { Channels } from "@/components/landing/Channels";
import { Features } from "@/components/landing/Features";
import { Hero } from "@/components/landing/Hero";
import { LandingHeader, Logo } from "@/components/landing/LandingHeader";
import { ProductShowcase } from "@/components/landing/ProductShowcase";
import { Stats } from "@/components/landing/Stats";

export default function Page() {
  return (
    <main className="min-h-screen overflow-hidden bg-wesal-bg text-wesal-ink dark:bg-[#020814] dark:text-white">
      <LandingHeader />
      <Hero />
      <Channels />
      <Features />
      <ProductShowcase />
      <Stats />
      <CTA />
      <footer id="contact" className="bg-[#061f3d] px-4 py-12 text-white dark:bg-[#020814]">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-4">
          <div>
            <Logo light />
            <p className="mt-5 text-sm leading-7 text-blue-100">منصة موحدة تساعد التجار على تنظيم المحادثات، متابعة العملاء، ورفع جودة الخدمة من مكان واحد.</p>
          </div>
          {[
            ["المنتج", "المزايا", "القنوات", "الأرقام"],
            ["الشركة", "من نحن", "الخصوصية", "الشروط"],
            ["الدعم", "تواصل معنا", "مركز المساعدة", "طلب تجربة"],
          ].map(([title, ...items]) => (
            <div key={title}>
              <h3 className="font-black">{title}</h3>
              <ul className="mt-4 space-y-3 text-sm text-blue-100">
                {items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-10 text-center text-sm text-blue-100">© 2026 وصال ون. جميع الحقوق محفوظة.</p>
      </footer>
    </main>
  );
}
