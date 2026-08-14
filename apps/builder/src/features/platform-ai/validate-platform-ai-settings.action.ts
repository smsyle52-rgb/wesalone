"use server"

import {
  getPlatformAiEnvStatus,
  probePlatformAzureOpenAIChatModel,
} from "@chatbotx.io/ai/server"
import { platformAiSettingService } from "@chatbotx.io/business"
import { superAdminActionClient } from "@/lib/safe-action"

/**
 * Configuration check only — it confirms the Azure OpenAI deployment env is
 * wired and probes the selected deployment without returning an endpoint or
 * API key to the caller.
 */
export const validatePlatformAiSettingsAction = superAdminActionClient.action(
  async () => {
    const [setting, envStatus] = [
      await platformAiSettingService.get(),
      getPlatformAiEnvStatus(),
    ]

    const issues: ("missingAzureOpenAIConfig" | "modelUnavailable")[] = []
    if (envStatus.hasEndpoint && envStatus.hasApiKey) {
      try {
        await probePlatformAzureOpenAIChatModel({
          modelId: setting.chatModel,
        })
      } catch {
        issues.push("modelUnavailable")
      }
    } else {
      issues.push("missingAzureOpenAIConfig")
    }

    return {
      ok: issues.length === 0,
      issues,
      resolvedChatModel: setting.chatModel,
      resolvedEmbeddingModel: setting.embeddingModel,
      resolvedLocation: envStatus.hasLocationOverride
        ? "env-override"
        : setting.location,
    }
  },
)
