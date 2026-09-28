import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { db } from "@chatbotx.io/database/client"
import { secretTextAuthSchema } from "@chatbotx.io/sdk"
import type { EmbeddingModel } from "ai"
import { geminiEmbeddingModels, openaiEmbeddingModels } from "../models"
import {
  getPlatformEmbeddingModel,
  getPlatformEmbeddingProviderOptions,
} from "./platform-provider"

/**
 * `platform` is the platform-owned model (Vertex gemini-embedding-001 on Wesal
 * One, keyless via workload identity) — a workspace has no key of its own there,
 * so it must come first or every upload fails with "No embedding provider
 * configured".
 */
export type EmbeddingProvider = "platform" | "openai" | "gemini"

export type ResolvedEmbeddingModel = {
  model: EmbeddingModel
  provider: EmbeddingProvider
}

export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"

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

/**
 * Provider options for `embed()`/`embedMany()`. Indexing and retrieval must pass
 * the same dimensions, or the stored vectors cannot be compared with the query.
 */
export async function getEmbeddingProviderOptions(
  provider: EmbeddingProvider,
  taskType: EmbeddingTaskType,
): Promise<Record<string, Record<string, string | number>> | undefined> {
  if (provider === "platform") {
    return await getPlatformEmbeddingProviderOptions(taskType)
  }
  return { google: { outputDimensionality: 1536 } }
}

export async function resolveEmbeddingModel(
  workspaceId: string,
): Promise<ResolvedEmbeddingModel> {
  // Platform first, matching what retrieval embeds queries with. If indexing
  // and retrieval disagree the stored vectors are silently unsearchable.
  const platformModel = await getPlatformEmbeddingModel()
  if (platformModel) {
    return { model: platformModel, provider: "platform" }
  }

  const integrationOpenai = await db.query.integrationOpenaiModel.findFirst({
    where: { workspaceId },
  })

  if (integrationOpenai) {
    const authParsed = secretTextAuthSchema.safeParse(integrationOpenai.auth)
    if (!(authParsed.success && authParsed.data.secretText)) {
      throw new Error("Invalid OpenAI integration auth configuration")
    }

    return {
      model: createOpenAI({ apiKey: authParsed.data.secretText }).embedding(
        openaiEmbeddingModels.enum["text-embedding-ada-002"],
      ),
      provider: "openai",
    }
  }

  const integrationGemini = await db.query.integrationGeminiModel.findFirst({
    where: { workspaceId },
  })

  if (integrationGemini) {
    const authParsed = secretTextAuthSchema.safeParse(integrationGemini.auth)
    if (!(authParsed.success && authParsed.data.secretText)) {
      throw new Error("Invalid Gemini integration auth configuration")
    }

    return {
      model: createGoogleGenerativeAI({
        apiKey: authParsed.data.secretText,
      }).embedding(geminiEmbeddingModels.enum["gemini-embedding-001"]),
      provider: "gemini",
    }
  }

  throw new Error(
    "No embedding provider configured. AI file embeddings require OpenAI or Gemini integration. DeepSeek and Claude do not support embedding models.",
  )
}
