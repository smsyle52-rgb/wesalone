"use server"

import {
  broadcastService,
  platformSubscriptionService,
} from "@chatbotx.io/business"
import { workspaceIdrequestParams } from "@/features/common/schema"
import { canViewContactEmailAndPhone } from "@/features/contacts/permissions"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import { createBroadcastRequest } from "../schema/action"
import { withBroadcastPlanLimitOutcome } from "./broadcast-plan-limit-outcome"
import { withBroadcastValidationErrors } from "./broadcast-validation-error"

export const createBroadcastAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(createBroadcastRequest)
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId],
      parsedInput,
    } = props

    // Wesal One: broadcasts are a paid-plan feature — drafts included, so a
    // free workspace never builds a campaign it could not launch.
    await platformSubscriptionService.assertPaidPlanForWorkspace(workspaceId)

    const userAndWorkspace = await getCurrentUserAndTargetWorkspace(workspaceId)
    const canViewEmailAndPhone = userAndWorkspace
      ? canViewContactEmailAndPhone(
          userAndWorkspace.targetWorkspaceMember.permissions,
        )
      : false

    return await withBroadcastValidationErrors(() =>
      withBroadcastPlanLimitOutcome(() =>
        broadcastService.create({
          ...parsedInput,
          workspaceId,
          canViewEmailAndPhone,
        }),
      ),
    )
  })
