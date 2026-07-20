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

export function WesalAuthShell({ children }: { children: ReactNode }) {
  const t = useTranslations()
  const pathname = usePathname()

  const visual = pathname?.startsWith("/auth/sign-up")
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
    <main className="grid min-h-svh overflow-hidden bg-[#050a18] text-white lg:grid-cols-2">
      <section className="order-1 flex min-w-0 flex-col bg-background px-4 py-5 text-foreground sm:px-8 sm:py-8 lg:px-12">
        <header className="flex items-center justify-between gap-4">
          <Link className="flex items-center gap-3" href="/">
            <Image
              alt={t("marketing.brandName")}
              className="h-12 w-12 rounded-2xl object-cover shadow-blue-950/30 shadow-lg"
              height={64}
              priority
              src="/assets/wesal/wesal-w.png"
              width={64}
            />
            <span className="flex flex-col leading-none">
              <strong className="text-lg">{t("marketing.brandName")}</strong>
              <span className="mt-1 font-bold text-[10px] text-cyan-500 tracking-[0.18em]">
                WESAL ONE
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <LangSelector />
            <ThemeSwitcher />
          </div>
        </header>

        <div className="mx-auto grid w-full max-w-lg flex-1 place-items-center py-8">
          <div className="w-full [&_[data-slot=card]]:rounded-[1.75rem] [&_[data-slot=card]]:border-border/70 [&_[data-slot=card]]:shadow-2xl [&_[data-slot=card]]:shadow-blue-950/10">
            {children}
          </div>
        </div>

        <footer className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-center text-muted-foreground text-xs">
          <span>{t("marketing.footer.copyright")}</span>
          <Link className="underline underline-offset-4" href="/privacy">
            {t("marketing.footer.privacy")}
          </Link>
          <Link className="underline underline-offset-4" href="/data-deletion">
            {t("marketing.footer.dataDeletion")}
          </Link>
          <Link className="underline underline-offset-4" href="/terms">
            {t("marketing.footer.terms")}
          </Link>
        </footer>
      </section>

      <aside className="relative order-2 hidden min-h-svh overflow-hidden border-white/10 border-s bg-[linear-gradient(135deg,#050a18_0%,#0b1530_60%,#050a18_100%)] lg:flex lg:flex-col lg:justify-end lg:p-12">
        <div className="pointer-events-none absolute -end-32 -top-32 h-[32rem] w-[32rem] rounded-full bg-blue-600/35 blur-3xl" />
        <div className="pointer-events-none absolute -start-32 -bottom-40 h-[28rem] w-[28rem] rounded-full bg-cyan-500/25 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(125,211,252,.18)_1px,transparent_0)] bg-[size:32px_32px] opacity-40 [mask-image:radial-gradient(ellipse_75%_70%_at_50%_45%,#000_25%,transparent_80%)]" />

        <div className="absolute inset-x-0 top-[12%] mx-auto aspect-square w-[min(31rem,72%)] rounded-full border border-blue-300/20">
          <div className="absolute inset-[13%] rounded-full border border-cyan-300/20 border-dashed" />
          {channelIcons.map(({ Icon, background }, index) => {
            const positions = [
              "start-1/2 top-0 -translate-x-1/2 -translate-y-1/2",
              "end-0 top-1/2 translate-x-1/2 -translate-y-1/2",
              "start-1/2 bottom-0 -translate-x-1/2 translate-y-1/2",
              "start-0 top-1/2 -translate-x-1/2 -translate-y-1/2",
            ]
            return (
              <span
                className={`absolute grid h-12 w-12 place-items-center rounded-2xl border border-white/15 text-white shadow-xl ${positions[index]}`}
                key={Icon.displayName ?? String(index)}
                style={{ background }}
              >
                <Icon className="h-5 w-5" color="white" />
              </span>
            )
          })}
          <div className="absolute inset-0 grid place-items-center">
            <div className="grid h-28 w-28 place-items-center rounded-full border border-white/15 bg-blue-600/30 shadow-[0_0_70px_rgba(37,99,235,.55)] backdrop-blur-xl">
              <Image
                alt=""
                className="h-20 w-20 rounded-full object-cover"
                height={96}
                src="/assets/wesal/wesal-mark.png"
                width={96}
              />
            </div>
          </div>
        </div>

        <div className="relative max-w-xl">
          {visual.badge && (
            <span className="mb-4 inline-flex items-center gap-2 rounded-full bg-cyan-300/15 px-3 py-1.5 font-bold text-[11px] text-cyan-300">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
              {visual.badge}
            </span>
          )}
          <p className="font-black text-3xl leading-tight">{visual.title}</p>
          <p className="mt-4 text-slate-300 leading-8">{visual.subtitle}</p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {visual.bullets.map((bullet, index) => (
              <li
                className="flex items-center gap-2 text-slate-200 text-sm"
                key={String(index)}
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cyan-300/15 text-cyan-300">
                  <Check className="h-3 w-3" />
                </span>
                {bullet}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  )
}
