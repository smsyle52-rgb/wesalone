import { type BaseEmailProps, buildSystemEmail, esc } from "./base-template"

export type UsageLimitReachedProps = BaseEmailProps & {
  workspaceName: string
  planName: string
  macLimit: number
  upgradeUrl: string
}

/**
 * Sent once per billing period when a workspace's monthly-active-contacts
 * allowance runs out and its agent stops replying.
 *
 * Until this existed the freeze was completely silent — one log line, no word
 * to the merchant and none to their customer — so a merchant's agent could go
 * quiet mid-conversation with nothing anywhere explaining why.
 */
export function buildUsageLimitReachedMjml(
  props: UsageLimitReachedProps,
): string {
  const { workspaceName, planName, macLimit, upgradeUrl } = props
  const limit = macLimit.toLocaleString("en-US")

  const body = `<mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-text padding="0 0 12px 0">
          توقّف الرد التلقائي في مساحة العمل <strong>${esc(workspaceName)}</strong> لأن عدد جهات الاتصال النشطة خلال دورتك الحالية بلغ الحد الأقصى لباقة <strong>${esc(planName)}</strong> وهو ${esc(limit)} جهة اتصال.
        </mj-text>
        <mj-text padding="0 0 12px 0">
          رسائل عملائك ما زالت تصلك وتُحفظ في صندوق الوارد، ويمكنك الرد عليها يدوياً في أي وقت. المتوقف هو رد الوكيل الآلي فقط.
        </mj-text>
        <mj-text padding="0">
          تُحتسب جهة الاتصال «نشطة» مرة واحدة في الدورة مهما تعدّدت رسائلها، ويعود العدّاد إلى الصفر مع بداية دورتك التالية.
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-button href="${esc(upgradeUrl)}" align="right">ترقية الباقة</mj-button>
      </mj-column>
    </mj-section>`

  return buildSystemEmail(
    { ...props, dir: "rtl", signOff: "مع التحية،", signature: props.brandName },
    body,
  )
}
