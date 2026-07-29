import type { Metadata } from "next"
import { PublicContentPage } from "@/features/marketing/public-content-page"
import { publicMetadata } from "@/lib/public-site"

export const metadata: Metadata = publicMetadata({ title: "عن وصال ون", description: "تعرف على وصال ون، منصة تشغيل محادثات الأعمال العربية.", path: "/about" })

export default function AboutPage() {
  return <PublicContentPage kind="about" />
}
