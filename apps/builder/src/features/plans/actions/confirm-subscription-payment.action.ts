"use server"

import { platformSubscriptionPaymentService } from "@chatbotx.io/business"
import { superAdminActionClient } from "@/lib/safe-action"
import { confirmSubscriptionPaymentRequest } from "../schema/subscription-payment-action"

// Super-admin-only (the same gate as the rest of /admin) — deliberately NOT
// on workspaceActionClient, so the workspace owner who submitted the claim
// can never confirm their own payment. This is the only action that ever
// activates a plan from this flow, and only after a real human reviews the
// submission. Idempotent: see
// platformSubscriptionPaymentService.confirmSubmission for the
// transaction + conditional-update guard against double-processing.
export const confirmSubscriptionPaymentAction = superAdminActionClient
  .inputSchema(confirmSubscriptionPaymentRequest)
  .action(async ({ ctx, parsedInput }) => {
    const submission =
      await platformSubscriptionPaymentService.confirmSubmission({
        submissionId: parsedInput.submissionId,
        reviewedByUserId: ctx.user.id,
      })
    return { submissionId: submission.id, status: submission.status }
  })
