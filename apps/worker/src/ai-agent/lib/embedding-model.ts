import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { geminiEmbeddingModels, openaiEmbeddingModels } from "@chatbotx.io/ai"
import { getPlatformEmbeddingModel } from "@chatbotx.io/ai/server"
import { db } from "@chatbotx.io/database/client"
import type { SecretTextAuthValue } from "@chatbotx.io/sdk"
import type { EmbeddingModel } from "ai"

/**
 * Identifies the model a vector was produced with, for usage-metering operation
 * ids. The operation is "embed this chunk with this model": a retried job keeps
 * the same id (so it is never billed twice), while re-embedding the same chunk
 * with a different model is a new operation. A chunk-only id made every
 * re-embed fail as "already completed" and leave the chunk in `error`.
 */
export function embeddingModelKey(model: EmbeddingModel): string {
  return typeof model === "string"
    ? model
    : `${model.provider}:${model.modelId}`
}

export async function resolveEmbeddingModel(
  workspaceId: string,
): Promise<EmbeddingModel> {
  // Platform Vertex first, matching what retrieval embeds queries with. If the
  // two halves disagree the stored vectors are silently unsearchable — and on a
  // platform-Vertex deployment a workspace has no key of its own, so without
  // this every upload failed outright with "No embedding provider configured".
  const platformModel = await getPlatformEmbeddingModel()
  if (platformModel) {
    return platformModel
  }

  // Find openAI
  const integrationOpenai = await db.query.integrationOpenaiModel.findFirst({
    where: { workspaceId },
  })
  if (integrationOpenai) {
    const apiKey = (integrationOpenai.auth as SecretTextAuthValue).secretText
    const openai = createOpenAI({ apiKey })

    return openai.embedding(
      openaiEmbeddingModels.enum["text-embedding-ada-002"],
    )
  }

  // Find gemini
  const integrationGemini = await db.query.integrationGeminiModel.findFirst({
    where: { workspaceId },
  })
  if (integrationGemini) {
    const apiKey = (integrationGemini.auth as SecretTextAuthValue).secretText
    const gemini = createGoogleGenerativeAI({ apiKey })

    return gemini.embedding(geminiEmbeddingModels.enum["text-embedding-004"])
  }

  throw new Error(
    "No embedding provider configured. AI file embeddings require OpenAI or Gemini integration. DeepSeek and Claude do not support embedding models.",
  )
}
