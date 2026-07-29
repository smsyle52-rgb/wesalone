"use client"

import { LanguagesIcon } from "lucide-react"
import { useLocale } from "next-intl"
import { Button } from "@/components/ui/button"

export function VeloraLanguageToggle() {
  const locale = useLocale()
  const nextLocale = locale === "ar" ? "en" : "ar"

  return (
    <Button
      aria-label={locale === "ar" ? "Switch to English" : "التبديل إلى العربية"}
      onClick={() => {
        document.cookie = `NEXT_LOCALE=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`
        window.location.reload()
      }}
      size="sm"
      type="button"
      variant="ghost"
    >
      <LanguagesIcon className="size-4" />
      {locale === "ar" ? "English" : "العربية"}
    </Button>
  )
}
