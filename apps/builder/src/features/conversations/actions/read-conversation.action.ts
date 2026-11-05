"use server"

import { conversationService } from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import {
  assertConversationVisible,
  resolveConversationAssigneeScope,
} from "../lib/assignee-scope"

export const readConversationAction = workspaceActionClient
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
    const agentLastReadAt = new Date()

    await conversationService.updateReadStatus({
      workspaceId,
      id,
      agentLastReadAt,
    })

    // The persisted value is returned so the client mirrors exactly what the
    // server wrote — a locally synthesized "now" could be later than a
    // message that arrived while this request was in flight, and would then
    // hide it (and reject the authoritative realtime update as older).
    return { agentLastReadAt: agentLastReadAt.toISOString() }
  })
