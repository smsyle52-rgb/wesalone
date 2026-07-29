import { WESAL_ONE_PLANS } from "@chatbotx.io/business"
import { Check, Sparkles } from "lucide-react"
import Link from "next/link"
import { getLocale, getTranslations } from "next-intl/server"
import { PublicShell } from "./public-shell"

function price(plan: (typeof WESAL_ONE_PLANS)[number], annual: boolean) {
  if (plan.priceMonthlyUsd === null) return null
  return annual ? plan.priceYearlyUsd : plan.priceMonthlyUsd
}

export async function PublicPricing() {
  const locale = await getLocale()
  const t = await getTranslations("plans")

  return (
    <PublicShell>
      <section className="relative overflow-hidden bg-[#05142b] px-5 py-20 lg:px-8">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_0%,rgba(8,190,221,.32),transparent_70%)]" />
        <div className="relative mx-auto max-w-3xl text-center"><span className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-white/[.06] px-4 py-2 text-cyan-100 text-sm"><Sparkles className="h-4 w-4" />باقات واضحة تنمو معك</span><h1 className="mt-6 font-black text-4xl sm:text-6xl">اختر السعة المناسبة لفريقك</h1><p className="mt-5 text-slate-300 leading-8">تشمل كل باقة نقاطًا شهرية للاستخدام المقاس، وحدودًا واضحة للقنوات والفريق والعملاء. ابدأ بالخطة المجانية ثم انتقل عندما يتوسع استخدامك.</p></div>
      </section>
      <section className="bg-slate-50 px-5 py-16 text-slate-950 lg:px-8"><div className="mx-auto max-w-7xl"><div className="mb-8 flex flex-wrap justify-center gap-3 text-center text-sm"><span className="rounded-full bg-cyan-100 px-4 py-2 font-bold text-cyan-900">الدفع الشهري</span><span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-slate-600">الدفع السنوي موفّر حسب الباقة</span></div><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        {WESAL_ONE_PLANS.map((plan) => {
          const planPrice = price(plan, false)
          return <article className={`relative flex min-h-[560px] flex-col rounded-3xl border p-6 shadow-sm ${plan.highlighted ? "border-cyan-400 bg-slate-950 text-white shadow-cyan-200/70" : "border-slate-200 bg-white"}`} key={plan.slug}>
            {plan.highlighted && <span className="absolute -top-3 right-6 rounded-full bg-cyan-300 px-3 py-1 font-bold text-slate-950 text-xs">{t("recommended")}</span>}
            <p className={`text-sm ${plan.highlighted ? "text-cyan-200" : "text-cyan-700"}`}>{plan.audience === "individual" ? "للأفراد والفرق الصغيرة" : plan.audience === "business" ? "للأعمال المتنامية" : "للأعمال الكبيرة"}</p>
            <h2 className="mt-2 font-black text-2xl">{locale === "ar" ? plan.nameAr : plan.nameEn}</h2>
            <div className="mt-5 min-h-16">{planPrice === null ? <span className="font-black text-3xl">{t("custom")}</span> : <><span className="font-black text-4xl">${planPrice}</span><span className={plan.highlighted ? "text-slate-300 text-sm" : "text-slate-500 text-sm"}>{t("perMonth")}</span></>}</div>
            {plan.priceYearlyUsd !== null && planPrice !== null && planPrice !== plan.priceYearlyUsd && planPrice > 0 && <p className={plan.highlighted ? "text-cyan-100 text-xs" : "text-slate-500 text-xs"}>سنويًا: ${plan.priceYearlyUsd} في السنة</p>}
            <div className={`mt-5 rounded-2xl p-4 ${plan.highlighted ? "bg-white/10" : "bg-cyan-50"}`}><p className={plan.highlighted ? "text-cyan-100 text-xs" : "text-cyan-800 text-xs"}>النقاط الشهرية</p><p className="mt-1 font-black text-xl">{plan.monthlyPoints?.toLocaleString(locale === "ar" ? "ar-SA" : "en-US") ?? "حسب العقد"}</p></div>
            <ul className={`mt-6 flex-1 space-y-3 text-sm ${plan.highlighted ? "text-slate-200" : "text-slate-600"}`}><li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-cyan-500" />{plan.limits.channels ?? "سعات"} قناة{plan.limits.channels === 1 ? "" : "/قنوات"}</li><li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-cyan-500" />حتى {plan.limits.contacts?.toLocaleString() ?? "حسب العقد"} جهة اتصال</li><li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-cyan-500" />حتى {plan.limits.teamMembers ?? "عدد"} أعضاء فريق</li><li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-cyan-500" />حتى {plan.agentsLimit ?? "عدد"} وكلاء ذكاء اصطناعي</li>{plan.features.map((feature) => <li className="flex gap-2" key={feature}><Check className="h-4 w-4 shrink-0 text-cyan-500" />{t(`features.${feature}`)}</li>)}</ul>
            <Link className={`mt-7 rounded-xl px-4 py-3 text-center font-bold transition ${plan.highlighted ? "bg-cyan-300 text-slate-950 hover:bg-cyan-200" : "bg-slate-950 text-white hover:bg-slate-800"}`} href={planPrice === null ? "/contact" : "/auth/sign-up"}>{planPrice === null ? t("contactSales") : planPrice === 0 ? t("selectFree") : t("selectPlan")}</Link>
          </article>
        })}
      </div><p className="mx-auto mt-10 max-w-3xl text-center text-slate-500 text-sm leading-7">النقاط جزء من رصيد الباقة الشهري، ويختلف الاستهلاك بحسب الخدمة المستخدمة. راجع حدود الباقة داخل حسابك قبل تفعيل الخدمات ذات الاستخدام المقاس.</p></div></section>
    </PublicShell>
  )
}
