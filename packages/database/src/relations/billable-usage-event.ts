import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const billableUsageEventRelations = defineRelationsPart(schema, (r) => ({
  billableUsageEventModel: {
    user: r.one.userModel({
      from: r.billableUsageEventModel.userId,
      to: r.userModel.id,
    }),
    workspace: r.one.workspaceModel({
      from: r.billableUsageEventModel.workspaceId,
      to: r.workspaceModel.id,
    }),
    wallet: r.one.pointWalletModel({
      from: r.billableUsageEventModel.walletId,
      to: r.pointWalletModel.id,
    }),
  },
}))
