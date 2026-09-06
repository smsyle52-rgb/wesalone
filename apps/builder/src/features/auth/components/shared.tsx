"use client"

import { CardTitle } from "@chatbotx.io/ui/components/ui/card"
import Link from "next/link"
import { useTranslations } from "next-intl"

export type AuthHeaderProps = {
  title: string
}

/**
 * Just the title.
 *
 * It used to draw the brand logo and a language selector as well — both of
 * which the surrounding shell already renders, so the page carried two of
 * each. The logo also reserved a blank 271×80 box until the theme resolved on
 * the client, which is the empty white rectangle that sat above the form.
 */
export const AuthHeader = ({ title }: AuthHeaderProps) => (
  <CardTitle className="font-bold text-foreground text-xl">{title}</CardTitle>
)

/**
 * Sign in and create account as two visible choices.
 *
 * Both pages existed, but the only way across was one line of small grey text
 * under the form, so the page read as if signing in were the only option.
 */
export const AuthModeTabs = ({
  mode,
  signInHref = "/auth/sign-in",
  signUpHref = "/auth/sign-up",
}: {
  mode: "sign-in" | "sign-up"
  signInHref?: string
  signUpHref?: string
}) => {
  const t = useTranslations()

  // Written against the dark shell rather than the app theme tokens: this
  // surface stays dark whatever the app theme resolves to, and `bg-muted`
  // there produced a white pill on a navy card.
  const tab = (active: boolean) =>
    [
      "flex-1 rounded-lg px-4 py-2.5 text-center font-bold text-sm transition",
      active
        ? "bg-white/10 text-white shadow-sm"
        : "text-slate-400 hover:text-slate-200",
    ].join(" ")

  return (
    <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
      <Link
        aria-current={mode === "sign-in" ? "page" : undefined}
        className={tab(mode === "sign-in")}
        href={signInHref}
      >
        {t("auth.tabs.signIn")}
      </Link>
      <Link
        aria-current={mode === "sign-up" ? "page" : undefined}
        className={tab(mode === "sign-up")}
        href={signUpHref}
      >
        {t("auth.tabs.signUp")}
      </Link>
    </div>
  )
}

export const AcceptTermsAndPolicy = ({
  termsOfService,
  privacyPolicy,
}: {
  termsOfService: string
  privacyPolicy: string
}) => {
  const t = useTranslations()

  return (
    <div className="text-balance text-center text-muted-foreground text-xs [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-primary">
      <span>{t("auth.acceptTermsAndPolicy")}</span>{" "}
      <Link href={termsOfService} target="_blank">
        {t("auth.termsOfService")}
      </Link>{" "}
      <span>{t("auth.and")}</span>{" "}
      <Link href={privacyPolicy} target="_blank">
        {t("auth.privacyPolicy")}
      </Link>
    </div>
  )
}

/** `label` overrides the default "or continue with" wording. */
export const OrSeparator = ({ label }: { label?: string } = {}) => {
  const t = useTranslations()

  return (
    <div className="relative flex h-4 w-full items-center justify-center text-center text-sm">
      <hr className="w-full" />
      <span className="absolute bg-card px-2 font-medium text-foreground/60 text-sm">
        {label ?? t("auth.orContinueWith")}
      </span>
    </div>
  )
}
