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

export const enableLiveChatConversationAction = workspaceActionClient
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
      const conversations = await conversationService.findManyByIds({
        workspaceId,
        ids: parsedInput.ids,
      })

      await conversationService.disableBotState({
        workspaceId,
        conversations,
        userId: ctx.user.id,
        triggerContext: {
          triggerSource: "api",
          triggerHandler: "enableLiveChatConversationAction",
          triggerType: "conversation_transferred_to_human",
        },
      })
    },
  )
