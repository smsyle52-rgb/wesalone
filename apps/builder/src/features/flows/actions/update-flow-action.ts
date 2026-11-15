"use server"

import { flowService } from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { workspaceFlowsActionClient } from "@/lib/safe-action"
import { updateFlowSchema } from "../schema/action"

export const updateFlowAction = workspaceFlowsActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(updateFlowSchema)
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, id],
      parsedInput,
    } = props

    await flowService.update({ workspaceId, id }, parsedInput)
  })
