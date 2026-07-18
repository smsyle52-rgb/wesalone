import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const platformSubscriptionPaymentRelations = defineRelationsPart(
  schema,
  (r) => ({
    platformSubscriptionPaymentModel: {
      workspace: r.one.workspaceModel({
        from: r.platformSubscriptionPaymentModel.workspaceId,
        to: r.workspaceModel.id,
      }),
      receiptFile: r.one.fileModel({
        from: r.platformSubscriptionPaymentModel.receiptFileId,
        to: r.fileModel.id,
      }),
      reviewer: r.one.userModel({
        from: r.platformSubscriptionPaymentModel.reviewedBy,
        to: r.userModel.id,
      }),
    },
  }),
)
