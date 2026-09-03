import { InputField } from "@chatbotx.io/ui/components/form/input-field"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@chatbotx.io/ui/components/ui/form"
import { Input } from "@chatbotx.io/ui/components/ui/input"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2Icon, LockIcon, MailIcon } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { authClient } from "@/lib/auth/auth-client"
import { resolveSafeCallbackUrl } from "@/lib/safe-callback-url"
import { authErrorMessage, isEmailNotVerified } from "../lib/auth-error-message"
import {
  type EmailPasswordSignInRequest,
  emailPasswordSignInRequest,
} from "../schema/action"

export const EmailPasswordSignIn = () => {
  const t = useTranslations()
  const tAuth = useTranslations("auth")
  // Shown only after a sign-in fails specifically because the address is
  // unverified. Without it a merchant who lost the original email has no way
  // to ask for another one and is simply locked out.
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)
  const [isResending, setIsResending] = useState(false)
  const searchParams = useSearchParams()

  const emailPasswordForm = useForm<EmailPasswordSignInRequest>({
    resolver: zodResolver(emailPasswordSignInRequest),
    defaultValues: {
      email: "",
      password: "",
    },
    mode: "onChange",
  })

  const onSubmitEmailPasswordForm = async (
    input: EmailPasswordSignInRequest,
  ) => {
    const { data, error } = await authClient.signIn.email({
      email: input.email,
      password: input.password,
      rememberMe: true,
    })

    if (data) {
      toast.success(tAuth("signedInSuccessfully"))
      // Full reload (not router.push) so a fresh session re-renders
      // layout/sidebar state that depends on auth.
      window.location.assign(
        resolveSafeCallbackUrl(
          searchParams.get("callbackURL"),
          window.location.origin,
        ),
      )
    } else {
      setUnverifiedEmail(isEmailNotVerified(error) ? input.email : null)
      toast.error(authErrorMessage(error, tAuth))
    }
  }

  const onResendVerification = async () => {
    if (!unverifiedEmail) {
      return
    }
    setIsResending(true)
    const { error } = await authClient.sendVerificationEmail({
      email: unverifiedEmail,
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
    <Form {...emailPasswordForm}>
      <form
        className="flex w-full flex-col gap-4"
        onSubmit={emailPasswordForm.handleSubmit(onSubmitEmailPasswordForm)}
      >
        <InputField
          icon={<MailIcon className="size-4" />}
          label={t("fields.email.label")}
          name="email"
          placeholder={t("fields.email.label")}
          required
          type="email"
        />

        <FormField
          control={emailPasswordForm.control}
          name="password"
          render={({ field }) => (
            <FormItem className="w-full">
              <div className="flex">
                <FormLabel className="flex-1">
                  {t("fields.password.label")}
                </FormLabel>
                <Link
                  className="text-foreground text-sm underline"
                  href="/auth/forgot-password"
                >
                  {t("auth.forgotPassword")}
                </Link>
              </div>
              <FormControl>
                <div className="relative">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-muted-foreground"
                  >
                    <LockIcon className="size-4" />
                  </span>
                  <Input
                    className="ps-10"
                    placeholder="********"
                    required
                    type="password"
                    {...field}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          className="w-full"
          disabled={
            !emailPasswordForm.formState.isValid ||
            emailPasswordForm.formState.isSubmitting
          }
          type="submit"
        >
          {emailPasswordForm.formState.isSubmitting && (
            <Loader2Icon className="animate-spin" />
          )}
          {t("actions.continue")}
        </Button>

        {unverifiedEmail && (
          <Button
            className="w-full"
            disabled={isResending}
            onClick={onResendVerification}
            type="button"
            variant="outline"
          >
            {isResending && <Loader2Icon className="animate-spin" />}
            {tAuth("resendVerification")}
          </Button>
        )}
      </form>
    </Form>
  )
}
