import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import {
  type PlatformAiCapabilities,
  platformAiProviders,
} from "../partials/platform-ai-setting"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { userModel } from "./auth-user"

export const platformAiProvider = pgEnum(
  "platformAiProvider",
  platformAiProviders.options as [string, ...string[]],
)

// Central, platform-wide AI provider configuration — a singleton row (enforced
// by the unique index on `provider`, which today only ever holds "vertex").
// Deliberately holds no secrets: Vertex AI authenticates via Application
// Default Credentials (Cloud Run service account) at runtime, never a stored
// key. Workspaces and their AI agents never read or write this table directly
// — see packages/ai/src/server/platform-provider.ts for the runtime override
// that makes every agent inherit `chatModel` when `enabled` is true.
export const platformAiSettingModel = pgTable(
  "PlatformAiSetting",
  {
    ...sharedColumns,
    provider: platformAiProvider().default("vertex").notNull(),
    chatModel: text().notNull(),
    embeddingModel: text().notNull(),
    location: text().notNull(),
    fallbackModel: text(),
    capabilities: jsonb().$type<PlatformAiCapabilities>(),
    enabled: boolean().default(false).notNull(),
    updatedByUserId: bigintAsString().references(() => userModel.id, {
      onDelete: "set null",
    }),
  },
  (table) => [uniqueIndex("PlatformAiSetting_provider_key").on(table.provider)],
)
