import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const platformSubscriptionRelations = defineRelationsPart(
  schema,
  (r) => ({
    platformSubscriptionModel: {
      user: r.one.userModel({
        from: r.platformSubscriptionModel.userId,
        to: r.userModel.id,
      }),
      workspace: r.one.workspaceModel({
        from: r.platformSubscriptionModel.workspaceId,
        to: r.workspaceModel.id,
      }),
      payments: r.many.platformSubscriptionPaymentModel({
        from: r.platformSubscriptionModel.id,
        to: r.platformSubscriptionPaymentModel.subscriptionId,
      }),
    },
  }),
)
