"use server"

import { pointPurchaseOrderService } from "@chatbotx.io/business"
import { superAdminActionClient } from "@/lib/safe-action"
import { rejectPointPurchaseOrderRequest } from "../schema/point-purchase-order-action"

// Super-admin-only, mirrors confirm-point-purchase-order.action.ts. Never
// touches the point wallet — rejecting (or simply never reviewing) an
// order cannot credit points.
export const rejectPointPurchaseOrderAction = superAdminActionClient
  .inputSchema(rejectPointPurchaseOrderRequest)
  .action(async ({ ctx, parsedInput }) => {
    const order = await pointPurchaseOrderService.rejectOrder({
      orderId: parsedInput.orderId,
      reviewedByUserId: ctx.user.id,
      reason: parsedInput.reason,
    })
    return { orderId: order.id, status: order.status }
  })
