import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const orderItemRelations = defineRelationsPart(schema, (r) => ({
  orderItemModel: {
    order: r.one.orderModel({
      from: r.orderItemModel.orderId,
      to: r.orderModel.id,
    }),
    product: r.one.productModel({
      from: r.orderItemModel.productId,
      to: r.productModel.id,
    }),
    productVariant: r.one.productVariantModel({
      from: r.orderItemModel.productVariantId,
      to: r.productVariantModel.id,
    }),
    location: r.one.inventoryLocationModel({
      from: r.orderItemModel.locationId,
      to: r.inventoryLocationModel.id,
    }),
  },
}))
