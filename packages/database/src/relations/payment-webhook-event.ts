import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const paymentWebhookEventRelations = defineRelationsPart(
  schema,
  (r) => ({
    paymentWebhookEventModel: {
      payment: r.one.paymentModel({
        from: r.paymentWebhookEventModel.paymentId,
        to: r.paymentModel.id,
      }),
    },
  }),
)
