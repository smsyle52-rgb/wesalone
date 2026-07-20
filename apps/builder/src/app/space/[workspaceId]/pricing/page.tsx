import {
  pointPurchaseOrderService,
  pointWalletService,
  WESAL_ONE_PLANS,
  workspaceService,
} from "@chatbotx.io/business"
import { getIdFromParams } from "@chatbotx.io/utils"
import {
  isPlatformSubscriptionPaymentsEnabled,
  isPointPurchasesEnabled,
} from "@/env"
import { PointPurchaseView } from "@/features/plans/point-purchase-view"
import { PointsUsageCard } from "@/features/plans/points-usage-card"
import { PricingView } from "@/features/plans/pricing-view"
import { listSubscriptionPaymentsForWorkspace } from "@/features/plans/queries"

export default async function PricingPage(props: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  const [submissions, workspace] = await Promise.all([
    isPlatformSubscriptionPaymentsEnabled()
      ? listSubscriptionPaymentsForWorkspace(workspaceId)
      : Promise.resolve([]),
    workspaceService.findById({ id: workspaceId }),
  ])
  const [balance, pointProducts, pointOrders] = await Promise.all([
    pointWalletService.getWalletBalance(workspace.ownerId),
    isPointPurchasesEnabled()
      ? pointPurchaseOrderService.listActiveProducts()
      : Promise.resolve([]),
    isPointPurchasesEnabled()
      ? pointPurchaseOrderService.listForUser(workspace.ownerId)
      : Promise.resolve([]),
  ])

  return (
    <div className="space-y-6">
      <PointsUsageCard balance={balance} />
      {isPointPurchasesEnabled() && (
        <PointPurchaseView
          orders={pointOrders}
          products={pointProducts}
          workspaceId={workspaceId}
        />
      )}
      <PricingView
        paymentsEnabled={isPlatformSubscriptionPaymentsEnabled()}
        plans={WESAL_ONE_PLANS}
        submissions={submissions}
        workspaceId={workspaceId}
      />
    </div>
  )
}
