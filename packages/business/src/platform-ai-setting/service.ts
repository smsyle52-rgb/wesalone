import { db, eq } from "@chatbotx.io/database/client"
import {
  type PlatformAiCapabilities,
  platformAiCapabilitiesSchema,
} from "@chatbotx.io/database/partials"
import { platformAiSettingModel } from "@chatbotx.io/database/schema"
import { invalidateCacheKeys, withCache } from "@chatbotx.io/redis"

export const PLATFORM_AI_PROVIDER = "vertex" as const
export const DEFAULT_PLATFORM_AI_CHAT_MODEL = "gemini-3.1-flash-lite"
export const DEFAULT_PLATFORM_AI_EMBEDDING_MODEL = "text-embedding-005"
export const DEFAULT_PLATFORM_AI_LOCATION = "global"

export const DEFAULT_PLATFORM_AI_CAPABILITIES: PlatformAiCapabilities = {
  vision: {
    provider: "vertex",
    model: "gemini-2.5-pro",
    fallbackModel: "gemini-2.5-flash",
    location: "global",
  },
  // Keep the existing embedding model as the migration default. Switching an
  // embedding model requires a controlled full re-index; the admin UI makes
  // the stronger gemini-embedding-001 selectable after that job is complete.
  embedding: {
    provider: "vertex",
    model: DEFAULT_PLATFORM_AI_EMBEDDING_MODEL,
    location: DEFAULT_PLATFORM_AI_LOCATION,
  },
  summarization: {
    provider: "vertex",
    model: "gemini-3.1-flash-lite",
    fallbackModel: "gemini-2.5-flash",
    location: "global",
  },
  extraction: {
    provider: "vertex",
    model: "gemini-2.5-pro",
    fallbackModel: "gemini-2.5-flash",
    location: "global",
  },
  imageGeneration: {
    provider: "vertex",
    model: "imagen-4.0-ultra-generate-001",
    fallbackModel: "imagen-4.0-generate-001",
    location: "us-central1",
  },
  imageEditing: {
    provider: "vertex",
    model: "gemini-3.1-flash-image",
    fallbackModel: "gemini-2.5-flash-image",
    location: "global",
  },
  speechToText: {
    provider: "vertex",
    model: "chirp_3",
    fallbackModel: "chirp_2",
    location: "us",
  },
  textToSpeech: {
    provider: "googleCloud",
    model: "chirp3-hd",
    location: "global",
    voice: "ar-XA-Chirp3-HD-Aoede",
  },
  webSearch: {
    provider: "vertex",
    model: "gemini-2.5-flash",
    location: "global",
  },
  documentParsing: {
    provider: "local",
    model: "builtin-layout-parser",
  },
  translation: {
    provider: "googleCloud",
    model: "translation-llm",
    location: "global",
  },
}

const ACTIVE_CACHE_KEY = "platform-ai-setting:active"
const ACTIVE_CACHE_TTL_SECONDS = 60 * 60

export type PlatformAiSettingView = {
  provider: typeof PLATFORM_AI_PROVIDER
  chatModel: string
  embeddingModel: string
  location: string
  fallbackModel: string | null
  capabilities: PlatformAiCapabilities
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
  capabilities: PlatformAiCapabilities
}

const DEFAULT_SETTING: PlatformAiSettingView = {
  provider: PLATFORM_AI_PROVIDER,
  chatModel: DEFAULT_PLATFORM_AI_CHAT_MODEL,
  embeddingModel: DEFAULT_PLATFORM_AI_EMBEDDING_MODEL,
  location: DEFAULT_PLATFORM_AI_LOCATION,
  fallbackModel: null,
  capabilities: DEFAULT_PLATFORM_AI_CAPABILITIES,
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
          capabilities: setting.capabilities,
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
    location: string
    capabilities: PlatformAiCapabilities
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
            location: props.location,
            enabled: props.enabled,
            capabilities: props.capabilities,
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
            location: props.location,
            fallbackModel: props.fallbackModel,
            capabilities: props.capabilities,
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
      capabilities: parseCapabilities(row.capabilities),
      enabled: row.enabled,
      updatedByUserId: row.updatedByUserId,
      updatedAt: row.updatedAt,
    }
  }
}

function parseCapabilities(value: unknown): PlatformAiCapabilities {
  const parsed = platformAiCapabilitiesSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_PLATFORM_AI_CAPABILITIES
}

export const platformAiSettingService = new PlatformAiSettingService()
