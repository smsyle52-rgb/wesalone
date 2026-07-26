import z from "zod"

// Fixed to "vertex" today. Kept as an enum (not a literal) so a future
// platform-wide provider change is a value addition, not a schema rewrite.
export const platformAiProviders = z.enum(["vertex"])
export type PlatformAiProvider = z.infer<typeof platformAiProviders>
