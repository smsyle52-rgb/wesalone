"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@chatbotx.io/ui/components/ui/select"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import type React from "react"
import { useTransition } from "react"
import type { Locale } from "@/i18n/config"
import { setUserLocale } from "@/lib/locale"

export const LangSelector: React.FC = () => {
  const locale = useLocale()
  const [, startTransition] = useTransition()
  const t = useTranslations()
  const router = useRouter()

  function onChangeLocale(value: string) {
    const newLocale = value as Locale
    startTransition(async () => {
      await setUserLocale(newLocale)
      router.refresh()
    })
  }

  return (
    <Select onValueChange={onChangeLocale} value={locale}>
      <SelectTrigger className="w-[140px]">
        <SelectValue placeholder={t("fields.language.placeholder")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">{t("fields.language.english")}</SelectItem>
        <SelectItem value="ar">{t("fields.language.arabic")}</SelectItem>
      </SelectContent>
    </Select>
  )
}
