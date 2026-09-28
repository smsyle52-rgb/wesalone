"use server"

import { aiFileService } from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { workspaceActionClientAllowExpired } from "@/lib/safe-action"

// Delete stays available after a trial expires (repo invariant 14).
export const deleteAIFileAction = workspaceActionClientAllowExpired
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, id],
    } = props

    return await aiFileService.delete({ workspaceId, id })
  })
