"use server"

import { pointPurchaseOrderService } from "@chatbotx.io/business"
import { ChatbotXException } from "@chatbotx.io/business/errors"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { isPointPurchasesEnabled } from "@/env"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import { submitPointPurchaseOrderRequest } from "../schema/point-purchase-order-action"

// The "checkout" step of the manual point top-up flow: records an order
// claim (Kuraimi/Jawali/bank-transfer/cash reference + receipt), status
// "under_review". It never credits points by itself — see
// confirm-point-purchase-order.action.ts, which is platform-admin-only so a
// workspace owner can never self-approve their own claim.
export const submitPointPurchaseOrderAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString()])
  .inputSchema(submitPointPurchaseOrderRequest)
  .action(async ({ bindArgsParsedInputs: [workspaceId], parsedInput }) => {
    if (!isPointPurchasesEnabled()) {
      throw new ChatbotXException(
        "Point purchases are not enabled on this environment.",
        "featureDisabled",
        403,
      )
    }

    const currentUserAndWorkspace =
      await getCurrentUserAndTargetWorkspace(workspaceId)
    if (!currentUserAndWorkspace) {
      throw new ChatbotXException(
        "You are not authorized to buy points for this workspace.",
      )
    }

    const permissions =
      currentUserAndWorkspace.targetWorkspaceMember.permissions
    if (!hasWorkspacePermission(permissions, "superAdmin")) {
      throw new ChatbotXException(
        "You are not authorized to buy points for this workspace. You need to be a super admin to do this.",
      )
    }

    const order = await pointPurchaseOrderService.submitOrder({
      userId: currentUserAndWorkspace.targetWorkspace.ownerId,
      workspaceId,
      topupProductSlug: parsedInput.topupProductSlug,
      paymentMethod: parsedInput.paymentMethod,
      reference: parsedInput.reference,
      receiptFileId: parsedInput.receiptFileId,
      receiptNote: parsedInput.receiptNote,
    })
    return { orderId: order.id, status: order.status }
  })
