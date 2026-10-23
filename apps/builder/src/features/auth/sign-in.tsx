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
import SSOSignIn from "@/features/auth/sso-sign-in"
import type { GenericOAuthButton } from "@/lib/auth/auth-page-options"
import { withCallbackUrlParam } from "@/lib/safe-callback-url"
import { useTenantSettings } from "../tenant"
import { EmailPasswordSignIn } from "./components/email-password-sign-in"
import { MagicLinkSignIn } from "./components/magic-link-signin"
import { OAuthErrorAlert } from "./components/oauth-error-alert"
import { AuthHeader, AuthModeTabs, OrSeparator } from "./components/shared"

export type SignInFormProps = {
  callbackUrl?: string
  /** Social providers configured for this tenant (own app or platform default). */
  enabledProviders?: SocialProvider[]
  genericOAuth?: GenericOAuthButton | null
  signUpAllowed?: boolean
}

export const SignInForm = ({
  callbackUrl,
  enabledProviders = [],
  genericOAuth = null,
  signUpAllowed = true,
  ...props
}: SignInFormProps) => {
  const t = useTranslations()
  const { name } = useTenantSettings()
  const searchParams = useSearchParams()
  const signUpHref = withCallbackUrlParam(
    "/auth/sign-up",
    searchParams.get("callbackURL"),
  )
  // Gated on whether a provider is configured, not on the edition: Wesal One
  // runs the community edition and still offers Google sign-in (see below).
  const hasSocialProviders = enabledProviders.length > 0

  return (
    <div className="flex flex-col gap-6" {...props}>
      <Card>
        <CardHeader className="gap-4 text-center">
          {signUpAllowed ? (
            <AuthModeTabs mode="sign-in" signUpHref={signUpHref} />
          ) : null}
          <AuthHeader title={t("auth.signInTitle", { name })} />
        </CardHeader>

        <CardContent>
          <div className="grid gap-6">
            <OAuthErrorAlert />
            {/* Gated on whether a provider is actually configured, not on the
              edition. The Google credential lives in PlatformCredential and
              has been there since July; keying this on the edition hid a
              working sign-in button and left email+password as the only way
              in. `enabledProviders` is already empty when nothing is set up. */}
            {(genericOAuth || hasSocialProviders) && (
              <>
                {genericOAuth ? (
                  <GenericOAuthSignIn
                    displayName={genericOAuth.displayName}
                    logoUrl={genericOAuth.logoUrl}
                  />
                ) : null}
                {hasSocialProviders ? (
                  <SSOSignIn providers={enabledProviders} />
                ) : null}
                <OrSeparator />
              </>
            )}

            <EmailPasswordSignIn />

            <OrSeparator label={t("auth.orUseMagicLink")} />
            <MagicLinkSignIn />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
