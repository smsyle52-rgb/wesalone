import {
  DEFAULT_PLATFORM_AI_CHAT_MODEL,
  platformAiSettingService,
} from "@chatbotx.io/business"
import { getTranslations } from "next-intl/server"
import { PlatformAiSettings } from "@/features/platform-ai/platform-ai-settings"

function toDeploymentName(value: string): string {
  const deployment = value.trim()
  return deployment.length > 0 ? deployment : DEFAULT_PLATFORM_AI_CHAT_MODEL
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
          chatModel: toDeploymentName(setting.chatModel),
          embeddingModel: setting.embeddingModel,
          fallbackModel: setting.fallbackModel
            ? toDeploymentName(setting.fallbackModel)
            : null,
          location: setting.location,
          capabilities: setting.capabilities,
          enabled: setting.enabled,
        }}
      />
    </div>
  )
}
