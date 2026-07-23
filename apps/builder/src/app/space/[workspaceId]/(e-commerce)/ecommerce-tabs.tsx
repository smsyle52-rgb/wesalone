"use client"

import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { AppTab } from "@/components/app-tab"

const isTabActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`)

export function EcommerceTabs({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations()
  const pathname = usePathname()

  const base = `/space/${workspaceId}`
  const tabs = [
    { label: t("products.title"), href: `${base}/products` },
    { label: t("orders.title"), href: `${base}/orders` },
    { label: t("settings.title"), href: `${base}/ecommerce-settings` },
  ]

  return (
    <AppTab
      tabs={tabs.map((tab) => ({
        ...tab,
        isActive: isTabActive(pathname, tab.href),
      }))}
    />
  )
}
