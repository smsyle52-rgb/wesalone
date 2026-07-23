import type { ReactNode } from "react"
import { resolveGuardedWorkspaceId } from "@/lib/auth/require-workspace-permission"

// This layout and the non-grouped orders layout (orders/[orderId]) both exist
// because route groups split URL-equivalent routes — see the products layouts
// for the same pattern.

export default async function OrdersLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ workspaceId: string }>
}) {
  await resolveGuardedWorkspaceId(params, "ecommerce")

  return children
}
