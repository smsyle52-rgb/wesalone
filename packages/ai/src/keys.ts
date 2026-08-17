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
      // Vertex AI authenticates with Azure Managed Identity through Google
      // Workload Identity Federation. None of these values is a credential.
      VERTEX_AI_PROJECT_ID: z.string().trim().min(1).optional(),
      VERTEX_AI_LOCATION: z.string().trim().min(1).optional(),
      VERTEX_AI_WIF_PROJECT_NUMBER: z.string().trim().regex(/^\d+$/).optional(),
      VERTEX_AI_WIF_POOL_ID: z.string().trim().min(1).optional(),
      VERTEX_AI_WIF_PROVIDER_ID: z.string().trim().min(1).optional(),
      VERTEX_AI_AZURE_AUDIENCE: z.string().trim().min(1).optional(),
      AZURE_MANAGED_IDENTITY_CLIENT_ID: z.string().uuid().optional(),
      // Azure Container Apps injects these on each replica; the header is a
      // short-lived local proof and is never configured or stored by Wesal.
      IDENTITY_ENDPOINT: z.string().url().optional(),
      IDENTITY_HEADER: z.string().trim().min(1).optional(),
      GOOGLE_DOCUMENT_AI_PROCESSOR_ID: z.string().trim().min(1).optional(),
      GOOGLE_DOCUMENT_AI_LOCATION: z.string().trim().min(1).optional(),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  })

export const env = keys()
