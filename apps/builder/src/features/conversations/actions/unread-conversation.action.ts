"use server"

import { conversationService } from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import {
  assertConversationVisible,
  resolveConversationAssigneeScope,
} from "../lib/assignee-scope"

export const unreadConversationAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, id],
    } = props
    await assertConversationVisible({
      workspaceId,
      conversationId: id,
      scope: await resolveConversationAssigneeScope({
        workspaceId,
        userId: props.ctx.user.id,
        permissions: props.ctx.workspaceMemberPermissions,
      }),
    })

    return await conversationService.markUnread({ workspaceId, id })
  })
