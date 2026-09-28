import { buildContext, whatsappMessageTemplateService } from "@chatbotx.io/business"
import type { IntegrationWhatsappModel } from "@chatbotx.io/database/types"
import type { WhatsappAuthValue } from "@chatbotx.io/integration-whatsapp"
import { integrations } from "@/integration"

/**
 * Mirror a WhatsApp number's templates from Meta into `WhatsappMessageTemplate`
 * (insert new, update changed, delete ones Meta no longer lists). Shared by
 * the "Synchronize" action and template creation, so a just-created template
 * lands with the full `components` the broadcast and flow pickers read.
 *
 * Deliberately NOT a "use server" module: exported functions there become
 * client-callable actions, and this one trusts the integration it is given.
 */
export async function syncWhatsappMessageTemplatesForIntegration({
  workspaceId,
  integrationWhatsapp,
}: {
  workspaceId: string
  integrationWhatsapp: IntegrationWhatsappModel
}): Promise<void> {
  const ctx = await buildContext({
    workspaceId,
    integrationType: "whatsapp",
    integration: {
      ...integrationWhatsapp,
      auth: integrationWhatsapp.auth as WhatsappAuthValue,
    },
  })
  const res = await integrations.whatsapp.runAction("listMessageTemplates", {
    ctx,
  })

  await whatsappMessageTemplateService.syncFromMeta({
    integrationWhatsappId: integrationWhatsapp.id,
    templates: res.data,
  })
}
