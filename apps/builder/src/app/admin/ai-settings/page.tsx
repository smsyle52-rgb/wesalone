import { type VertexModel, vertexModels } from "@chatbotx.io/ai/models"
import {
  DEFAULT_PLATFORM_AI_CHAT_MODEL,
  platformAiSettingService,
} from "@chatbotx.io/business"
import { getTranslations } from "next-intl/server"
import { PlatformAiSettings } from "@/features/platform-ai/platform-ai-settings"

const DEFAULT_MODEL = vertexModels.parse(DEFAULT_PLATFORM_AI_CHAT_MODEL)

// The DB column is a plain `text()` (see packages/database/src/schema/platform-ai-setting.ts),
// so a value written before an allowlist change could in theory no longer be
// a valid VertexModel. Parse defensively rather than trust the stored string
// — the admin action layer is the one place that must reject bad input outright.
function toVertexModel(value: string): VertexModel {
  const parsed = vertexModels.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_MODEL
}

export default async function AdminAiSettingsPage() {
  const t = await getTranslations()
  const setting = await platformAiSettingService.get()

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-bold text-lg sm:text-xl">
          {t("platformAiSettings.title")}
        </h3>
        <p className="text-muted-foreground text-sm">
          {t("platformAiSettings.description")}
        </p>
      </div>

      <PlatformAiSettings
        setting={{
          chatModel: toVertexModel(setting.chatModel),
          embeddingModel: setting.embeddingModel,
          fallbackModel: setting.fallbackModel
            ? toVertexModel(setting.fallbackModel)
            : null,
          location: setting.location,
          capabilities: setting.capabilities,
          enabled: setting.enabled,
        }}
      />
    </div>
  )
}
