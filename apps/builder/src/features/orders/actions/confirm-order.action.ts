"use server"

import { orderService } from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import type { WorkspaceMemberPermissions } from "@chatbotx.io/database/partials"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"
import { workspaceActionClient } from "@/lib/safe-action"

/**
 * `requireEcommercePermission` is the oRPC guard and throws `ORPCError`, which
 * next-safe-action does not map — it would surface as an opaque 500. The
 * member's permissions are already on `ctx` (see `workspaceActionClient`), so
 * gate on them here and let the action client's own error channel carry it.
 */
function assertCommerceAccess(
  permissions: WorkspaceMemberPermissions | Record<string, unknown>,
): void {
  if (!hasWorkspacePermission(permissions, "ecommerce")) {
    throw new Error("This workspace member cannot manage orders.")
  }
}

/**
 * The merchant accepting a draft the AI agent recorded.
 *
 * The order page shipped read-only, so a draft the agent created could never
 * move, and the only forward path in the API was `checkoutOrder` — which opens
 * a payment session that means nothing to a wholesaler paid in cash on
 * delivery. This is the missing step, and it is deliberately the merchant's to
 * take: the agent records, the merchant decides.
 */
export const confirmOrderAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async ({ bindArgsParsedInputs: [workspaceId, orderId], ctx }) => {
    assertCommerceAccess(ctx.workspaceMemberPermissions)
    await orderService.confirm({ workspaceId, orderId })
  })

/** Cancels a draft or a confirmed order — no money has moved in either. */
export const cancelOrderAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async ({ bindArgsParsedInputs: [workspaceId, orderId], ctx }) => {
    assertCommerceAccess(ctx.workspaceMemberPermissions)
    await orderService.cancel({ workspaceId, orderId })
  })
