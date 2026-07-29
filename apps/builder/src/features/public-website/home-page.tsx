import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Cable,
  ChartNoAxesCombined,
  Check,
  MessagesSquare,
  ShieldCheck,
  Workflow,
} from "lucide-react"
import Link from "next/link"
import { getLocale, getTranslations } from "next-intl/server"
import { SiteShell } from "./site-shell"

const icons = [
  MessagesSquare,
  Bot,
  Workflow,
  Cable,
  ChartNoAxesCombined,
  ShieldCheck,
]

export async function HomePage() {
  const locale = await getLocale()
  const t = await getTranslations("marketing")
  const features = t.raw("features.items") as Array<{
    title: string
    description: string
  }>
  const points = t.raw("control.items") as string[]
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight

  return (
    <SiteShell>
      <section className="relative overflow-hidden border-white/10 border-b">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(34,211,238,.18),transparent_35%),radial-gradient(circle_at_85%_45%,rgba(59,130,246,.14),transparent_30%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-5 py-20 lg:grid-cols-[1.08fr_.92fr] lg:px-8 lg:py-28">
          <div>
            <span className="inline-flex rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 font-semibold text-cyan-200 text-sm">
              {t("hero.badge")}
            </span>
            <h1 className="mt-7 max-w-4xl text-balance font-black text-4xl leading-tight sm:text-6xl">
              {t("hero.titleBefore")}{" "}
              <span className="text-cyan-300">{t("hero.titleHighlight")}</span>{" "}
              {t("hero.titleAfter")}
            </h1>
            <p className="mt-6 max-w-2xl text-slate-300 text-lg leading-8">
              {t("hero.description")}
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-6 py-3.5 font-bold text-slate-950"
                href="/auth/sign-up"
              >
                {t("actions.start")} <Arrow className="h-4 w-4" />
              </Link>
              <Link
                className="rounded-xl border border-white/15 px-6 py-3.5 font-bold hover:bg-white/5"
                href="/docs"
              >
                {t("hero.learnMore")}
              </Link>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-slate-400 text-sm">
              {[t("hero.trial"), t("hero.noCard"), t("hero.fastSetup")].map(
                (item) => (
                  <span className="flex items-center gap-2" key={item}>
                    <Check className="h-4 w-4 text-emerald-400" />
                    {item}
                  </span>
                ),
              )}
            </div>
          </div>
          <div className="rounded-[2rem] border border-white/10 bg-white/[.045] p-5 shadow-2xl shadow-cyan-950/40">
            <div className="flex items-center justify-between border-white/10 border-b pb-4">
              <div>
                <p className="font-bold">{t("demo.title")}</p>
                <p className="text-slate-500 text-xs">{t("demo.subtitle")}</p>
              </div>
              <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-emerald-300 text-xs">
                {t("demo.active")}
              </span>
            </div>
            <div className="space-y-5 py-7">
              <div className="ms-auto max-w-[85%] rounded-2xl rounded-ee-sm bg-white/10 p-4 text-slate-200 text-sm leading-7">
                {t("demo.customer")}
              </div>
              <div className="me-auto max-w-[88%] rounded-2xl rounded-es-sm bg-cyan-400 p-4 font-medium text-slate-950 text-sm leading-7">
                {t("demo.agent")}
              </div>
            </div>
            <div className="rounded-2xl border border-blue-300/15 bg-blue-400/10 p-4">
              <p className="font-bold text-blue-200 text-sm">
                {t("demo.handoffTitle")}
              </p>
              <p className="mt-1 text-slate-400 text-xs leading-6">
                {t("demo.handoffDescription")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="max-w-3xl">
          <p className="font-bold text-cyan-300 text-sm">
            {t("features.eyebrow")}
          </p>
          <h2 className="mt-3 font-black text-3xl sm:text-5xl">
            {t("features.title")}
          </h2>
          <p className="mt-5 text-slate-400 leading-8">
            {t("features.description")}
          </p>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => {
            const Icon = icons[index] ?? Bot
            return (
              <article
                className="rounded-3xl border border-white/10 bg-white/[.035] p-6"
                key={feature.title}
              >
                <Icon className="h-7 w-7 text-cyan-300" />
                <h3 className="mt-5 font-bold text-xl">{feature.title}</h3>
                <p className="mt-3 text-slate-400 text-sm leading-7">
                  {feature.description}
                </p>
              </article>
            )
          })}
        </div>
      </section>

      <section className="border-white/10 border-y bg-white/[.025]">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-2 lg:px-8">
          <div>
            <p className="font-bold text-cyan-300 text-sm">
              {t("control.eyebrow")}
            </p>
            <h2 className="mt-3 font-black text-3xl sm:text-5xl">
              {t("control.title")}
            </h2>
            <p className="mt-5 text-slate-400 leading-8">
              {t("control.description")}
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-[#071727] p-7">
            <h3 className="font-black text-2xl">{t("control.cardTitle")}</h3>
            <p className="mt-3 text-slate-400 leading-7">
              {t("control.cardDescription")}
            </p>
            <ul className="mt-7 grid gap-4 sm:grid-cols-2">
              {points.map((item) => (
                <li className="flex gap-3 text-sm" key={item}>
                  <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-20 text-center lg:px-8">
        <h2 className="font-black text-3xl sm:text-5xl">{t("cta.title")}</h2>
        <p className="mx-auto mt-5 max-w-2xl text-slate-400 leading-8">
          {t("cta.description")}
        </p>
        <Link
          className="mt-8 inline-flex rounded-xl bg-cyan-400 px-7 py-3.5 font-bold text-slate-950"
          href="/auth/sign-up"
        >
          {t("actions.start")}
        </Link>
      </section>
    </SiteShell>
  )
}
