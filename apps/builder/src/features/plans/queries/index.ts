import { platformSubscriptionPaymentService } from "@chatbotx.io/business"

export const listSubscriptionPaymentsForWorkspace = async (
  workspaceId: string,
) => {
  const submissions =
    await platformSubscriptionPaymentService.listForWorkspace(workspaceId)
  return await Promise.all(
    submissions.map(async (submission) => ({
      ...submission,
      receiptUrl: await platformSubscriptionPaymentService.getReceiptViewUrl(
        submission.receiptFileId,
      ),
    })),
  )
}
