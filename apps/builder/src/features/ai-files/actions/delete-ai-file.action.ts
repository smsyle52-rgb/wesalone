"use server"

import { auditService } from "@chatbotx.io/business/audit"
import { db, eq, findOrFail } from "@chatbotx.io/database/client"
import { aiFileModel } from "@chatbotx.io/database/schema"
import { uploader } from "@chatbotx.io/filesystem"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { logger } from "@/lib/log"
import { workspaceActionClientAllowExpired } from "@/lib/safe-action"

export const deleteAIFileAction = workspaceActionClientAllowExpired
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, id],
    } = props

    return await deleteAIFile({ workspaceId, id })
  })

export const deleteAIFile = async (ctx: {
  workspaceId: string
  id: string
}) => {
  const targetAIFile = await findOrFail({
    table: aiFileModel,
    where: {
      id: ctx.id,
      workspaceId: ctx.workspaceId,
    },
    message: `AIFile with id ${ctx.id} not found`,
  })

  // The database is authoritative. Its FK cascade removes the embeddings.
  // Storage cleanup stays OUTSIDE the delete and is best-effort: upstream moved
  // `deleteObject` inside a transaction, which means a missing object or a
  // momentary storage outage rolls the row back and leaves a knowledge-base
  // entry the merchant can see and cannot delete. Keep Wesal's ordering; take
  // upstream's audit record, which is the part that was genuinely missing.
  await db.delete(aiFileModel).where(eq(aiFileModel.id, ctx.id))

  await auditService.record({
    workspaceId: ctx.workspaceId,
    action: "delete",
    detail: `deleted a Knowledge (#${ctx.id})`,
  })

  try {
    await uploader.deleteObject(targetAIFile.path)
  } catch (error) {
    logger.warn(error, `AI file storage cleanup failed for id: ${ctx.id}`)
  }
}
