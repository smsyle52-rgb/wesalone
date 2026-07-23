"use server"

import { platformSubscriptionPaymentService } from "@chatbotx.io/business"
import { ChatbotXException } from "@chatbotx.io/business/errors"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { isPlatformSubscriptionPaymentsEnabled } from "@/env"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import { submitSubscriptionPaymentRequest } from "../schema/subscription-payment-action"

// The "checkout" step of the manual subscription-payment flow: records a
// payment CLAIM (bank transfer reference/receipt), status "under_review".
// It never activates a plan by itself — see confirm-subscription-payment.action.ts,
// which is platform-admin-only so a workspace owner can never self-approve
// their own claim. No order/payment/checkout code touched.
export const submitSubscriptionPaymentAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString()])
  .inputSchema(submitSubscriptionPaymentRequest)
  .action(async ({ bindArgsParsedInputs: [workspaceId], parsedInput }) => {
    if (!isPlatformSubscriptionPaymentsEnabled()) {
      throw new ChatbotXException(
        "Subscription payments are not enabled on this environment.",
        "featureDisabled",
        403,
      )
    }

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
      await platformSubscriptionPaymentService.createSubmission({
        workspaceId,
        planSlug: parsedInput.planSlug,
        billingCycle: parsedInput.billingCycle,
        paymentMethod: parsedInput.paymentMethod,
        reference: parsedInput.reference,
        receiptFileId: parsedInput.receiptFileId,
        receiptNote: parsedInput.receiptNote,
      })

    return { submissionId: submission.id, status: submission.status }
  })
