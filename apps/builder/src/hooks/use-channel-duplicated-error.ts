"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { useEffect } from "react"
import { toast } from "sonner"

/**
 * Translation key for an `?error=` value a connect flow redirected with, or
 * null when the value is not one this hook reports.
 */
function messageKeyFor(error: string, channel?: string): string | null {
  if (error === "duplicated") {
    return channel ? `duplicated.${channel}` : "duplicated.generic"
  }
  if (error === "channelLimit") {
    return "channelLimit"
  }
  return null
}

/**
 * Surfaces business errors a channel-connect flow redirected back with. Named
 * for the duplicate case it originally handled; it now also covers the plan
 * channel limit, which previously reached the merchant as a generic technical
 * failure with no hint that they simply needed a bigger plan.
 */
export function useChannelDuplicatedError(channel?: string) {
  const t = useTranslations("channels")
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const error = searchParams.get("error")
    const key = error ? messageKeyFor(error, channel) : null
    if (!key) {
      return
    }

    const params = new URLSearchParams(searchParams.toString())
    params.delete("error")
    const qs = params.size > 0 ? `?${params.toString()}` : ""

    const timer = setTimeout(() => {
      toast.error(t(key as Parameters<typeof t>[0]))
      router.replace(`${window.location.pathname}${qs}`, { scroll: false })
    }, 0)

    return () => clearTimeout(timer)
  }, [searchParams, t, router, channel])
}
