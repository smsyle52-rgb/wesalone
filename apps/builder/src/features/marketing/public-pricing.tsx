import { WESAL_ONE_PLANS } from "@chatbotx.io/business"
import { Check } from "lucide-react"
import Link from "next/link"
import { getLocale, getTranslations } from "next-intl/server"
import { PublicShell } from "./public-shell"

export async function PublicPricing() {
  const locale = await getLocale()
  const t = await getTranslations("plans")

  return (
    <PublicShell>
      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-bold text-cyan-300 text-sm">{t("subtitle")}</p>
          <h1 className="mt-4 font-black text-4xl sm:text-5xl">{t("title")}</h1>
          <p className="mt-5 text-slate-400 leading-8">{t("description")}</p>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
          {WESAL_ONE_PLANS.map((plan) => (
            <article
              className={
                plan.highlighted
                  ? "flex flex-col rounded-3xl border border-cyan-400 bg-cyan-400/10 p-6"
                  : "flex flex-col rounded-3xl border border-white/10 bg-white/[.035] p-6"
              }
              key={plan.slug}
            >
              {plan.highlighted && (
                <span className="mb-4 w-fit rounded-full bg-cyan-300 px-3 py-1 font-bold text-slate-950 text-xs">
                  {t("recommended")}
                </span>
              )}
              <h2 className="font-black text-xl">
                {locale === "ar" ? plan.nameAr : plan.nameEn}
              </h2>
              <div className="mt-5">
                {plan.priceMonthlyUsd === null ? (
                  <span className="font-black text-3xl">{t("custom")}</span>
                ) : (
                  <>
                    <span className="font-black text-4xl">
                      {"$"}
                      {plan.priceMonthlyUsd}
                    </span>
                    <span className="text-slate-400 text-sm">
                      {t("perMonth")}
                    </span>
                  </>
                )}
              </div>
              <p className="mt-4 text-slate-400 text-xs leading-6">
                {plan.limits.channels === null
                  ? t("summaryCustom")
                  : t("summary", {
                      channels: plan.limits.channels,
                      contacts:
                        plan.limits.contacts ?? String.fromCharCode(8734),
                      teamMembers:
                        plan.limits.teamMembers ?? String.fromCharCode(8734),
                      // Omitting this threw FORMATTING_ERROR and took down the
                      // whole public pricing page — the string has always had
                      // {points}; only the in-app pricing view was passing it.
                      points: plan.monthlyPoints ?? String.fromCharCode(8734),
                    })}
              </p>
              <ul className="mt-6 flex-1 space-y-3 text-sm">
                {plan.features.map((feature) => (
                  <li className="flex gap-2" key={feature}>
                    <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                    {t(`features.${feature}`)}
                  </li>
                ))}
              </ul>
              <Link
                className="mt-7 rounded-xl bg-white px-4 py-3 text-center font-bold text-slate-950"
                href={
                  plan.priceMonthlyUsd === null ? "/contact" : "/auth/sign-up"
                }
              >
                {plan.priceMonthlyUsd === null && t("contactSales")}
                {plan.priceMonthlyUsd === 0 && t("selectFree")}
                {typeof plan.priceMonthlyUsd === "number" &&
                  plan.priceMonthlyUsd > 0 &&
                  t("selectPlan")}
              </Link>
            </article>
          ))}
        </div>
      </section>
    </PublicShell>
  )
}
