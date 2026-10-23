"use server"

import {
  broadcastService,
  platformSubscriptionService,
} from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import { resolveScheduleTime, scheduleBroadcastSchema } from "../schema/action"
import { withBroadcastPlanLimitOutcome } from "./broadcast-plan-limit-outcome"

export const scheduleBroadcastAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(scheduleBroadcastSchema)
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, id],
      parsedInput,
    } = props

    // Wesal One: broadcasts are a paid-plan feature — drafts included, so a
    // free workspace never builds a campaign it could not launch.
    await platformSubscriptionService.assertPaidPlanForWorkspace(workspaceId)

    // The service owns the draft-status guard and the audit record (only
    // when `schedulesType === "now"`) — shared with the public API's
    // `schedule` route.
    return await withBroadcastPlanLimitOutcome(() =>
      broadcastService.scheduleDraft({
        workspaceId,
        broadcastId: id,
        schedulesType: parsedInput.schedulesType,
        schedulesAt: resolveScheduleTime(parsedInput),
        sendRatePerMinute: parsedInput.sendRatePerMinute,
        recurrence: parsedInput.recurrence,
      }),
    )
  })
