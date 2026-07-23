import { getIdFromParams } from "@chatbotx.io/utils"
import { OrderDetail } from "@/features/orders/order-detail"
import { getOrderDetail } from "@/features/orders/queries"

export default async function OrderDetailPage(props: {
  params: Promise<{ workspaceId: string; orderId: string }>
}) {
  const params = await props.params
  const workspaceId = getIdFromParams(params, "workspaceId")
  const orderId = getIdFromParams(params, "orderId")

  const { order, contact } = await getOrderDetail({ workspaceId, orderId })

  return (
    <OrderDetail contact={contact} order={order} workspaceId={workspaceId} />
  )
}
