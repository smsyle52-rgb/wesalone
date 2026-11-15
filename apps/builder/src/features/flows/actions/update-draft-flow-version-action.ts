"use server"

import { flowVersionService } from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { workspaceFlowsActionClient } from "@/lib/safe-action"
import { updateDraftFlowVersionSchema } from "../schema/action"

export const updateDraftFlowVersionAction = workspaceFlowsActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(updateDraftFlowVersionSchema)
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, id],
      parsedInput,
    } = props

    await flowVersionService.updateDraft({
      workspaceId,
      id,
      nodes: parsedInput.nodes,
      edges: parsedInput.edges,
    })
    return { ok: true as const }
  })
