import type { ReactNode } from "react"
import { VeloraLayout } from "@/features/marketing/velora-layout"

export default function Layout({ children }: { children: ReactNode }) {
  return <VeloraLayout>{children}</VeloraLayout>
}
