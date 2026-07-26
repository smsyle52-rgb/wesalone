import { createEnv } from "@t3-oss/env-core"
import z from "zod"

export const keys = () =>
  createEnv({
    server: {
      AI_INTEGRATION_CACHE_TTL_SECONDS: z.coerce.number().default(60 * 60),
      // Platform Vertex AI (internal provider — never a workspace BYOK key).
      // No default project id on purpose: an unset value must fail closed
      // (override disabled), never fall back to some hardcoded project.
      VERTEX_AI_PROJECT_ID: z.string().trim().min(1).optional(),
      VERTEX_AI_LOCATION: z.string().trim().min(1).optional(),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  })

export const env = keys()
