import type { MetadataRoute } from "next"
import { PUBLIC_SITE_URL } from "@/lib/public-site"

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/features", "/channels", "/pricing", "/about", "/contact", "/faq", "/privacy", "/terms", "/data-deletion"].map((path) => ({ url: `${PUBLIC_SITE_URL}${path}`, lastModified: new Date(), changeFrequency: path === "" ? "weekly" : "monthly", priority: path === "" ? 1 : 0.7 }))
}
