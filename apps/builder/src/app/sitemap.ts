import type { MetadataRoute } from "next"

import { siteConfig } from "@/lib/site-config"

export const dynamic = "force-static"

const BASE = siteConfig.url

export default function sitemap(): MetadataRoute.Sitemap {
  // Only the real public surface. The marketing template that briefly added
  // /components, /themes, /blog and /changelog has been removed — listing them
  // here pointed Google at pages that no longer exist.
  return ["", "/privacy", "/terms", "/data-deletion"].map((path) => ({
    url: `${BASE}${path}`,
    changeFrequency: "weekly" as const,
    priority: path === "" ? 1 : 0.7,
  }))
}
