import { type BaseEmailProps, buildSystemEmail, esc } from "./base-template"
import {
  FORGOT_PASSWORD_BODY_MJML,
  FORGOT_PASSWORD_BODY_MJML_AR,
} from "./default-templates"

export type ResetPasswordProps = BaseEmailProps & {
  userName: string
  resetPasswordUrl: string
}

export function buildResetPasswordMjml(props: ResetPasswordProps): string {
  const { userName, resetPasswordUrl, dir } = props
  const isArabic = dir === "rtl"
  const template = isArabic
    ? FORGOT_PASSWORD_BODY_MJML_AR
    : FORGOT_PASSWORD_BODY_MJML
  const body = template
    .replace(/\{\{userName\}\}/g, esc(userName))
    .replace(/\{\{resetPasswordUrl\}\}/g, esc(resetPasswordUrl))
  return buildSystemEmail(
    isArabic
      ? { ...props, signOff: "مع التحية،", signature: props.brandName }
      : props,
    body,
  )
}
