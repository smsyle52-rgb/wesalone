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
  const template = dir === "rtl" ? SIGNUP_BODY_MJML_AR : SIGNUP_BODY_MJML
  const body = template
    .replace(/\{\{userName\}\}/g, esc(userName))
    .replace(/\{\{verificationUrl\}\}/g, esc(verificationUrl))
  return buildSystemEmail(props, body)
}
