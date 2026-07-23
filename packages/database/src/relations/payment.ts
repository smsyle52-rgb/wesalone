import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const paymentRelations = defineRelationsPart(schema, (r) => ({
  paymentModel: {
    order: r.one.orderModel({
      from: r.paymentModel.orderId,
      to: r.orderModel.id,
    }),
    workspace: r.one.workspaceModel({
      from: r.paymentModel.workspaceId,
      to: r.workspaceModel.id,
    }),
    webhookEvents: r.many.paymentWebhookEventModel({
      from: r.paymentModel.id,
      to: r.paymentWebhookEventModel.paymentId,
    }),
  },
}))
