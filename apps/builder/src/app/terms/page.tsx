import type { Metadata } from "next"
import { PublicContentPage } from "@/features/marketing/public-content-page"
import { publicMetadata } from "@/lib/public-site"

export const metadata: Metadata = publicMetadata({ title: "شروط الاستخدام", description: "شروط استخدام وصال ون.", path: "/terms" })

export default function TermsPage() {
  return <PublicContentPage kind="terms" />
}
