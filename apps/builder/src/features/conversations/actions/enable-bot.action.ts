"use server"

import { conversationService } from "@chatbotx.io/business"
import type { UserModel } from "@chatbotx.io/database/types"
import {
  type BulkUpdateIdsRequest,
  bulkUpdateIdsRequest,
  type WorkspaceIdRequestParams,
  workspaceIdrequestParams,
} from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import {
  assertConversationsVisible,
  resolveConversationAssigneeScope,
} from "../lib/assignee-scope"

export const enableBotAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(bulkUpdateIdsRequest)
  .action(
    async ({
      bindArgsParsedInputs: [workspaceId],
      parsedInput,
      ctx,
    }: {
      bindArgsParsedInputs: WorkspaceIdRequestParams
      parsedInput: BulkUpdateIdsRequest
      ctx: {
        user: UserModel
        workspaceMemberPermissions: Record<string, unknown>
      }
    }) => {
      await assertConversationsVisible({
        workspaceId,
        conversationIds: parsedInput.ids,
        scope: await resolveConversationAssigneeScope({
          workspaceId,
          userId: ctx.user.id,
          permissions: ctx.workspaceMemberPermissions,
        }),
      })
      await conversationService.setBotEnabledByIds({
        workspaceId,
        ids: parsedInput.ids,
        botEnabled: true,
        userId: ctx.user.id,
        triggerContext: {
          triggerSource: "api",
          triggerHandler: "enableBotAction",
          triggerType: "conversation_transferred_to_bot",
        },
      })
    },
  )
