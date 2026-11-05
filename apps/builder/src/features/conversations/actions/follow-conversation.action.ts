"use server"

import { conversationService } from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import {
  assertConversationVisible,
  resolveConversationAssigneeScope,
} from "../lib/assignee-scope"

export const followConversationAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, id],
      ctx,
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

    await conversationService.setFollowed({
      workspaceId,
      id,
      followed: true,
      userId: ctx.user.id,
      triggerContext: {
        triggerSource: "api",
        triggerHandler: "followConversationAction",
        triggerType: "conversation_followed",
      },
    })
  })
