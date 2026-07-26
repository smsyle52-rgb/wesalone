import { db, eq } from "@chatbotx.io/database/client"
import { platformAiSettingModel } from "@chatbotx.io/database/schema"
import { invalidateCacheKeys, withCache } from "@chatbotx.io/redis"

export const PLATFORM_AI_PROVIDER = "vertex" as const
export const DEFAULT_PLATFORM_AI_CHAT_MODEL = "gemini-3.1-flash-lite"
export const DEFAULT_PLATFORM_AI_EMBEDDING_MODEL = "text-embedding-005"
export const DEFAULT_PLATFORM_AI_LOCATION = "us-central1"

const ACTIVE_CACHE_KEY = "platform-ai-setting:active"
const ACTIVE_CACHE_TTL_SECONDS = 60 * 60

export type PlatformAiSettingView = {
  provider: typeof PLATFORM_AI_PROVIDER
  chatModel: string
  embeddingModel: string
  location: string
  fallbackModel: string | null
  enabled: boolean
  updatedByUserId: string | null
  updatedAt: Date | null
}

export type ActivePlatformAiOverride = {
  chatModel: string
  fallbackModel: string | null
  location: string
  /**
   * Optional because entries cached before this field existed still deserialize
   * into this shape until their TTL lapses; callers must treat a missing value
   * as "no platform embedding model" rather than assuming one.
   */
  embeddingModel?: string
}

const DEFAULT_SETTING: PlatformAiSettingView = {
  provider: PLATFORM_AI_PROVIDER,
  chatModel: DEFAULT_PLATFORM_AI_CHAT_MODEL,
  embeddingModel: DEFAULT_PLATFORM_AI_EMBEDDING_MODEL,
  location: DEFAULT_PLATFORM_AI_LOCATION,
  fallbackModel: null,
  enabled: false,
  updatedByUserId: null,
  updatedAt: null,
}

/**
 * Central, platform-wide Vertex AI configuration — a singleton row. Only the
 * chat model, fallback model, and enabled flag are admin-editable (see the
 * builder action); embeddingModel/location/provider keep their seeded
 * defaults until a real need to change them is proven. Never stores or
 * returns credentials: Vertex AI auth is Application Default Credentials,
 * resolved at call time from the environment, not from this table.
 */
class PlatformAiSettingService {
  async get(): Promise<PlatformAiSettingView> {
    const row = await db.query.platformAiSettingModel.findFirst({
      where: { provider: PLATFORM_AI_PROVIDER },
    })
    if (!row) {
      return DEFAULT_SETTING
    }
    return this.toView(row)
  }

  /**
   * The one check the AI runtime needs: `null` means "use the agent's own
   * configured provider/model, exactly like today" — disabling this setting
   * always reverts to the pre-existing per-workspace behavior with no data
   * loss, since agent-stored `models` are never read or written here.
   * Cached so every reply-generation call doesn't add a DB round-trip.
   */
  async getActive(): Promise<ActivePlatformAiOverride | null> {
    return await withCache(
      ACTIVE_CACHE_KEY,
      async () => {
        const setting = await this.get()
        if (!setting.enabled) {
          return null
        }
        return {
          chatModel: setting.chatModel,
          fallbackModel: setting.fallbackModel,
          location: setting.location,
          embeddingModel: setting.embeddingModel,
        } satisfies ActivePlatformAiOverride
      },
      { ttl: ACTIVE_CACHE_TTL_SECONDS },
    )
  }

  async invalidateActiveCache(): Promise<void> {
    await invalidateCacheKeys([ACTIVE_CACHE_KEY])
  }

  async upsert(props: {
    chatModel: string
    fallbackModel: string | null
    enabled: boolean
    updatedByUserId: string
  }): Promise<PlatformAiSettingView> {
    const existing = await db.query.platformAiSettingModel.findFirst({
      where: { provider: PLATFORM_AI_PROVIDER },
    })

    const row = existing
      ? await db
          .update(platformAiSettingModel)
          .set({
            chatModel: props.chatModel,
            fallbackModel: props.fallbackModel,
            enabled: props.enabled,
            updatedByUserId: props.updatedByUserId,
          })
          .where(eq(platformAiSettingModel.id, existing.id))
          .returning()
          .then(([updated]) => updated)
      : await db
          .insert(platformAiSettingModel)
          .values({
            provider: PLATFORM_AI_PROVIDER,
            chatModel: props.chatModel,
            embeddingModel: DEFAULT_PLATFORM_AI_EMBEDDING_MODEL,
            location: DEFAULT_PLATFORM_AI_LOCATION,
            fallbackModel: props.fallbackModel,
            enabled: props.enabled,
            updatedByUserId: props.updatedByUserId,
          })
          .returning()
          .then(([created]) => created)

    await this.invalidateActiveCache()
    return this.toView(row)
  }

  private toView(
    row: typeof platformAiSettingModel.$inferSelect,
  ): PlatformAiSettingView {
    return {
      provider: PLATFORM_AI_PROVIDER,
      chatModel: row.chatModel,
      embeddingModel: row.embeddingModel,
      location: row.location,
      fallbackModel: row.fallbackModel,
      enabled: row.enabled,
      updatedByUserId: row.updatedByUserId,
      updatedAt: row.updatedAt,
    }
  }
}

export const platformAiSettingService = new PlatformAiSettingService()
