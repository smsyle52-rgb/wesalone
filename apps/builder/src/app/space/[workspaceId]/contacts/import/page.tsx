import { getIdFromParams } from "@chatbotx.io/utils"
import { notFound } from "next/navigation"
import { PaidPlanRequiredBanner } from "@/components/paid-plan-required-banner"
import { ImportContactsForm } from "@/features/contacts/import-contact-form"

import { ImportForm } from "@/features/import/components/import-form"
import { requireContactsAccess } from "@/lib/auth/require-workspace-permission"

export default async function ImportContactsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }
  await requireContactsAccess(workspaceId)

  return (
    <ImportForm>
      <PaidPlanRequiredBanner
        feature="contactImport"
        workspaceId={workspaceId}
      />
      <ImportContactsForm workspaceId={workspaceId} />
    </ImportForm>
  )
}
