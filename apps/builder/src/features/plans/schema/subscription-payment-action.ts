import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"

// Deliberately no price/amount field — the server always derives it from the
// central WESAL_ONE_PLANS catalog via planSlug, never from the client.
// receiptFileId (not a URL) is the id of a File row the caller already
// uploaded through ChatbotX's own presigned-upload flow — the server
// verifies it belongs to this workspace before ever reading it.
export const submitSubscriptionPaymentRequest = z.object({
  planSlug: z.enum(["starter", "growth", "professional"]),
  billingCycle: z.enum(["monthly", "annual"]),
  paymentMethod: z.string().trim().min(1).max(100),
  reference: z.string().trim().max(200).optional(),
  receiptFileId: zodBigintAsString(),
  receiptNote: z.string().trim().max(1000).optional(),
})

export const cancelSubscriptionPaymentRequest = z.object({
  submissionId: z.string().min(1),
})

export const confirmSubscriptionPaymentRequest = z.object({
  submissionId: z.string().min(1),
})

export const rejectSubscriptionPaymentRequest = z.object({
  submissionId: z.string().min(1),
  reason: z.string().trim().min(3).max(1000),
})
