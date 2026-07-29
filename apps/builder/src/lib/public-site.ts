import type { Metadata } from "next"

const publicUrl = "https://www.wesal.one"

export function publicMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  const url = `${publicUrl}${path}`
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", locale: "ar_SA", url, title: `${title} | وصال ون`, description, siteName: "وصال ون", images: [{ url: "/brand/icon_bg.svg", width: 512, height: 512, alt: "وصال ون" }] },
    twitter: { card: "summary", title: `${title} | وصال ون`, description, images: ["/brand/icon_bg.svg"] },
  }
}

export const PUBLIC_SITE_URL = publicUrl
