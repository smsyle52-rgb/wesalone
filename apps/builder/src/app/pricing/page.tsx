import { WESAL_ONE_PLANS } from "@chatbotx.io/business"
import Link from "next/link"
import { getLocale, getTranslations } from "next-intl/server"
import { PublicShell } from "@/features/marketing/public-shell"

/**
 * Public pricing. The authenticated `/space/[workspaceId]/pricing` page cannot
 * serve this: it needs a workspace and a subscription to render. Both read the
 * same `WESAL_ONE_PLANS`, so the public prices cannot drift from the ones the
 * product actually charges.
 */
export default async function PricingPage() {
  const [t, locale] = await Promise.all([getTranslations("plans"), getLocale()])
  // Plan names live on the plan record, not in the message catalogue, so they
  // stay in step with the tiers themselves.
  const planName = (plan: (typeof WESAL_ONE_PLANS)[number]) =>
    locale === "ar" ? plan.nameAr : plan.nameEn

  const capacity = (count: number | null, key: "points" | "agents") =>
    count === null ? t("capacity.unlimited") : t(`capacity.${key}`, { count })

  const ctaLabel = (plan: (typeof WESAL_ONE_PLANS)[number]) => {
    if (plan.priceMonthlyUsd === null) {
      return t("contactSales")
    }
    return plan.priceMonthlyUsd === 0 ? t("selectFree") : t("selectPlan")
  }

  return (
    <PublicShell>
      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <p className="font-bold text-cyan-300 text-sm">{t("subtitle")}</p>
        <h1 className="mt-4 text-balance font-black text-4xl leading-tight sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mt-6 max-w-3xl text-base text-slate-300 leading-8">
          {t("description")}
        </p>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {WESAL_ONE_PLANS.map((plan) => {
            const isCustom = plan.priceMonthlyUsd === null
            return (
              <article
                className={`flex flex-col rounded-3xl border p-6 ${
                  plan.highlighted
                    ? "border-cyan-300/40 bg-cyan-300/[.06]"
                    : "border-white/10 bg-white/[.035]"
                }`}
                key={plan.slug}
              >
                {plan.highlighted && (
                  <p className="font-bold text-cyan-300 text-xs">
                    {t("recommended")}
                  </p>
                )}
                <h2 className="mt-1 font-bold text-xl">{planName(plan)}</h2>
                <p className="mt-1 text-slate-400 text-sm">
                  {t(`audience.${plan.audience}`)}
                </p>

                <p className="mt-6 font-black text-3xl">
                  {isCustom ? (
                    t("custom")
                  ) : (
                    <>
                      {`$${plan.priceMonthlyUsd}`}
                      <span className="font-normal text-base text-slate-400">
                        {t("perMonth")}
                      </span>
                    </>
                  )}
                </p>

                <ul className="mt-6 space-y-2 text-slate-400 text-sm leading-7">
                  <li>{capacity(plan.monthlyPoints, "points")}</li>
                  <li>{capacity(plan.agentsLimit, "agents")}</li>
                  <li>
                    {plan.limits.channels === null
                      ? t("capacity.unlimited")
                      : t("summary", {
                          channels: plan.limits.channels,
                          contacts: plan.limits.contacts ?? 0,
                          teamMembers: plan.limits.teamMembers ?? 0,
                          points: plan.monthlyPoints ?? 0,
                        })}
                  </li>
                </ul>

                <Link
                  className="mt-8 rounded-full bg-white/10 px-5 py-3 text-center font-bold text-sm transition hover:bg-white/20"
                  href={isCustom ? "/contact" : "/auth/sign-up"}
                >
                  {ctaLabel(plan)}
                </Link>
              </article>
            )
          })}
        </div>
      </section>
    </PublicShell>
  )
}
