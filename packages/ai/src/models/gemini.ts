import { z } from "zod"

export const geminiEmbeddingModels = z.enum(["text-embedding-004"])
export type GeminiEmbeddingModel = z.infer<typeof geminiEmbeddingModels>

// Availability is per-project and changes without notice: `gemini-3-flash` was
// serving traffic and started returning 404 from Vertex on 29 Jul, which took
// every agent offline because the platform override leaves no non-Vertex
// candidate. Probed against this project's Vertex endpoint on 30 Jul —
// unavailable entries are kept out of the picker so an admin cannot select a
// model that 404s:
//   available   gemini-3.6-flash, gemini-3.5-flash, gemini-3.1-flash-lite,
//               gemini-3.1-pro-preview, gemini-2.5-flash, gemini-2.5-flash-lite,
//               gemini-2.5-pro
//   404         gemini-3-flash, gemini-3-pro-image-preview,
//               gemini-3.1-flash-image-preview, gemini-2.0-flash-thinking-exp
export const geminiModels = z.enum([
  "gemini-3-pro-image-preview",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash-thinking-exp",
  "gemini-3-flash",
  "gemini-3.1-pro-preview",
])
export type GeminiModel = z.infer<typeof geminiModels>

export const geminiAnalyzeImageModelOptions: {
  label: string
  value: GeminiModel
}[] = [
  {
    label: "Gemini 3.6 Flash",
    value: geminiModels.enum["gemini-3.6-flash"],
  },
  {
    label: "Gemini 3.5 Flash",
    value: geminiModels.enum["gemini-3.5-flash"],
  },
  {
    label: "Gemini 3.1 Flash Lite",
    value: geminiModels.enum["gemini-3.1-flash-lite"],
  },
  {
    label: "Gemini 3.1 Pro Preview",
    value: geminiModels.enum["gemini-3.1-pro-preview"],
  },
  {
    label: "Gemini 2.5 Flash-Lite",
    value: geminiModels.enum["gemini-2.5-flash-lite"],
  },
  {
    label: "Gemini 2.5 Flash",
    value: geminiModels.enum["gemini-2.5-flash"],
  },
  {
    label: "Gemini 2.5 Pro",
    value: geminiModels.enum["gemini-2.5-pro"],
  },
]

export const geminiModelOptions: { label: string; value: GeminiModel }[] = [
  {
    label: "Gemini 3.6 Flash",
    value: geminiModels.enum["gemini-3.6-flash"],
  },
  {
    label: "Gemini 3.5 Flash",
    value: geminiModels.enum["gemini-3.5-flash"],
  },
  {
    label: "Gemini 3.1 Pro Preview",
    value: geminiModels.enum["gemini-3.1-pro-preview"],
  },
  {
    label: "Gemini 3.1 Flash Lite",
    value: geminiModels.enum["gemini-3.1-flash-lite"],
  },
  {
    label: "Gemini 2.5 Flash Lite",
    value: geminiModels.enum["gemini-2.5-flash-lite"],
  },
  {
    label: "Gemini 2.5 Flash",
    value: geminiModels.enum["gemini-2.5-flash"],
  },
  {
    label: "Gemini 2.5 Pro",
    value: geminiModels.enum["gemini-2.5-pro"],
  },
]

export const geminiImageModels = z.enum(["gemini-3.1-flash-image-preview"])
export type GeminiImageModel = z.infer<typeof geminiImageModels>

export const geminiImageModelOptions: {
  label: string
  value: GeminiImageModel
}[] = [
  {
    label: "Imagen 3",
    value: geminiImageModels.enum["gemini-3.1-flash-image-preview"],
  },
]
