"use client"

import type { SocialProvider } from "@chatbotx.io/auth/server"
import {
  Card,
  CardContent,
  CardHeader,
} from "@chatbotx.io/ui/components/ui/card"
import Link from "next/link"
import { useTranslations } from "next-intl"
import SSOSignIn from "@/features/auth/sso-sign-in"
import { useTenantSettings } from "../tenant"
import { EmailPasswordSignIn } from "./components/email-password-sign-in"
import { MagicLinkSignIn } from "./components/magic-link-signin"
import {
  AcceptTermsAndPolicy,
  AuthHeader,
  OrSeparator,
} from "./components/shared"

export type SignInFormProps = {
  callbackUrl?: string
  /** Social providers configured for this tenant (own app or platform default). */
  enabledProviders?: SocialProvider[]
}

export const SignInForm = ({
  callbackUrl,
  enabledProviders = [],
  ...props
}: SignInFormProps) => {
  const t = useTranslations()
  const { name, policyUrl, termsOfServiceUrl } = useTenantSettings()

  return (
    <div className="flex flex-col gap-6" {...props}>
      <Card>
        <CardHeader className="text-center">
          <AuthHeader title={t("auth.signInTitle", { name })} />
        </CardHeader>

        <CardContent>
          <div className="grid gap-6">
            {/* Gated on whether a provider is actually configured, not on the
              edition. The Google credential lives in PlatformCredential and
              has been there since July; keying this on the edition hid a
              working sign-in button and left email+password as the only way
              in. `enabledProviders` is already empty when nothing is set up. */}
            {enabledProviders.length > 0 && (
              <>
                <SSOSignIn providers={enabledProviders} />
                <OrSeparator />
              </>
            )}

            <EmailPasswordSignIn />

            <OrSeparator />
            <MagicLinkSignIn />

            <div className="text-center font-medium text-foreground/60 text-sm">
              {t("auth.dontHaveAnAccount")}{" "}
              <Link className="text-foreground underline" href="/auth/sign-up">
                {t("auth.signUp")}
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      <AcceptTermsAndPolicy
        privacyPolicy={policyUrl ?? "/privacy"}
        termsOfService={termsOfServiceUrl ?? "/terms"}
      />
    </div>
  )
}
