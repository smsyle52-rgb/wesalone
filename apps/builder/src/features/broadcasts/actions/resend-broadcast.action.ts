"use server"

import {
  broadcastService,
  platformSubscriptionService,
} from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { canViewContactEmailAndPhone } from "@/features/contacts/permissions"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import { withBroadcastPlanLimitOutcome } from "./broadcast-plan-limit-outcome"

export const resendBroadcastAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, id],
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

    // The service owns the existence/status guard and the email/phone
    // filter pruning — shared with the public API's `resend` route.
    return await withBroadcastPlanLimitOutcome(() =>
      broadcastService.resendWithPruning({
        workspaceId,
        id,
        canViewEmailAndPhone,
      }),
    )
  })
