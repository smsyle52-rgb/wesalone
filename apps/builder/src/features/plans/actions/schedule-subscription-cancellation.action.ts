"use server"

import { platformSubscriptionService } from "@chatbotx.io/business"
import { ChatbotXException } from "@chatbotx.io/business/errors"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { revalidatePath } from "next/cache"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"
import { workspaceActionClient } from "@/lib/safe-action"

export const scheduleSubscriptionCancellationAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString()])
  .action(async ({ bindArgsParsedInputs: [workspaceId] }) => {
    const currentUserAndWorkspace =
      await getCurrentUserAndTargetWorkspace(workspaceId)
    if (
      !(
        currentUserAndWorkspace &&
        hasWorkspacePermission(
          currentUserAndWorkspace.targetWorkspaceMember.permissions,
          "superAdmin",
        )
      )
    ) {
      throw new ChatbotXException(
        "You are not authorized to cancel this subscription.",
        "forbidden",
        403,
      )
    }

    const subscription =
      await platformSubscriptionService.scheduleCancellationForWorkspace(
        workspaceId,
      )
    revalidatePath(`/space/${workspaceId}/pricing`)
    return { status: subscription.status, periodEnd: subscription.periodEnd }
  })
