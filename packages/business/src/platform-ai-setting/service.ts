import { db, eq } from "@chatbotx.io/database/client"
import {
  type PlatformAiCapabilities,
  platformAiCapabilitiesSchema,
} from "@chatbotx.io/database/partials"
import { platformAiSettingModel } from "@chatbotx.io/database/schema"
import { invalidateCacheKeys, withCache } from "@chatbotx.io/redis"

export const PLATFORM_AI_PROVIDER = "vertex" as const
export const DEFAULT_PLATFORM_AI_CHAT_MODEL = "gemini-3.5-flash"
// Azure OpenAI stays on the established 1536-dimensional embedding deployment.
export const DEFAULT_PLATFORM_AI_EMBEDDING_MODEL = "wesal-embedding"
export const DEFAULT_PLATFORM_AI_LOCATION = "global"

export const DEFAULT_PLATFORM_AI_CAPABILITIES: PlatformAiCapabilities = {
  vision: {
    provider: "vertex",
    model: DEFAULT_PLATFORM_AI_CHAT_MODEL,
    location: DEFAULT_PLATFORM_AI_LOCATION,
  },
  // Keep the established 1536-dimensional Azure embedding deployment. The
  // runtime ignores any legacy Vertex embedding entry to avoid vector drift.
  embedding: {
    provider: "azureOpenAI",
    model: DEFAULT_PLATFORM_AI_EMBEDDING_MODEL,
    location: "uaenorth",
  },
  summarization: {
    provider: "vertex",
    model: DEFAULT_PLATFORM_AI_CHAT_MODEL,
    location: DEFAULT_PLATFORM_AI_LOCATION,
  },
  extraction: {
    provider: "vertex",
    model: DEFAULT_PLATFORM_AI_CHAT_MODEL,
    location: DEFAULT_PLATFORM_AI_LOCATION,
  },
  // No image or speech deployment is provisioned yet. Defer to an explicitly
  // configured workspace provider instead of calling a capability implicitly.
  imageGeneration: { provider: "workspace", model: "gpt-image-1" },
  imageEditing: { provider: "workspace", model: "gpt-image-1" },
  speechToText: { provider: "workspace", model: "gpt-4o-transcribe" },
  textToSpeech: { provider: "workspace", model: "gpt-4o-mini-tts" },
  webSearch: {
    provider: "vertex",
    model: DEFAULT_PLATFORM_AI_CHAT_MODEL,
    location: DEFAULT_PLATFORM_AI_LOCATION,
  },
  documentParsing: {
    provider: "local",
    model: "builtin-layout-parser",
  },
  translation: {
    provider: "vertex",
    model: DEFAULT_PLATFORM_AI_CHAT_MODEL,
    location: DEFAULT_PLATFORM_AI_LOCATION,
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
 * Central, platform-wide Vertex AI configuration — a singleton row. Only
 * the chat model, fallback model, and enabled flag are admin-editable (see the
 * builder action); embeddingModel/location/provider keep their seeded
 * defaults until a real need to change them is proven. Credentials live only
 * in deployment secrets and are never stored in this table.
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
