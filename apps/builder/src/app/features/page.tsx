import type { Metadata } from "next"
import { PublicContentPage } from "@/features/marketing/public-content-page"
import { publicMetadata } from "@/lib/public-site"

export const metadata: Metadata = publicMetadata({ title: "مزايا وصال ون", description: "تعرّف على صندوق الوارد الموحد والأتمتة والذكاء الاصطناعي وإدارة العملاء في وصال ون.", path: "/features" })

export default function FeaturesPage() {
  return <PublicContentPage kind="features" />
}
