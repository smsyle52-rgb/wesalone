import { type BaseEmailProps, buildSystemEmail, esc } from "./base-template"

export type PointsBalanceNoticeKind = "low" | "depleted"

export type PointsBalanceNoticeProps = BaseEmailProps & {
  kind: PointsBalanceNoticeKind
  workspaceName: string
  /** Visible points left, already rounded. */
  availablePoints: number
  /** The period's plan allowance, when the owner has one. */
  monthlyPoints: number | null
  topUpUrl: string
}

/**
 * Sent to a workspace owner when their AI points run low, and again when they
 * run out and the agent hands conversations to the team instead of answering.
 *
 * Without it a merchant only learned their balance was gone from customers who
 * waited for an answer that never came.
 */
export function buildPointsBalanceNoticeMjml(
  props: PointsBalanceNoticeProps,
): string {
  const { kind, workspaceName, availablePoints, monthlyPoints, topUpUrl } =
    props
  const available = Math.max(0, Math.floor(availablePoints)).toLocaleString(
    "en-US",
  )
  const allowance =
    monthlyPoints && monthlyPoints > 0
      ? ` من أصل ${esc(Math.floor(monthlyPoints).toLocaleString("en-US"))} نقطة في باقتك`
      : ""

  const lead =
    kind === "depleted"
      ? `نفد رصيد نقاط الذكاء الاصطناعي في مساحة العمل <strong>${esc(workspaceName)}</strong>، لذلك توقّف الوكيل الآلي عن الرد مؤقتاً.`
      : `رصيد نقاط الذكاء الاصطناعي في مساحة العمل <strong>${esc(workspaceName)}</strong> أوشك على النفاد: تبقّى ${esc(available)} نقطة${allowance}.`

  const detail =
    kind === "depleted"
      ? "لن يُترك أي عميل دون رد: يتلقى العميل رسالة لطيفة بأن أحد أفراد فريقك سيتواصل معه، وتنتقل المحادثة إلى فريقك في صندوق الوارد. يعود الوكيل للرد تلقائياً فور شحن الرصيد."
      : "عند نفاد الرصيد يتوقف الوكيل الآلي عن الرد وتنتقل المحادثات إلى فريقك. اشحن رصيدك الآن ليستمر الرد التلقائي دون انقطاع."

  const body = `<mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-text padding="0 0 12px 0">${lead}</mj-text>
        <mj-text padding="0">${esc(detail)}</mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-button href="${esc(topUpUrl)}" align="right">شحن الرصيد</mj-button>
      </mj-column>
    </mj-section>`

  return buildSystemEmail(
    { ...props, dir: "rtl", signOff: "مع التحية،", signature: props.brandName },
    body,
  )
}
