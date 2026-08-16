import type { MetadataRoute } from "next"

import { siteConfig } from "@/lib/site-config"

export const dynamic = "force-static"

const BASE = siteConfig.url

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${BASE}/sitemap.xml`,
  }
}
