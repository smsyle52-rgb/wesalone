import type { Metadata } from "next"
import { PublicPricing } from "@/features/marketing/public-pricing"
import { publicMetadata } from "@/lib/public-site"

export const metadata: Metadata = publicMetadata({ title: "باقات وأسعار وصال ون", description: "قارن باقات وصال ون وحدود القنوات والفريق والنقاط الشهرية.", path: "/pricing" })

export default function PricingPage() {
  return <PublicPricing />
}
