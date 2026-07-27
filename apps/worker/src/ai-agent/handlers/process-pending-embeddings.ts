import { getPlatformEmbeddingProviderOptions } from "@chatbotx.io/ai/server"
import { usageMeteringService } from "@chatbotx.io/business"
import { db, eq, findOrFail } from "@chatbotx.io/database/client"
import { aiEmbeddingStatuses } from "@chatbotx.io/database/partials"
import { aiEmbeddingModel } from "@chatbotx.io/database/schema"
import type { AIJobProcessPendingEmbedding } from "@chatbotx.io/worker-config"
import { embed } from "ai"
import { resolveEmbeddingModel } from "../../ai-agent/lib/embedding-model"
import { logger } from "../../lib/logger"

export async function processPendingEmbedding(
  data: AIJobProcessPendingEmbedding["data"],
) {
  const aiEmbedding = await findOrFail({
    table: aiEmbeddingModel,
    where: {
      id: data.aiEmbeddingId,
    },
    message: "AI embedding not found",
  })
  if (aiEmbedding.status !== "pending" && aiEmbedding.status !== "processing") {
    throw new Error("AI embedding is processing or already processed")
  }

  try {
    const embeddingModel = await resolveEmbeddingModel(aiEmbedding.workspaceId)
    const reservation = await usageMeteringService.reserve({
      workspaceId: aiEmbedding.workspaceId,
      operationId: `embedding-document:${aiEmbedding.id}`,
      category: "embedding_document",
      metadata: { aiEmbeddingId: aiEmbedding.id },
    })

    try {
      const { embedding, usage } = await embed({
        model: embeddingModel,
        value: aiEmbedding.content,
        providerOptions:
          await getPlatformEmbeddingProviderOptions("RETRIEVAL_DOCUMENT"),
      })

      await usageMeteringService.settleUnits(
        reservation,
        "embedding_document",
        usage.tokens,
        { tokens: usage.tokens },
      )

      await db
        .update(aiEmbeddingModel)
        .set({
          embedding: embedding as number[],
          updatedAt: new Date(),
          status: aiEmbeddingStatuses.enum.success,
        })
        .where(eq(aiEmbeddingModel.id, aiEmbedding.id))
    } catch (error) {
      await usageMeteringService.release(reservation, error)
      throw error
    }
  } catch (error) {
    logger.error(
      error,
      `processPendingEmbedding item failed for embeddingId: ${aiEmbedding.id}`,
    )

    await db
      .update(aiEmbeddingModel)
      .set({
        status: aiEmbeddingStatuses.enum.error,
      })
      .where(eq(aiEmbeddingModel.id, aiEmbedding.id))
  }
}
