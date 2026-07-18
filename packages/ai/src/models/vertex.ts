import { z } from "zod"
import { geminiModelOptions, geminiModels } from "./gemini"

/**
 * Vertex AI serves the same Gemini model family as the Gemini Developer API
 * (`@ai-sdk/google`, see `./gemini`), so the platform-admin chat-model
 * allowlist reuses that catalog instead of maintaining a second list that can
 * silently drift. This is the internal platform provider only — never
 * surfaced in the workspace-facing `aiChatProviders` registry.
 */
export const vertexModels = geminiModels
export type VertexModel = z.infer<typeof vertexModels>
export const vertexModelOptions = geminiModelOptions

export const vertexEmbeddingModels = z.enum([
  "text-embedding-005",
  "text-embedding-004",
  "text-multilingual-embedding-002",
])
export type VertexEmbeddingModel = z.infer<typeof vertexEmbeddingModels>

export const vertexEmbeddingModelOptions: {
  label: string
  value: VertexEmbeddingModel
}[] = [
  {
    label: "text-embedding-005",
    value: vertexEmbeddingModels.enum["text-embedding-005"],
  },
  {
    label: "text-embedding-004",
    value: vertexEmbeddingModels.enum["text-embedding-004"],
  },
  {
    label: "text-multilingual-embedding-002",
    value: vertexEmbeddingModels.enum["text-multilingual-embedding-002"],
  },
]
