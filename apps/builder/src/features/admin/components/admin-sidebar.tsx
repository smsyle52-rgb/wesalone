"use client"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@chatbotx.io/ui/components/ui/sidebar"
import {
  BrainIcon,
  CoinsIcon,
  Grid2x2PlusIcon,
  ListTodoIcon,
  RadioTowerIcon,
  ReceiptTextIcon,
} from "lucide-react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { BrandIcon } from "@/components/brand-icon"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { authClient } from "@/lib/auth/auth-client"

/**
 * Super-admin sidebar for the `/admin` console.
 * Gated by `isSuperAdmin` in the parent layout; no auth check needed here.
 */
export function AdminSidebar({
  showPointPurchaseOrders,
  showSubscriptionPayments,
}: {
  showPointPurchaseOrders: boolean
  showSubscriptionPayments: boolean
}) {
  const t = useTranslations()
  const tManage = useTranslations("manageSidebar")
  const { data: session } = authClient.useSession()

  const user = {
    name: session?.user.name ?? "",
    email: session?.user.email ?? "",
    avatar: session?.user.image ?? "",
  }

  const platformItems = [
    {
      title: t("platformAdmin.platformCredentials.title"),
      url: "/admin/platform-credentials",
      icon: Grid2x2PlusIcon,
    },
    {
      title: t("channels.title"),
      url: "/admin/platform-channels",
      icon: RadioTowerIcon,
    },
    {
      title: t("platformAiSettings.title"),
      url: "/admin/ai-settings",
      icon: BrainIcon,
    },
    // Both pages already notFound() on their own env flag; gating the link on
    // the same flag keeps the nav from advertising a 404. Before this, neither
    // was reachable at all — the flags arrived and were dropped on the floor.
    ...(showSubscriptionPayments
      ? [
          {
            title: t("plans.admin.title"),
            url: "/admin/subscription-payments",
            icon: ReceiptTextIcon,
          },
        ]
      : []),
    ...(showPointPurchaseOrders
      ? [
          {
            title: t("plans.pointPurchaseAdmin.title"),
            url: "/admin/point-purchase-orders",
            icon: CoinsIcon,
          },
        ]
      : []),
  ]

  const toolsItems = [
    {
      title: t("platformAdmin.queues.title"),
      url: "/developer/queues",
      icon: ListTodoIcon,
      crossZone: true,
    },
  ]

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-0 px-0 py-0">
        <Link
          className="flex h-12 items-center justify-center border-b"
          href="/"
        >
          <BrandIcon alt="Brand" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={platformItems} label={tManage("platformGroup")} />
        <NavMain items={toolsItems} label={tManage("toolsGroup")} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
