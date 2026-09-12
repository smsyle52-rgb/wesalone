import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { db } from "@chatbotx.io/database/client"
import { secretTextAuthSchema } from "@chatbotx.io/sdk"
import type { EmbeddingModel, embed } from "ai"
import { geminiEmbeddingModels, openaiEmbeddingModels } from "../models"
import {
  getPlatformEmbeddingModel,
  getPlatformEmbeddingProviderOptions,
} from "./platform-provider"

/** `platform` is Wesal One's shared provider, used by workspaces with no key. */
export type EmbeddingProvider = "openai" | "gemini" | "platform"

export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"

type EmbeddingProviderOptions = NonNullable<
  Parameters<typeof embed>[0]["providerOptions"]
>

export type ResolvedEmbeddingModel = {
  model: EmbeddingModel
  provider: EmbeddingProvider
  /**
   * Options to pass to `embed()`. Both sides of retrieval — indexing a chunk
   * and embedding the query — must use the same model AND the same options,
   * or the stored vectors are silently unsearchable (pgvector columns are 1536).
   */
  providerOptions: (
    taskType: EmbeddingTaskType,
  ) => Promise<EmbeddingProviderOptions | undefined>
}

const KEY_PROVIDER_OPTIONS = async (): Promise<EmbeddingProviderOptions> => ({
  google: { outputDimensionality: 1536 },
})

export async function resolveEmbeddingModel(
  workspaceId: string,
): Promise<ResolvedEmbeddingModel> {
  // Wesal One: the platform provider comes first. Merchants have no key of
  // their own, so without this every knowledge upload and every retrieval
  // failed with "No embedding provider configured".
  const platformModel = await getPlatformEmbeddingModel()
  if (platformModel) {
    return {
      model: platformModel,
      provider: "platform",
      providerOptions: (taskType) =>
        getPlatformEmbeddingProviderOptions(taskType),
    }
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
      providerOptions: KEY_PROVIDER_OPTIONS,
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
      providerOptions: KEY_PROVIDER_OPTIONS,
    }
  }

  throw new Error(
    "No embedding provider configured. AI file embeddings require OpenAI or Gemini integration. DeepSeek and Claude do not support embedding models.",
  )
}
