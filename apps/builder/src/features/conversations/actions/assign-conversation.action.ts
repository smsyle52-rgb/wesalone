"use server"

import { conversationService } from "@chatbotx.io/business"
import type { UserModel } from "@chatbotx.io/database/types"
import {
  type WorkspaceIdRequestParams,
  workspaceIdrequestParams,
} from "@/features/common/schema"
import {
  type AssignConversationSchema,
  assignConversationSchema,
} from "@/features/conversations/schema/action"
import { workspaceActionClient } from "@/lib/safe-action"
import {
  assertContactsVisible,
  resolveConversationAssigneeScope,
} from "../lib/assignee-scope"

export const assignConversationAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(assignConversationSchema)
  .action(
    async ({
      bindArgsParsedInputs: [workspaceId],
      parsedInput,
      ctx,
    }: {
      bindArgsParsedInputs: WorkspaceIdRequestParams
      parsedInput: AssignConversationSchema
      ctx: {
        user: UserModel
        workspaceMemberPermissions: Record<string, unknown>
      }
    }) => {
      await assertContactsVisible({
        workspaceId,
        contactIds: parsedInput.contactIds,
        scope: await resolveConversationAssigneeScope({
          workspaceId,
          userId: ctx.user.id,
          permissions: ctx.workspaceMemberPermissions,
        }),
      })
      await conversationService.assignByContactIds({
        workspaceId,
        contactIds: parsedInput.contactIds,
        assignedId: parsedInput.assignedId,
        assignedBy: ctx.user.id,
        triggerContext: {
          triggerSource: "api",
          triggerHandler: "assignConversation",
        },
      })
    },
  )
