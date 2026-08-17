"use server"

import {
  getPlatformAiEnvStatus,
  probePlatformVertexChatModel,
} from "@chatbotx.io/ai/server"
import { platformAiSettingService } from "@chatbotx.io/business"
import { superAdminActionClient } from "@/lib/safe-action"

/**
 * Configuration check only. It probes the selected Vertex/Gemini model through
 * Azure Workload Identity Federation and reports presence-only status for the
 * Azure OpenAI automatic fallback. No endpoint, project identifier, token, or
 * secret is returned to the browser.
 */
export const validatePlatformAiSettingsAction = superAdminActionClient.action(
  async () => {
    const [setting, envStatus] = [
      await platformAiSettingService.get(),
      getPlatformAiEnvStatus(),
    ]

    const issues: (
      | "missingVertexConfig"
      | "missingWorkloadIdentityFederation"
      | "modelUnavailable"
      | "missingAzureOpenAIFallback"
    )[] = []

    if (!envStatus.hasVertexProjectId) {
      issues.push("missingVertexConfig")
    }
    if (!envStatus.hasWorkloadIdentityFederation) {
      issues.push("missingWorkloadIdentityFederation")
    }

    if (issues.length === 0) {
      try {
        await probePlatformVertexChatModel({
          location: setting.location,
          modelId: setting.chatModel,
        })
      } catch {
        issues.push("modelUnavailable")
      }
    }

    if (!envStatus.hasAzureOpenAIFallback) {
      issues.push("missingAzureOpenAIFallback")
    }

    return {
      ok: issues.length === 0,
      issues,
      resolvedChatModel: setting.chatModel,
      resolvedEmbeddingModel: "azure-openai-1536",
      resolvedLocation: envStatus.hasVertexLocationOverride
        ? "env-override"
        : setting.location,
      azureOpenAIFallbackConfigured: envStatus.hasAzureOpenAIFallback,
    }
  },
)
