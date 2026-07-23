import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const platformAiSettingRelations = defineRelationsPart(schema, (r) => ({
  platformAiSettingModel: {
    updatedByUser: r.one.userModel({
      from: r.platformAiSettingModel.updatedByUserId,
      to: r.userModel.id,
    }),
  },
}))
