import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const inventoryMovementRelations = defineRelationsPart(schema, (r) => ({
  inventoryMovementModel: {
    location: r.one.inventoryLocationModel({
      from: r.inventoryMovementModel.locationId,
      to: r.inventoryLocationModel.id,
    }),
    product: r.one.productModel({
      from: r.inventoryMovementModel.productId,
      to: r.productModel.id,
    }),
    productVariant: r.one.productVariantModel({
      from: r.inventoryMovementModel.productVariantId,
      to: r.productVariantModel.id,
    }),
    workspace: r.one.workspaceModel({
      from: r.inventoryMovementModel.workspaceId,
      to: r.workspaceModel.id,
    }),
  },
}))
