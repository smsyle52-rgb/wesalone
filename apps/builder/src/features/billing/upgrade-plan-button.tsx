import { buttonVariants } from "@chatbotx.io/ui/components/ui/button"
import { cn } from "@chatbotx.io/ui/lib/utils"
import Link from "next/link"
import type { ComponentProps, ReactNode } from "react"

type ButtonVariantProps = Parameters<typeof buttonVariants>[0]

type UpgradePlanButtonProps = {
  children: ReactNode
  className?: string
  size?: NonNullable<ButtonVariantProps>["size"]
  variant?: NonNullable<ButtonVariantProps>["variant"]
} & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">

/**
 * The upgrade call to action.
 *
 * Replaces the dialog that used to live under `src/enterprise`, which is
 * covered by the ChatbotX Commercial License and requires a paid subscription
 * to use in production — this deployment has none, so that code was removed
 * rather than shipped unlicensed.
 *
 * A link to the pricing page carries the same intent: the dialog's job was to
 * get the merchant to a plan, and `/portal/pricing` is where plans live. Same
 * destination `expired-banner.tsx` already sends people to, so the two upgrade
 * paths stay consistent.
 */
export function UpgradePlanButton({
  children,
  className,
  size = "default",
  variant = "default",
  ...props
}: UpgradePlanButtonProps) {
  return (
    <Link
      className={cn(buttonVariants({ variant, size }), className)}
      href="/portal/pricing"
      {...props}
    >
      {children}
    </Link>
  )
}
