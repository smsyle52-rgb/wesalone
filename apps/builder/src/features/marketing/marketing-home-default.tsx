import {
  ArrowLeft,
  BarChart3,
  Bot,
  Check,
  Headphones,
  Inbox,
  ShieldCheck,
  ShoppingBag,
  Users,
  Workflow,
} from "lucide-react"
import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { PublicShell } from "./public-shell"

const featureIcons = [
  Inbox,
  Bot,
  Users,
  ShoppingBag,
  Workflow,
  BarChart3,
] as const

export async function MarketingHome() {
  const t = await getTranslations("marketing")

  return (
    <PublicShell>
      <section className="relative overflow-hidden py-20 lg:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(34,211,238,.18),transparent_35%),radial-gradient(circle_at_20%_50%,rgba(37,99,235,.22),transparent_38%)]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 lg:grid-cols-2 lg:px-8">
          <div>
            <span className="inline-flex rounded-full border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 font-bold text-cyan-300 text-xs">
              {t("hero.badge")}
            </span>
            <h1 className="mt-7 text-balance font-black text-4xl leading-tight sm:text-5xl lg:text-6xl">
              {t("hero.titleBefore")}{" "}
              <span className="bg-gradient-to-l from-cyan-300 to-blue-400 bg-clip-text text-transparent">
                {t("hero.titleHighlight")}
              </span>{" "}
              {t("hero.titleAfter")}
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-base text-slate-300 leading-8 lg:text-lg">
              {t("hero.description")}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-6 py-3.5 font-bold text-slate-950 transition hover:bg-cyan-300"
                href="/auth/sign-up"
              >
                {t("actions.start")}
                <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
              </Link>
              <Link
                className="rounded-xl border border-white/15 px-6 py-3.5 font-bold transition hover:bg-white/10"
                href="/features"
              >
                {t("hero.learnMore")}
              </Link>
            </div>
            <div className="mt-5 flex flex-wrap gap-5 text-slate-400 text-xs">
              {["trial", "noCard", "fastSetup"].map((key) => (
                <span className="flex items-center gap-2" key={key}>
                  <Check className="h-4 w-4 text-emerald-400" />
                  {t(`hero.${key}`)}
                </span>
              ))}
            </div>
          </div>

          <div className="relative rounded-[2rem] border border-white/10 bg-white/[.045] p-5 shadow-2xl shadow-cyan-950/30 backdrop-blur">
            <div className="flex items-center justify-between border-white/10 border-b pb-4">
              <div>
                <p className="font-bold">{t("demo.title")}</p>
                <p className="mt-1 text-slate-400 text-xs">
                  {t("demo.subtitle")}
                </p>
              </div>
              <span className="rounded-full bg-emerald-400/10 px-3 py-1.5 font-bold text-emerald-300 text-xs">
                {t("demo.active")}
              </span>
            </div>
            <div className="mt-5 space-y-4">
              <div className="me-12 rounded-2xl rounded-tr-sm bg-white/10 p-4 text-sm leading-7">
                {t("demo.customer")}
              </div>
              <div className="ms-12 rounded-2xl rounded-tl-sm border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm leading-7">
                {t("demo.agent")}
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4">
                <Headphones className="h-5 w-5 text-amber-300" />
                <div>
                  <p className="font-bold text-sm">{t("demo.handoffTitle")}</p>
                  <p className="mt-1 text-slate-400 text-xs">
                    {t("demo.handoffDescription")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className="border-white/10 border-y bg-white/[.025] py-20"
        id="features"
      >
        <div className="mx-auto max-w-7xl px-5 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <p className="font-bold text-cyan-300 text-sm">
              {t("features.eyebrow")}
            </p>
            <h2 className="mt-4 font-black text-3xl sm:text-4xl">
              {t("features.title")}
            </h2>
            <p className="mt-4 text-slate-400 leading-8">
              {t("features.description")}
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {featureIcons.map((Icon, index) => (
              <article
                className="rounded-3xl border border-white/10 bg-slate-900/70 p-6"
                key={String(index)}
              >
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-500/15 text-cyan-300">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 font-bold text-lg">
                  {t(`features.items.${index}.title`)}
                </h3>
                <p className="mt-3 text-slate-400 text-sm leading-7">
                  {t(`features.items.${index}.description`)}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-2 lg:px-8">
          <div>
            <p className="font-bold text-cyan-300 text-sm">
              {t("control.eyebrow")}
            </p>
            <h2 className="mt-4 font-black text-3xl sm:text-4xl">
              {t("control.title")}
            </h2>
            <p className="mt-5 text-slate-400 leading-8">
              {t("control.description")}
            </p>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3].map((index) => (
                <div
                  className="flex gap-3 rounded-2xl border border-white/10 p-4 text-sm"
                  key={String(index)}
                >
                  <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
                  {t(`control.items.${index}`)}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-blue-500/10 to-cyan-400/5 p-7">
            <Bot className="h-12 w-12 text-cyan-300" />
            <p className="mt-6 font-black text-2xl">{t("control.cardTitle")}</p>
            <p className="mt-4 text-slate-400 leading-8">
              {t("control.cardDescription")}
            </p>
          </div>
        </div>
      </section>

      <section className="px-5 pb-20 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-[2rem] bg-gradient-to-l from-blue-700 to-cyan-600 px-7 py-12 text-center sm:px-12">
          <h2 className="font-black text-3xl">{t("cta.title")}</h2>
          <p className="mx-auto mt-4 max-w-2xl text-blue-50 leading-8">
            {t("cta.description")}
          </p>
          <Link
            className="mt-7 inline-flex rounded-xl bg-white px-7 py-3.5 font-bold text-blue-800"
            href="/auth/sign-up"
          >
            {t("actions.start")}
          </Link>
        </div>
      </section>
    </PublicShell>
  )
}
