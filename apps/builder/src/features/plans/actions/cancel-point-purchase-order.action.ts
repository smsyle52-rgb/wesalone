"use server"

import { pointPurchaseOrderService } from "@chatbotx.io/business"
import { ChatbotXException } from "@chatbotx.io/business/errors"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import { cancelPointPurchaseOrderRequest } from "../schema/point-purchase-order-action"

// Lets the workspace owner withdraw their OWN still-under-review order
// (e.g. picked the wrong bundle). Cannot touch anyone else's order and
// never credits points.
export const cancelPointPurchaseOrderAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString()])
  .inputSchema(cancelPointPurchaseOrderRequest)
  .action(async ({ bindArgsParsedInputs: [workspaceId], parsedInput }) => {
    const currentUserAndWorkspace =
      await getCurrentUserAndTargetWorkspace(workspaceId)
    if (!currentUserAndWorkspace) {
      throw new ChatbotXException(
        "You are not authorized to change this workspace's orders.",
      )
    }

    const permissions =
      currentUserAndWorkspace.targetWorkspaceMember.permissions
    if (!hasWorkspacePermission(permissions, "superAdmin")) {
      throw new ChatbotXException(
        "You are not authorized to change this workspace's orders. You need to be a super admin to do this.",
      )
    }

    const order = await pointPurchaseOrderService.cancelOrder({
      userId: currentUserAndWorkspace.targetWorkspace.ownerId,
      orderId: parsedInput.orderId,
    })
    return { orderId: order.id, status: order.status }
  })
