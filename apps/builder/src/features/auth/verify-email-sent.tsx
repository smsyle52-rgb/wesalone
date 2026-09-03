"use client"

import { authClient } from "@/lib/auth/auth-client"
import { Button, buttonVariants } from "@chatbotx.io/ui/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
} from "@chatbotx.io/ui/components/ui/card"
import { MailIcon } from "lucide-react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { AuthHeader } from "./components/shared"
import { authErrorMessage } from "./lib/auth-error-message"

/**
 * Sign-up ends here rather than on the sign-in form.
 *
 * `requireEmailVerification` is on, so a new account cannot sign in until the
 * address is confirmed — but sign-up used to push straight to /auth/sign-in
 * with only a toast, which is gone by the time the page paints. People read
 * that as "registration failed" and register again: one merchant created three
 * accounts in nine days that way. This screen is the missing step, and it also
 * carries the resend button, which until now only appeared after a failed
 * sign-in attempt.
 *
 * The address is read from sessionStorage, never from the URL: a query string
 * ends up in logs, referrers and shared links.
 */
export const PENDING_VERIFICATION_EMAIL_KEY = "wesal:pending-verification-email"

export default function VerifyEmailSent() {
  const t = useTranslations()
  const tAuth = useTranslations("auth")
  const [email, setEmail] = useState<string | null>(null)
  const [isResending, setIsResending] = useState(false)

  useEffect(() => {
    try {
      setEmail(sessionStorage.getItem(PENDING_VERIFICATION_EMAIL_KEY))
    } catch {
      // Private browsing or blocked storage: the screen still explains itself,
      // it just cannot offer the resend.
      setEmail(null)
    }
  }, [])

  const onResend = async () => {
    if (!email) {
      return
    }
    setIsResending(true)
    const { error } = await authClient.sendVerificationEmail({
      email,
      callbackURL: "/",
    })
    setIsResending(false)
    if (error) {
      toast.error(authErrorMessage(error, tAuth))
      return
    }
    toast.success(tAuth("verificationResent"))
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <AuthHeader title={tAuth("checkYourEmail")} />
      </CardHeader>

      <CardContent className="text-center">
        <div className="mb-6 flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
            <MailIcon className="h-6 w-6 text-blue-600" />
          </div>
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">
              {email
                ? tAuth("verifyEmailSentTo", { email })
                : tAuth("signUpSuccess")}
            </p>
            <p className="text-muted-foreground text-sm">
              {tAuth("magicLinkSentDescription")}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {email ? (
            <Button
              className="w-full"
              disabled={isResending}
              onClick={onResend}
              type="button"
              variant="outline"
            >
              {tAuth("resendVerification")}
            </Button>
          ) : null}

          <Link
            className={buttonVariants({
              variant: "ghost",
              className: "w-full",
            })}
            href="/auth/sign-in"
          >
            {t("actions.backToSignIn")}
          </Link>

          <div className="text-muted-foreground text-xs">
            <p>{tAuth("didNotReceiveEmail")}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
