"use server"

import { platformAiSettingService } from "@chatbotx.io/business"
import { superAdminActionClient } from "@/lib/safe-action"
import { updatePlatformAiSettingsSchema } from "./schema"

// Super-admin-only — the same gate as the rest of /admin (this page lives
// under apps/builder/src/app/admin, already isSuperAdmin-gated at the layout).
// Vertex AI is a single, deployment-wide provider (fixed GCP project/ADC via
// the Cloud Run service account), not a per-reseller BYO credential, so
// there's no separate `platformAdminActionClient` (tenant-scoped) path here —
// unlike platform-branding/platform-credentials, which resellers can white-label.
export const updatePlatformAiSettingsAction = superAdminActionClient
  .inputSchema(updatePlatformAiSettingsSchema)
  .action(async ({ ctx, parsedInput }) => {
    const setting = await platformAiSettingService.upsert({
      chatModel: parsedInput.chatModel,
      fallbackModel: parsedInput.fallbackModel || null,
      enabled: parsedInput.enabled,
      updatedByUserId: ctx.user.id,
    })
    return {
      chatModel: setting.chatModel,
      fallbackModel: setting.fallbackModel,
      enabled: setting.enabled,
    }
  })
