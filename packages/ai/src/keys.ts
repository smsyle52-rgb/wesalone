import { createEnv } from "@t3-oss/env-core"
import z from "zod"

/** A Google Cloud project number is digits only. */
const WIF_PROJECT_NUMBER = /^\d+$/

export const keys = () =>
  createEnv({
    server: {
      AI_INTEGRATION_CACHE_TTL_SECONDS: z.coerce.number().default(60 * 60),
      // Azure OpenAI is the platform provider. These remain optional so an
      // incomplete deployment fails closed to workspace providers.
      // Which platform chat provider answers first. `azureOpenAI` puts the
      // Azure OpenAI deployment ahead of Vertex (which stays as the fallback) —
      // the switch for a Vertex outage or billing suspension, without touching
      // the admin AI settings.
      PLATFORM_AI_CHAT_PRIMARY: z
        .enum(["vertex", "azureOpenAI"])
        .optional()
        .default("vertex"),
      AZURE_OPENAI_ENDPOINT: z.url().optional(),
      AZURE_OPENAI_API_KEY: z.string().trim().min(1).optional(),
      AZURE_OPENAI_LOCATION: z.string().trim().min(1).optional(),
      AZURE_OPENAI_CHAT_DEPLOYMENT: z.string().trim().min(1).optional(),
      AZURE_OPENAI_EMBEDDING_DEPLOYMENT: z.string().trim().min(1).optional(),
      // Reasoning effort for the platform chat deployment when it is a
      // reasoning model (gpt-5 family). Unset leaves the model default, which
      // for gpt-5-mini is `medium` — too slow for a chat reply.
      AZURE_OPENAI_CHAT_REASONING_EFFORT: z
        .enum(["minimal", "low", "medium", "high"])
        .optional(),
      // Optional first-choice platform chat model hosted on an Azure AI
      // Foundry resource (a non-OpenAI model such as Meta's Muse Spark). All
      // four must be set; when its quota is exhausted the reply falls through
      // to the remaining platform candidates.
      AZURE_FOUNDRY_CHAT_ENDPOINT: z.url().optional(),
      AZURE_FOUNDRY_CHAT_API_KEY: z.string().trim().min(1).optional(),
      AZURE_FOUNDRY_CHAT_DEPLOYMENT: z.string().trim().min(1).optional(),
      AZURE_FOUNDRY_CHAT_MODEL: z.string().trim().min(1).optional(),
      // Optional second Foundry model on the same resource, tried right after
      // the first one and before the remaining platform candidates.
      AZURE_FOUNDRY_CHAT_FALLBACK_DEPLOYMENT: z
        .string()
        .trim()
        .min(1)
        .optional(),
      AZURE_FOUNDRY_CHAT_FALLBACK_MODEL: z.string().trim().min(1).optional(),
      // Vertex AI authenticates with Azure Managed Identity through Google
      // Workload Identity Federation. None of these values is a credential.
      VERTEX_AI_PROJECT_ID: z.string().trim().min(1).optional(),
      VERTEX_AI_LOCATION: z.string().trim().min(1).optional(),
      VERTEX_AI_WIF_PROJECT_NUMBER: z
        .string()
        .trim()
        .regex(WIF_PROJECT_NUMBER)
        .optional(),
      VERTEX_AI_WIF_POOL_ID: z.string().trim().min(1).optional(),
      VERTEX_AI_WIF_PROVIDER_ID: z.string().trim().min(1).optional(),
      VERTEX_AI_AZURE_AUDIENCE: z.string().trim().min(1).optional(),
      AZURE_MANAGED_IDENTITY_CLIENT_ID: z.string().uuid().optional(),
      // Azure Container Apps injects these on each replica; the header is a
      // short-lived local proof and is never configured or stored by Wesal.
      IDENTITY_ENDPOINT: z.string().url().optional(),
      IDENTITY_HEADER: z.string().trim().min(1).optional(),
      // AWS EC2 alternative to the Azure managed identity above: the
      // instance's own IAM role is the federated subject, so there is still no
      // Google key stored anywhere. Set VERTEX_AI_WIF_SOURCE=aws to use it.
      VERTEX_AI_WIF_SOURCE: z.enum(["azure", "aws"]).optional(),
      AWS_REGION: z.string().trim().min(1).optional(),
      // Gemini 3.x thinking level for platform Vertex language models. `low` is
      // the measured default; `default` restores the model's dynamic thinking.
      // Vertex embedding model (e.g. gemini-embedding-001) replacing Azure
      // OpenAI for knowledge-base vectors. Unset keeps the Azure deployment.
      VERTEX_AI_EMBEDDING_MODEL: z.string().trim().min(1).optional(),
      VERTEX_AI_EMBEDDING_LOCATION: z.string().trim().min(1).optional(),
      VERTEX_AI_THINKING_LEVEL: z
        .enum(["minimal", "low", "medium", "high", "default"])
        .optional(),
      GOOGLE_DOCUMENT_AI_PROCESSOR_ID: z.string().trim().min(1).optional(),
      GOOGLE_DOCUMENT_AI_LOCATION: z.string().trim().min(1).optional(),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  })

export const env = keys()
