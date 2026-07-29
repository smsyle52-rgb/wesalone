import type { Metadata } from "next"
import { PublicContentPage } from "@/features/marketing/public-content-page"
import { publicMetadata } from "@/lib/public-site"

export const metadata: Metadata = publicMetadata({ title: "تواصل مع وصال ون", description: "تواصل مع فريق وصال ون للاستفسارات والمساعدة.", path: "/contact" })

export default function ContactPage() {
  return <PublicContentPage kind="contact" />
}
