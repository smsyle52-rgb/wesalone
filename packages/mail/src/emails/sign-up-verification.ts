import {
  type BaseEmailProps,
  buildSystemEmail,
  esc,
} from "./base-template"
import { SIGNUP_BODY_MJML, SIGNUP_BODY_MJML_AR } from "./default-templates"

export type SignUpVerificationProps = BaseEmailProps & {
  userName: string
  verificationUrl: string
}

export function buildSignUpVerificationMjml(
  props: SignUpVerificationProps,
): string {
  const { userName, verificationUrl, dir } = props
  const isArabic = dir === "rtl"
  const template = isArabic ? SIGNUP_BODY_MJML_AR : SIGNUP_BODY_MJML
  const body = template
    .replace(/\{\{userName\}\}/g, esc(userName))
    .replace(/\{\{verificationUrl\}\}/g, esc(verificationUrl))
  // Without this the Arabic body still closed with the English default
  // "Sincerely," / "<brand> Team". Matches usage-limit-reached.ts.
  return buildSystemEmail(
    isArabic
      ? { ...props, signOff: "مع التحية،", signature: props.brandName }
      : props,
    body,
  )
}
