import type { Metadata } from "next"
import { PublicContentPage } from "@/features/marketing/public-content-page"
import { publicMetadata } from "@/lib/public-site"

export const metadata: Metadata = publicMetadata({ title: "حذف البيانات", description: "طلب حذف بيانات وصال ون.", path: "/data-deletion" })

export default function DataDeletionPage() {
  return <PublicContentPage kind="dataDeletion" />
}
