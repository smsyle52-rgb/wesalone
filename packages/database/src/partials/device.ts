import { z } from "zod"

export const devicePlatformTypes = z.enum(["ios", "android", "web"])
export type DevicePlatformType = z.infer<typeof devicePlatformTypes>
