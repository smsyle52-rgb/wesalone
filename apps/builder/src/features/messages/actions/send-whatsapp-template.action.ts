"use server"

import { zodBigintAsString } from "@chatbotx.io/utils"
import {
  assertConversationVisible,
  resolveConversationAssigneeScope,
} from "@/features/conversations/lib/assignee-scope"
import { workspaceActionClient } from "@/lib/safe-action"
import { sendWhatsappTemplateToConversation } from "../lib/send-whatsapp-template"
import { sendWhatsappTemplateRequest } from "../schema/send-template"

/**
 * Sends one approved WhatsApp template into the open conversation with the
 * agent's runtime params (see `sendWhatsappTemplateToConversation`).
 */
export const sendWhatsappTemplateAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(sendWhatsappTemplateRequest)
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, conversationId],
      parsedInput,
      ctx,
    } = props
    await assertConversationVisible({
      workspaceId,
      conversationId,
      scope: await resolveConversationAssigneeScope({
        workspaceId,
        userId: props.ctx.user.id,
        permissions: props.ctx.workspaceMemberPermissions,
      }),
    })

    await sendWhatsappTemplateToConversation({
      workspaceId,
      conversationId,
      request: parsedInput,
      sender: { initiatedBy: "user", adminId: ctx.user.id },
    })
  })
