"use client"

import { InputField } from "@chatbotx.io/ui/components/form/input-field"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import { Form } from "@chatbotx.io/ui/components/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2Icon, LockIcon, MailIcon, UserIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { authClient } from "@/lib/auth/auth-client"
import {
  type EmailPasswordSignUpRequest,
  emailPasswordSignUpRequest,
} from "../schemas/action"

const STRENGTH_COLORS = [
  "#EF4444",
  "#F59E0B",
  "#F59E0B",
  "#22D3EE",
  "#10B981",
] as const
const STRENGTH_KEYS = [
  "veryWeak",
  "weak",
  "medium",
  "strong",
  "veryStrong",
] as const
const UPPERCASE_REGEX = /[A-Z]/
const DIGIT_REGEX = /[0-9]/
const SPECIAL_CHAR_REGEX = /[^A-Za-z0-9]/

const PasswordStrengthMeter = ({ password }: { password: string }) => {
  const t = useTranslations()
  if (!password) {
    return null
  }

  const score = [
    password.length >= 8,
    UPPERCASE_REGEX.test(password),
    DIGIT_REGEX.test(password),
    SPECIAL_CHAR_REGEX.test(password),
  ].filter(Boolean).length

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1.5">
        {[0, 1, 2, 3].map((index) => (
          <div
            className="h-1 flex-1 rounded-full transition-colors"
            key={index}
            style={{
              background:
                index < score ? STRENGTH_COLORS[score] : "var(--border)",
            }}
          />
        ))}
      </div>
      <div
        className="mt-1 font-bold text-[11px]"
        style={{ color: STRENGTH_COLORS[score] }}
      >
        {t("auth.passwordStrength.label", {
          level: t(`auth.passwordStrength.${STRENGTH_KEYS[score]}`),
        })}
      </div>
    </div>
  )
}

export const EmailPasswordSignUp = () => {
  const t = useTranslations()
  const router = useRouter()

  const emailPasswordForm = useForm<EmailPasswordSignUpRequest>({
    resolver: zodResolver(emailPasswordSignUpRequest),
    defaultValues: {
      email: "",
      password: "",
      passwordConfirmation: "",
    },
    mode: "onChange",
  })

  const onSubmitEmailPasswordForm = async (
    input: EmailPasswordSignUpRequest,
  ) => {
    const { data, error } = await authClient.signUp.email(input)

    if (data) {
      toast.success(t("auth.signUpSuccess"))
      router.push("/auth/sign-in")
    } else {
      toast.error(error.message)
    }
  }
  return (
    <Form {...emailPasswordForm}>
      <form
        className="flex w-full flex-col gap-4"
        onSubmit={emailPasswordForm.handleSubmit(onSubmitEmailPasswordForm)}
      >
        <InputField
          icon={<UserIcon className="size-4" />}
          label={t("fields.name.label")}
          name="name"
          placeholder={t("fields.name.label")}
          required
        />

        <InputField
          icon={<MailIcon className="size-4" />}
          label={t("fields.email.label")}
          name="email"
          placeholder={t("fields.email.label")}
          required
          type="email"
        />

        <div>
          <InputField
            icon={<LockIcon className="size-4" />}
            label={t("fields.password.label")}
            name="password"
            placeholder="********"
            required
            type="password"
          />
          <PasswordStrengthMeter
            password={emailPasswordForm.watch("password")}
          />
        </div>

        <InputField
          icon={<LockIcon className="size-4" />}
          label={t("fields.passwordConfirmation.label")}
          name="passwordConfirmation"
          placeholder="********"
          required
          type="password"
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
      </form>
    </Form>
  )
}
