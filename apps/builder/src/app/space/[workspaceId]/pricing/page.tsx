import { WESAL_ONE_PLANS } from "@chatbotx.io/business"
import { getIdFromParams } from "@chatbotx.io/utils"
import { isPlatformSubscriptionPaymentsEnabled } from "@/env"
import { PricingView } from "@/features/plans/pricing-view"
import { listSubscriptionPaymentsForWorkspace } from "@/features/plans/queries"

export default async function PricingPage(props: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  const submissions = isPlatformSubscriptionPaymentsEnabled()
    ? await listSubscriptionPaymentsForWorkspace(workspaceId)
    : []

  return (
    <PricingView
      paymentsEnabled={isPlatformSubscriptionPaymentsEnabled()}
      plans={WESAL_ONE_PLANS}
      submissions={submissions}
      workspaceId={workspaceId}
    />
  )
}
