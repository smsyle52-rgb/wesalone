"use client"

import type { SocialProvider } from "@chatbotx.io/auth/server"
import {
  Card,
  CardContent,
  CardHeader,
} from "@chatbotx.io/ui/components/ui/card"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { GenericOAuthSignIn } from "@/features/auth/generic-oauth-sign-in"
import SSOSignUp from "@/features/auth/sso-sign-in"
import type { GenericOAuthButton } from "@/lib/auth/auth-page-options"
import { withCallbackUrlParam } from "@/lib/safe-callback-url"
import { useTenantSettings } from "../tenant"
import { EmailPasswordSignUp } from "./components/email-password-sign-up"
import {
  AcceptTermsAndPolicy,
  AuthHeader,
  AuthModeTabs,
  OrSeparator,
} from "./components/shared"

export type SignUpFormProps = {
  /** Social providers configured for this tenant (own app or platform default). */
  enabledProviders?: SocialProvider[]
  genericOAuth?: GenericOAuthButton | null
  signUpAllowed: boolean
}

export const SignUpForm = ({
  enabledProviders = [],
  genericOAuth = null,
  signUpAllowed,
  ...props
}: SignUpFormProps) => {
  const t = useTranslations()
  const { name, policyUrl, termsOfServiceUrl } = useTenantSettings()
  const searchParams = useSearchParams()
  const signInHref = withCallbackUrlParam(
    "/auth/sign-in",
    searchParams.get("callbackURL"),
  )
  // Gated on whether a provider is configured, not on the edition: Wesal One
  // runs the community edition and still offers Google sign-in (see below).
  const hasSocialProviders = enabledProviders.length > 0

  return (
    <div className="flex flex-col gap-6" {...props}>
      <Card>
        <CardHeader className="gap-4 text-center">
          <AuthModeTabs mode="sign-up" signInHref={signInHref} />
          <AuthHeader title={t("auth.signUpTitle", { name })} />
        </CardHeader>

        <CardContent>
          {signUpAllowed ? (
            <div className="grid gap-6">
              {/* Mirrors sign-in: social first, then the email form. Gated on
                whether a provider is actually configured, not on the edition:
                keying this on the edition hid a working Google button and
                left email+password as the only way in. */}
              {genericOAuth || hasSocialProviders ? (
                <>
                  {genericOAuth ? (
                    <GenericOAuthSignIn
                      displayName={genericOAuth.displayName}
                      logoUrl={genericOAuth.logoUrl}
                    />
                  ) : null}
                  {hasSocialProviders ? (
                    <SSOSignUp providers={enabledProviders} />
                  ) : null}
                  <OrSeparator label={t("auth.orSignUpWithEmail")} />
                </>
              ) : null}

              <EmailPasswordSignUp />

              <div className="text-center font-medium text-foreground/60 text-sm">
                {t("auth.alreadyHaveAnAccount")}{" "}
                <Link className="text-foreground underline" href={signInHref}>
                  {t("auth.signIn")}
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid gap-6 text-center">
              <div className="grid gap-2">
                <h2 className="font-medium text-lg">
                  {t("auth.signUpDisabledTitle")}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {t("auth.signUpDisabledDescription")}
                </p>
              </div>
              <div className="font-medium text-foreground/60 text-sm">
                {t("auth.alreadyHaveAnAccount")}{" "}
                <Link className="text-foreground underline" href={signInHref}>
                  {t("auth.signIn")}
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AcceptTermsAndPolicy
        privacyPolicy={policyUrl ?? "/privacy"}
        termsOfService={termsOfServiceUrl ?? "/terms"}
      />
    </div>
  )
}
