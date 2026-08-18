"use client"

import {
  SiInstagram,
  SiMessenger,
  SiTelegram,
  SiWhatsapp,
} from "@icons-pack/react-simple-icons"
import { Check } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import type { ReactNode } from "react"
import { LangSelector } from "@/components/lang-selector"
import { ThemeSwitcher } from "@/components/theme-switcher"

const channelIcons = [
  { Icon: SiWhatsapp, background: "#25D366" },
  {
    Icon: SiInstagram,
    background: "linear-gradient(135deg,#F58529,#DD2A7B,#515BD4)",
  },
  { Icon: SiMessenger, background: "#0084FF" },
  { Icon: SiTelegram, background: "#2AABEE" },
] as const

const iconPositions = [
  "left-1/2 top-[8%] -translate-x-1/2",
  "right-[6%] top-1/2 -translate-y-1/2",
  "bottom-[8%] left-1/2 -translate-x-1/2",
  "left-[6%] top-1/2 -translate-y-1/2",
] as const

export function WesalAuthShell({ children }: { children: ReactNode }) {
  const t = useTranslations()
  const pathname = usePathname()
  const isSignUp = pathname?.startsWith("/auth/sign-up")

  const visual = isSignUp
    ? {
        badge: t("auth.signUpVisual.trialBadge"),
        title: t("auth.signUpVisual.title"),
        subtitle: t("auth.signUpVisual.subtitle"),
        bullets: [0, 1, 2].map((index) =>
          t(`auth.signUpVisual.bullets.${index}`),
        ),
      }
    : {
        badge: null,
        title: t("auth.signInVisual.title"),
        subtitle: t("auth.signInVisual.subtitle"),
        bullets: [0, 1, 2].map((index) =>
          t(`auth.signInVisual.bullets.${index}`),
        ),
      }

  return (
    <main
      className="legacy-wesal-auth grid min-h-svh overflow-hidden lg:grid-cols-2"
      dir="rtl"
    >
      <section className="legacy-auth-form order-1 flex min-w-0 flex-col px-6 py-6 sm:px-10 sm:py-10 lg:px-14">
        <header className="mb-8 flex items-center justify-between gap-4">
          <Link className="shrink-0" href="/">
            <Image
              alt={t("marketing.brandName")}
              className="h-14 w-auto object-contain"
              height={80}
              priority
              src="/assets/wesal/wesal-logo.png"
              width={271}
            />
          </Link>
          <div className="flex items-center gap-2">
            <LangSelector />
            <ThemeSwitcher />
            <Link
              className="legacy-auth-site-link hidden sm:inline-flex"
              href="/"
            >
              {t("actions.back")}
            </Link>
          </div>
        </header>

        <div className="grid flex-1 place-items-center py-6">
          <div className="legacy-auth-card w-full max-w-md">{children}</div>
        </div>

        <footer className="legacy-auth-footer mt-8 text-center text-[11px]">
          <span>{t("marketing.footer.copyright")}</span>
          <span aria-hidden="true"> · </span>
          <Link href="/privacy">{t("marketing.footer.privacy")}</Link>
          <span aria-hidden="true"> · </span>
          <Link href="/data-deletion">
            {t("marketing.footer.dataDeletion")}
          </Link>
          <span aria-hidden="true"> · </span>
          <Link href="/terms">{t("marketing.footer.terms")}</Link>
        </footer>
      </section>

      <aside className="legacy-auth-visual relative order-2 hidden min-h-svh overflow-hidden lg:block">
        <div className="legacy-auth-glow-blue pointer-events-none absolute -top-[10%] -right-[10%] h-[520px] w-[520px] rounded-full" />
        <div className="legacy-auth-glow-cyan pointer-events-none absolute -bottom-[15%] -left-[10%] h-[440px] w-[440px] rounded-full" />
        <div className="legacy-auth-grid pointer-events-none absolute inset-0 opacity-40" />

        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="relative aspect-square w-[min(560px,80%)]">
            <div className="legacy-orbit-ring--slow absolute inset-0 rounded-full border border-[rgba(90,140,255,0.28)]">
              <div className="absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 shadow-[0_0_14px_#22D3EE]" />
            </div>
            <div className="legacy-orbit-ring--rev absolute inset-[12%] rounded-full border border-[rgba(90,140,255,0.22)] border-dashed" />
            {channelIcons.map(({ Icon, background }, index) => (
              <span
                className={`legacy-float-y absolute grid h-12 w-12 place-items-center rounded-2xl border border-white/10 text-white shadow-xl ${iconPositions[index]}`}
                key={Icon.displayName ?? String(index)}
                style={{ animationDelay: `${index * 0.4}s`, background }}
              >
                <Icon className="h-5 w-5" color="white" />
              </span>
            ))}
            <div className="absolute inset-0 grid place-items-center">
              <div className="relative">
                <div className="legacy-orb-pulse absolute h-[140px] w-[140px] rounded-full" />
                <div className="legacy-auth-mark grid h-[112px] w-[112px] place-items-center rounded-full">
                  <Image
                    alt=""
                    className="h-[76px] w-[76px] rounded-full object-cover"
                    height={96}
                    src="/assets/wesal/wesal-mark.png"
                    width={96}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative flex min-h-svh flex-col p-8 lg:p-12">
          <div className="mt-auto max-w-md">
            {visual.badge && (
              <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-[rgba(90,140,255,0.22)] bg-white/6 px-3 py-1.5 font-bold text-[11px] text-cyan-300">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_#22D3EE]" />
                {visual.badge}
              </span>
            )}
            <h2 className="font-extrabold text-2xl text-white leading-[1.3] lg:text-3xl">
              {visual.title}
            </h2>
            <p className="mt-3 text-[14px] text-slate-300 leading-[1.9]">
              {visual.subtitle}
            </p>
            <ul className="mt-5 space-y-2.5">
              {visual.bullets.map((bullet, index) => (
                <li
                  className="flex items-center gap-2.5 text-[13px] text-slate-200"
                  key={String(index)}
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cyan-300/15 text-cyan-300">
                    <Check className="h-3 w-3" />
                  </span>
                  {bullet}
                </li>
              ))}
            </ul>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[rgba(90,140,255,0.22)] bg-white/6 px-3 py-1.5 font-bold text-[11px] text-slate-300">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_#22D3EE]" />
              {t("marketing.brandName")}
            </div>
          </div>
        </div>
      </aside>
    </main>
  )
}
