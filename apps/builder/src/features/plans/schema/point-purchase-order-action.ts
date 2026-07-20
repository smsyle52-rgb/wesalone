import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"

// Deliberately no points/price field — the server always derives both from
// the PointTopupProduct catalog via topupProductSlug, never from the client.
// receiptFileId (not a URL) is the id of a File row the caller already
// uploaded through ChatbotX's own presigned-upload flow.
export const submitPointPurchaseOrderRequest = z.object({
  topupProductSlug: z.string().min(1),
  paymentMethod: z.enum(["kuraimi", "jawali", "bank_transfer", "cash"]),
  reference: z.string().trim().max(200).optional(),
  receiptFileId: zodBigintAsString(),
  receiptNote: z.string().trim().max(1000).optional(),
})

export const cancelPointPurchaseOrderRequest = z.object({
  orderId: z.string().min(1),
})

export const confirmPointPurchaseOrderRequest = z.object({
  orderId: z.string().min(1),
})

export const rejectPointPurchaseOrderRequest = z.object({
  orderId: z.string().min(1),
  reason: z.string().trim().min(3).max(1000),
})
