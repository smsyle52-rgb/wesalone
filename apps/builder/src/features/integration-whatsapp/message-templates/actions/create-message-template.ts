"use server"

import { buildContext } from "@chatbotx.io/business"
import type { WhatsappAuthValue } from "@chatbotx.io/integration-whatsapp"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { findIntegrationWhatsapp } from "@/features/integration-whatsapp/queries"
import { integrations } from "@/integration"
import { logger } from "@/lib/log"
import { workspaceActionClient } from "@/lib/safe-action"
import { buildWhatsappMessageTemplateComponents } from "../lib/build-template-components"
import { syncWhatsappMessageTemplatesForIntegration } from "../lib/sync-message-templates"
import { createWhatsappMessageTemplateRequest } from "../schema/create-message-template"

/**
 * Submit a new WhatsApp message template to Meta for review, then mirror the
 * number's templates so the new one shows up (with its components) in the
 * templates table and the broadcast picker once Meta approves it.
 */
export const createWhatsappMessageTemplateAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(createWhatsappMessageTemplateRequest)
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, integrationWhatsappId],
      parsedInput,
    } = props

    // Scoped by workspace AND id: a workspace may have several numbers, and a
    // foreign id must never reach another workspace's WhatsApp account.
    const integrationWhatsapp = await findIntegrationWhatsapp({
      workspaceId,
      id: integrationWhatsappId,
    })

    const ctx = await buildContext({
      workspaceId,
      integrationType: "whatsapp",
      integration: {
        ...integrationWhatsapp,
        auth: integrationWhatsapp.auth as WhatsappAuthValue,
      },
    })

    const created = await integrations.whatsapp.runAction(
      "createMessageTemplate",
      {
        ctx,
        data: {
          name: parsedInput.name,
          language: parsedInput.language,
          category: parsedInput.category,
          components: buildWhatsappMessageTemplateComponents(parsedInput),
        },
      },
    )

    // The template already exists at Meta at this point. A failed mirror must
    // not report the creation as failed — "Synchronize" recovers it.
    try {
      await syncWhatsappMessageTemplatesForIntegration({
        workspaceId,
        integrationWhatsapp,
      })
    } catch (err) {
      logger.warn(
        { err, workspaceId, integrationWhatsappId, templateId: created.id },
        "WhatsApp template created but the templates mirror failed",
      )
    }

    return { id: created.id, status: created.status }
  })
