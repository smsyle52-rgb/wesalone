import type { Metadata } from "next"
import { PublicContentPage } from "@/features/marketing/public-content-page"
import { publicMetadata } from "@/lib/public-site"

export const metadata: Metadata = publicMetadata({ title: "سياسة الخصوصية", description: "سياسة خصوصية وصال ون.", path: "/privacy" })

export default function PrivacyPage() {
  return <PublicContentPage kind="privacy" />
}
