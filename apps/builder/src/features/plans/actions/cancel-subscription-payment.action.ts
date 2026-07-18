"use server"

import { platformSubscriptionPaymentService } from "@chatbotx.io/business"
import { ChatbotXException } from "@chatbotx.io/business/errors"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import { cancelSubscriptionPaymentRequest } from "../schema/subscription-payment-action"

// Lets the workspace owner withdraw their OWN still-under-review claim
// (e.g. submitted the wrong plan/cycle). Cannot touch anyone else's
// submission and never activates a plan.
export const cancelSubscriptionPaymentAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString()])
  .inputSchema(cancelSubscriptionPaymentRequest)
  .action(async ({ bindArgsParsedInputs: [workspaceId], parsedInput }) => {
    const currentUserAndWorkspace =
      await getCurrentUserAndTargetWorkspace(workspaceId)
    if (!currentUserAndWorkspace) {
      throw new ChatbotXException(
        "You are not authorized to change this workspace's plan.",
      )
    }

    const permissions =
      currentUserAndWorkspace.targetWorkspaceMember.permissions
    if (!hasWorkspacePermission(permissions, "superAdmin")) {
      throw new ChatbotXException(
        "You are not authorized to change this workspace's plan. You need to be a super admin to do this.",
      )
    }

    const submission =
      await platformSubscriptionPaymentService.cancelSubmission({
        workspaceId,
        submissionId: parsedInput.submissionId,
      })
    return { submissionId: submission.id, status: submission.status }
  })
