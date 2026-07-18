import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const inventoryStockRelations = defineRelationsPart(schema, (r) => ({
  inventoryStockModel: {
    location: r.one.inventoryLocationModel({
      from: r.inventoryStockModel.locationId,
      to: r.inventoryLocationModel.id,
    }),
    product: r.one.productModel({
      from: r.inventoryStockModel.productId,
      to: r.productModel.id,
    }),
    productVariant: r.one.productVariantModel({
      from: r.inventoryStockModel.productVariantId,
      to: r.productVariantModel.id,
    }),
    workspace: r.one.workspaceModel({
      from: r.inventoryStockModel.workspaceId,
      to: r.workspaceModel.id,
    }),
  },
}))
