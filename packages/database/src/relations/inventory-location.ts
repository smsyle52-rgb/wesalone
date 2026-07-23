import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const inventoryLocationRelations = defineRelationsPart(schema, (r) => ({
  inventoryLocationModel: {
    workspace: r.one.workspaceModel({
      from: r.inventoryLocationModel.workspaceId,
      to: r.workspaceModel.id,
    }),
    stocks: r.many.inventoryStockModel({
      from: r.inventoryLocationModel.id,
      to: r.inventoryStockModel.locationId,
    }),
    movements: r.many.inventoryMovementModel({
      from: r.inventoryLocationModel.id,
      to: r.inventoryMovementModel.locationId,
    }),
  },
}))
