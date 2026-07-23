import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const orderRelations = defineRelationsPart(schema, (r) => ({
  orderModel: {
    workspace: r.one.workspaceModel({
      from: r.orderModel.workspaceId,
      to: r.workspaceModel.id,
    }),
    contact: r.one.contactModel({
      from: r.orderModel.contactId,
      to: r.contactModel.id,
    }),
    items: r.many.orderItemModel({
      from: r.orderModel.id,
      to: r.orderItemModel.orderId,
    }),
    payments: r.many.paymentModel({
      from: r.orderModel.id,
      to: r.paymentModel.orderId,
    }),
  },
}))
