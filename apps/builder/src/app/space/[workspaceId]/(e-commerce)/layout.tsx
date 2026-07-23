import { notFound } from "next/navigation"
import { type ReactNode, Suspense } from "react"
import { withWorkspaceIdSchema } from "@/features/workspaces/schema/resource"
import { EcommerceTabs } from "./ecommerce-tabs"

export default async function ProductsPage({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>
  children: ReactNode
}) {
  const { data } = withWorkspaceIdSchema.safeParse(await params)
  if (!data) {
    return notFound()
  }

  return (
    <div className="space-y-4 p-6">
      <EcommerceTabs workspaceId={data.workspaceId} />

      <Suspense fallback={null}>{children}</Suspense>
    </div>
  )
}
