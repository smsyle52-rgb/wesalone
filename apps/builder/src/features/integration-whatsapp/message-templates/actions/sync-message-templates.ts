"use server"

import { zodBigintAsString } from "@chatbotx.io/utils"
import { findIntegrationWhatsapp } from "@/features/integration-whatsapp/queries"
import { workspaceActionClient } from "@/lib/safe-action"
import { syncWhatsappMessageTemplatesForIntegration } from "../lib/sync-message-templates"

export const syncMessageTemplateAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, id],
    } = props

    const integrationWhatsapp = await findIntegrationWhatsapp({
      workspaceId,
      id,
    })

    await syncWhatsappMessageTemplatesForIntegration({
      workspaceId,
      integrationWhatsapp,
    })
  })
