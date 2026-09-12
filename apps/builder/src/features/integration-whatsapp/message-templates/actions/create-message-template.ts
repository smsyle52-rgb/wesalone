"use server"

import {
  buildContext,
  integrationWhatsappService,
  whatsappMessageTemplateService,
} from "@chatbotx.io/business"
import type { WhatsappAuthValue } from "@chatbotx.io/integration-whatsapp"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { integrations } from "@/integration"
import { logger } from "@/lib/log"
import { workspaceActionClient } from "@/lib/safe-action"
import { buildWhatsappMessageTemplateComponents } from "../lib/build-template-components"
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
    const integrationWhatsapp =
      await integrationWhatsappService.findByIdForWorkspace({
        workspaceId,
        id: integrationWhatsappId,
      })
    if (!integrationWhatsapp) {
      throw new Error("Whatsapp integration not found")
    }

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
      const res = await integrations.whatsapp.runAction(
        "listMessageTemplates",
        { ctx },
      )
      await whatsappMessageTemplateService.syncFromMeta({
        integrationWhatsappId: integrationWhatsapp.id,
        templates: res.data,
      })
    } catch (err) {
      logger.warn(
        { err, workspaceId, integrationWhatsappId, templateId: created.id },
        "WhatsApp template created but the templates mirror failed",
      )
    }

    return { id: created.id, status: created.status }
  })
