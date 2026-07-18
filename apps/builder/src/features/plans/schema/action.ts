import { z } from "zod"

export const applySandboxPlanRequest = z.object({
  planSlug: z.enum(["free", "starter", "growth", "professional", "business"]),
})
export type ApplySandboxPlanRequest = z.infer<typeof applySandboxPlanRequest>
