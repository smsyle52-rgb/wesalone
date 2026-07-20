"use server"

import { pointPurchaseOrderService } from "@chatbotx.io/business"
import { superAdminActionClient } from "@/lib/safe-action"
import { confirmPointPurchaseOrderRequest } from "../schema/point-purchase-order-action"

// Super-admin-only (the same gate as the rest of /admin) — deliberately NOT
// on workspaceActionClient, so the workspace owner who submitted the order
// can never confirm their own payment. This is the only action that ever
// credits points from this flow, and only after a real human reviews it.
// Idempotent: see pointPurchaseOrderService.confirmOrder for the
// transaction + conditional-update guard against double-crediting.
export const confirmPointPurchaseOrderAction = superAdminActionClient
  .inputSchema(confirmPointPurchaseOrderRequest)
  .action(async ({ ctx, parsedInput }) => {
    const order = await pointPurchaseOrderService.confirmOrder({
      orderId: parsedInput.orderId,
      reviewedByUserId: ctx.user.id,
    })
    return { orderId: order.id, status: order.status }
  })
