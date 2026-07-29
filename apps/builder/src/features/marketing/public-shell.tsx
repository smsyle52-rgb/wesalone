import Link from "next/link"
import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"
import { LangSelector } from "@/components/lang-selector"

const productLinks = [
  ["المزايا", "/features"],
  ["القنوات", "/channels"],
  ["الأسعار", "/pricing"],
  ["الأسئلة الشائعة", "/faq"],
] as const

export async function PublicShell({ children }: { children: ReactNode }) {
  const t = await getTranslations("marketing")

  return (
    <main className="min-h-dvh bg-slate-950 font-[Tajawal] text-white selection:bg-cyan-300 selection:text-slate-950">
      <header className="sticky top-0 z-50 border-white/10 border-b bg-slate-950/85 backdrop-blur-xl">
        <div className="mx-auto flex min-h-18 max-w-7xl items-center justify-between gap-3 px-5 lg:px-8">
          <Link aria-label={t("brandName")} className="flex items-center" href="/">
            {/* biome-ignore lint/performance/noImgElement: official platform-owned SVG */}
            <img alt={t("brandName")} className="h-10 w-auto" height={96} src="/brand/logo_white.svg" width={330} />
          </Link>
          <nav aria-label="التنقل الرئيسي" className="hidden items-center gap-6 text-slate-300 text-sm lg:flex">
            {productLinks.map(([label, href]) => <Link className="transition hover:text-cyan-200" href={href} key={href}>{label}</Link>)}
            <Link className="transition hover:text-cyan-200" href="/about">عن وصال ون</Link>
            <Link className="transition hover:text-cyan-200" href="/contact">تواصل معنا</Link>
          </nav>
          <div className="flex items-center gap-2">
            <LangSelector />
            <Link className="hidden rounded-lg px-3 py-2 font-bold text-sm transition hover:bg-white/10 sm:inline-flex" href="/auth/sign-in">{t("actions.signIn")}</Link>
            <Link className="rounded-lg bg-cyan-300 px-3 py-2 font-bold text-slate-950 text-sm transition hover:bg-cyan-200 sm:px-4" href="/auth/sign-up">{t("actions.start")}</Link>
          </div>
        </div>
      </header>

      {children}

      <footer className="border-white/10 border-t bg-[#031127]">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 md:grid-cols-4 lg:px-8">
          <div className="md:col-span-2">
            {/* biome-ignore lint/performance/noImgElement: official platform-owned SVG */}
            <img alt={t("brandName")} className="h-11 w-auto" height={96} src="/brand/logo_white.svg" width={330} />
            <p className="mt-4 max-w-md text-slate-400 text-sm leading-7">منصة عربية لتنظيم محادثات الأعمال والقنوات والفريق والذكاء الاصطناعي في مساحة تشغيل واحدة.</p>
          </div>
          <div><h2 className="font-bold text-sm">المنتج</h2><div className="mt-4 flex flex-col gap-3 text-slate-400 text-sm">{productLinks.map(([label, href]) => <Link className="hover:text-white" href={href} key={href}>{label}</Link>)}</div></div>
          <div><h2 className="font-bold text-sm">المعلومات</h2><div className="mt-4 flex flex-col gap-3 text-slate-400 text-sm"><Link href="/about">عن وصال ون</Link><Link href="/contact">تواصل معنا</Link><Link href="/privacy">سياسة الخصوصية</Link><Link href="/terms">شروط الاستخدام</Link><Link href="/data-deletion">حذف البيانات</Link></div></div>
        </div>
        <div className="border-white/10 border-t py-5 text-center text-slate-500 text-xs">{t("footer.copyright")}</div>
      </footer>
    </main>
  )
}
