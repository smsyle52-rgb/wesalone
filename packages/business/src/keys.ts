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
      // Scheduled switch to enforcement: with the mode at `shadow` and this
      // set, points start being enforced at this instant (ISO 8601). Before
      // it, merchants who would be stopped get one advance warning. Lets a
      // grace period end on time without anyone redeploying at midnight.
      AI_POINTS_ENFORCE_FROM: z.iso.datetime({ offset: true }).optional(),
      AI_POINTS_RESERVATION_TTL_MINUTES: z.coerce
        .number()
        .int()
        .min(5)
        .max(1440)
        .default(30),
      LICENSE_REFRESH_URL: z
        .url()
        .default("https://chatbotx.io/api/licenses/refresh"),
      LICENSE_REFRESH_ENABLED: z.stringbool().default(true),
      SUPPORT_ACCESS_REQUIRE_CONSENT: z.stringbool().default(true),
    },
    runtimeEnv: process.env,
  })

export const env = keys()

export const isCommunity = () => keys().NEXT_PUBLIC_EDITION === "community"
export const isEnterprise = () => keys().NEXT_PUBLIC_EDITION === "enterprise"
export const isCloud = () => keys().NEXT_PUBLIC_EDITION === "cloud"
