import Link from "next/link"
import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"
import { LangSelector } from "@/components/lang-selector"

export async function SiteShell({ children }: { children: ReactNode }) {
  const t = await getTranslations("marketing")

  return (
    <main className="min-h-dvh bg-[#06111f] text-white">
      <header className="sticky top-0 z-50 border-white/10 border-b bg-[#06111f]/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-4 px-5 lg:px-8">
          <Link aria-label={t("brandName")} href="/">
            {/* biome-ignore lint/performance/noImgElement: public brand asset */}
            <img
              alt={t("brandName")}
              className="h-11 w-auto"
              height={96}
              src="/brand/logo_white.svg"
              width={330}
            />
          </Link>
          <nav className="hidden items-center gap-6 text-slate-300 text-sm lg:flex">
            <Link className="transition hover:text-white" href="/features">
              {t("nav.features")}
            </Link>
            <Link className="transition hover:text-white" href="/channels">
              {t("nav.channels")}
            </Link>
            <Link className="transition hover:text-white" href="/pricing">
              {t("nav.pricing")}
            </Link>
            <Link className="transition hover:text-white" href="/docs">
              {t("nav.docs")}
            </Link>
            <Link className="transition hover:text-white" href="/about">
              {t("nav.about")}
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <LangSelector />
            <Link
              className="hidden rounded-xl border border-white/15 px-4 py-2.5 font-semibold text-sm transition hover:bg-white/10 sm:inline-flex"
              href="/auth/sign-in"
            >
              {t("actions.signIn")}
            </Link>
            <Link
              className="rounded-xl bg-cyan-400 px-4 py-2.5 font-bold text-slate-950 text-sm transition hover:bg-cyan-300"
              href="/auth/sign-up"
            >
              {t("actions.start")}
            </Link>
          </div>
        </div>
      </header>

      {children}

      <footer className="border-white/10 border-t bg-[#040c16]">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 md:grid-cols-4 lg:px-8">
          <div className="md:col-span-2">
            {/* biome-ignore lint/performance/noImgElement: public brand asset */}
            <img
              alt={t("brandName")}
              className="h-12 w-auto"
              height={96}
              src="/brand/logo_white.svg"
              width={330}
            />
            <p className="mt-4 max-w-md text-slate-400 text-sm leading-7">
              {t("footer.description")}
            </p>
            <div className="mt-5 space-y-1 text-slate-400 text-sm" dir="ltr">
              <a
                className="block w-fit hover:text-white"
                href="mailto:support@wesal.one"
              >
                support@wesal.one
              </a>
              <a
                className="block w-fit hover:text-white"
                href="https://wa.me/967775324950"
              >
                +967 775 324 950
              </a>
            </div>
          </div>
          <div>
            <h2 className="font-bold text-sm">{t("footer.product")}</h2>
            <div className="mt-4 flex flex-col gap-3 text-slate-400 text-sm">
              <Link href="/features">{t("nav.features")}</Link>
              <Link href="/channels">{t("nav.channels")}</Link>
              <Link href="/pricing">{t("nav.pricing")}</Link>
              <Link href="/docs">{t("nav.docs")}</Link>
            </div>
          </div>
          <div>
            <h2 className="font-bold text-sm">{t("footer.company")}</h2>
            <div className="mt-4 flex flex-col gap-3 text-slate-400 text-sm">
              <Link href="/about">{t("nav.about")}</Link>
              <Link href="/contact">{t("nav.contact")}</Link>
              <Link href="/privacy">{t("footer.privacy")}</Link>
              <Link href="/terms">{t("footer.terms")}</Link>
              <Link href="/data-deletion">{t("footer.dataDeletion")}</Link>
            </div>
          </div>
        </div>
        <div className="border-white/10 border-t py-5 text-center text-slate-500 text-xs">
          {t("footer.copyright")}
        </div>
      </footer>
    </main>
  )
}
