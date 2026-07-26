"use server"

import {
  getPlatformAiEnvStatus,
  probePlatformVertexChatModel,
} from "@chatbotx.io/ai/server"
import { platformAiSettingService } from "@chatbotx.io/business"
import { superAdminActionClient } from "@/lib/safe-action"

/**
 * Configuration-shape check only — this never calls Vertex AI. It confirms
 * the deployment env is wired (VERTEX_AI_PROJECT_ID present) and reports the
 * model that would be used, without ever returning the project id itself or
 * making any network call. A true end-to-end connectivity check is a manual,
 * post-deploy step for the team.
 */
export const validatePlatformAiSettingsAction = superAdminActionClient.action(
  async () => {
    const [setting, envStatus] = [
      await platformAiSettingService.get(),
      getPlatformAiEnvStatus(),
    ]

    const issues: ("missingProjectId" | "modelUnavailable")[] = []
    if (envStatus.hasProjectId) {
      try {
        await probePlatformVertexChatModel({
          modelId: setting.chatModel,
          location: setting.location,
        })
      } catch {
        issues.push("modelUnavailable")
      }
    } else {
      issues.push("missingProjectId")
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
