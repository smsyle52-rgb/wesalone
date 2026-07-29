import type { Metadata } from "next"
import { PublicContentPage } from "@/features/marketing/public-content-page"
import { publicMetadata } from "@/lib/public-site"

export const metadata: Metadata = publicMetadata({ title: "القنوات المتاحة", description: "اربط قنوات أعمالك المدعومة وأدر محادثاتها من وصال ون.", path: "/channels" })

export default function ChannelsPage() {
  return <PublicContentPage kind="channels" />
}
