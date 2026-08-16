import { createEnv } from "@t3-oss/env-core"
import z from "zod"

export const keys = () =>
  createEnv({
    server: {
      AI_INTEGRATION_CACHE_TTL_SECONDS: z.coerce.number().default(60 * 60),
      // Azure OpenAI is the platform provider. These remain optional so an
      // incomplete deployment fails closed to workspace providers.
      AZURE_OPENAI_ENDPOINT: z.url().optional(),
      AZURE_OPENAI_API_KEY: z.string().trim().min(1).optional(),
      AZURE_OPENAI_LOCATION: z.string().trim().min(1).optional(),
      AZURE_OPENAI_CHAT_DEPLOYMENT: z.string().trim().min(1).optional(),
      AZURE_OPENAI_EMBEDDING_DEPLOYMENT: z.string().trim().min(1).optional(),
      // Legacy values remain readable only while old database rows are moved
      // on the Azure copy; runtime Platform AI never authenticates to Vertex.
      VERTEX_AI_PROJECT_ID: z.string().trim().min(1).optional(),
      VERTEX_AI_LOCATION: z.string().trim().min(1).optional(),
      GOOGLE_DOCUMENT_AI_PROCESSOR_ID: z.string().trim().min(1).optional(),
      GOOGLE_DOCUMENT_AI_LOCATION: z.string().trim().min(1).optional(),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  })

export const env = keys()
