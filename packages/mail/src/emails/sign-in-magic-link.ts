import { type BaseEmailProps, buildSystemEmail, esc } from "./base-template"
import {
  MAGIC_LINK_BODY_MJML,
  MAGIC_LINK_BODY_MJML_AR,
} from "./default-templates"

export type SignInMagicLinkProps = BaseEmailProps & {
  userName: string
  magicUrl: string
}

export function buildSignInMagicLinkMjml(props: SignInMagicLinkProps): string {
  const { userName, magicUrl, brandName, dir } = props
  const isArabic = dir === "rtl"
  const template = isArabic ? MAGIC_LINK_BODY_MJML_AR : MAGIC_LINK_BODY_MJML
  const body = template
    .replace(/\{\{userName\}\}/g, esc(userName))
    .replace(/\{\{magicUrl\}\}/g, esc(magicUrl))
    .replace(/\{\{brandName\}\}/g, esc(brandName))
  return buildSystemEmail(
    isArabic
      ? { ...props, signOff: "مع التحية،", signature: brandName }
      : props,
    body,
  )
}
