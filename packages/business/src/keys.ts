import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

export const keys = () =>
  createEnv({
    server: {
      NEXT_PUBLIC_EDITION: z
        .enum(["community", "enterprise", "cloud"])
        .default("community"),
      NEXT_PUBLIC_BUILDER_URL: z.url().default("http://localhost:3123"),
      PLATFORM_ADMIN_EMAIL: z.email().optional(),
      LICENSE_KEY: z.string().optional(),
      // How many AI tokens one visible point represents — see
      // point-wallet/service.ts. Configurable per environment without a
      // redeploy of the AI runtime itself.
      TOKENS_PER_POINT: z.coerce.number().int().min(1).default(1000),
      AI_POINTS_ENFORCEMENT_MODE: z
        .enum(["off", "shadow", "enforce"])
        .default("off"),
      AI_POINTS_RESERVATION_TTL_MINUTES: z.coerce
        .number()
        .int()
        .min(5)
        .max(1440)
        .default(30),
    },
    runtimeEnv: process.env,
  })

export const env = keys()

export const isCommunity = () => keys().NEXT_PUBLIC_EDITION === "community"
export const isEnterprise = () => keys().NEXT_PUBLIC_EDITION === "enterprise"
export const isCloud = () => keys().NEXT_PUBLIC_EDITION === "cloud"
