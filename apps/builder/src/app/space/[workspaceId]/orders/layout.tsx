import type { ReactNode } from "react"
import { resolveGuardedWorkspaceId } from "@/lib/auth/require-workspace-permission"

// This layout and the grouped (e-commerce)/orders layout both exist because
// route groups split URL-equivalent routes — see the products layouts for
// the same pattern. This one guards the order detail drill-down, which
// intentionally does not render inside the Products/Orders/Settings tab bar.

export default async function OrderDetailLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ workspaceId: string }>
}) {
  await resolveGuardedWorkspaceId(params, "ecommerce")

  return children
}
