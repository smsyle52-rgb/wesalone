"use server"

import { platformSubscriptionPaymentService } from "@chatbotx.io/business"
import { superAdminActionClient } from "@/lib/safe-action"
import { rejectSubscriptionPaymentRequest } from "../schema/subscription-payment-action"

// Super-admin-only, mirrors confirm-subscription-payment.action.ts.
// Never touches UserQuota — rejecting (or simply never reviewing) a
// submission cannot change a customer's current plan.
export const rejectSubscriptionPaymentAction = superAdminActionClient
  .inputSchema(rejectSubscriptionPaymentRequest)
  .action(async ({ ctx, parsedInput }) => {
    const submission =
      await platformSubscriptionPaymentService.rejectSubmission({
        submissionId: parsedInput.submissionId,
        reviewedByUserId: ctx.user.id,
        reason: parsedInput.reason,
      })
    return { submissionId: submission.id, status: submission.status }
  })
