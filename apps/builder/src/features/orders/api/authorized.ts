import { orderService } from "@chatbotx.io/business"
import z from "zod"
import { decodeCursor } from "@/lib/pagination"
import { workspaceAuthorizedMidddleware } from "@/middlewares/auth"
import { authorizedAPI } from "@/orpc"
import {
  addOrderItemRequest,
  checkoutOrderRequest,
  checkoutOrderResponse,
  createDraftOrderRequest,
} from "../schema/action"
import {
  buildOrdersNextCursor,
  type ListOrdersCursorResponse,
  type ListOrdersResponse,
  listOrdersCursorRequest,
  listOrdersCursorResponse,
  listOrdersRequest,
  listOrdersResponse,
  orderCursorPositionSchema,
} from "../schema/query"
import {
  type OrderListItemResource,
  type OrderResource,
  orderResource,
} from "../schema/resource"
import { requireEcommercePermission } from "./require-ecommerce-permission"

export const ordersAuthorizedAPI = {
  createDraftOrderAPI: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/orders/drafts",
      summary: "Create a draft order",
      tags: ["Orders"],
    })
    .input(createDraftOrderRequest.and(z.object({ workspaceId: z.string() })))
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(orderResource)
    .handler(async ({ input, context }) => {
      await requireEcommercePermission({
        workspaceId: context.workspace.id,
        userId: context.user.id,
      })
      return (await orderService.createDraft({
        workspaceId: context.workspace.id,
        contactId: input.contactId,
        idempotencyKey: input.idempotencyKey,
      })) as OrderResource
    }),

  addOrderItemAPI: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/orders/{orderId}/items",
      summary: "Add an item to a draft order",
      tags: ["Orders"],
    })
    .input(
      addOrderItemRequest.and(
        z.object({ workspaceId: z.string(), orderId: z.string() }),
      ),
    )
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(orderResource)
    .handler(async ({ input, context }) => {
      await requireEcommercePermission({
        workspaceId: context.workspace.id,
        userId: context.user.id,
      })
      return (await orderService.addItem({
        workspaceId: context.workspace.id,
        orderId: input.orderId,
        productId: input.productId,
        productVariantId: input.productVariantId,
        quantity: input.quantity,
      })) as OrderResource
    }),

  removeOrderItemAPI: authorizedAPI
    .route({
      method: "DELETE",
      path: "/workspaces/{workspaceId}/orders/{orderId}/items/{itemId}",
      summary: "Remove an item from a draft order",
      tags: ["Orders"],
    })
    .input(
      z.object({
        workspaceId: z.string(),
        orderId: z.string(),
        itemId: z.string(),
      }),
    )
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(orderResource)
    .handler(async ({ input, context }) => {
      await requireEcommercePermission({
        workspaceId: context.workspace.id,
        userId: context.user.id,
      })
      return (await orderService.removeItem({
        workspaceId: context.workspace.id,
        orderId: input.orderId,
        itemId: input.itemId,
      })) as OrderResource
    }),

  getOrderAPI: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/orders/{orderId}",
      summary: "Get an order",
      tags: ["Orders"],
    })
    .input(z.object({ workspaceId: z.string(), orderId: z.string() }))
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(orderResource)
    .handler(async ({ input, context }) => {
      await requireEcommercePermission({
        workspaceId: context.workspace.id,
        userId: context.user.id,
      })
      return (await orderService.getById({
        workspaceId: context.workspace.id,
        orderId: input.orderId,
      })) as OrderResource
    }),

  checkoutOrderAPI: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/orders/{orderId}/checkout",
      summary: "Check out a draft order (reserves stock, opens a payment)",
      tags: ["Orders"],
    })
    .input(
      checkoutOrderRequest.and(
        z.object({ workspaceId: z.string(), orderId: z.string() }),
      ),
    )
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(checkoutOrderResponse)
    .handler(async ({ input, context }) => {
      await requireEcommercePermission({
        workspaceId: context.workspace.id,
        userId: context.user.id,
      })
      const result = await orderService.checkout({
        workspaceId: context.workspace.id,
        orderId: input.orderId,
        provider: input.provider,
        idempotencyKey: input.idempotencyKey,
      })
      return {
        orderId: result.order.id,
        status: result.order.status,
        checkoutReference: result.checkoutReference,
        redirectUrl: result.redirectUrl,
      }
    }),

  listOrdersAPI: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/orders",
      summary: "List orders (read-only; includes payment_review)",
      tags: ["Orders"],
    })
    .input(listOrdersRequest.and(z.object({ workspaceId: z.string() })))
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(listOrdersResponse)
    .handler(async ({ input, context }) => {
      await requireEcommercePermission({
        workspaceId: context.workspace.id,
        userId: context.user.id,
      })
      return (await orderService.list({
        workspaceId: context.workspace.id,
        status: input.status,
        contactId: input.contactId,
        page: input.page,
        perPage: input.perPage,
      })) as ListOrdersResponse
    }),

  listOrdersCursorAPI: authorizedAPI
    .route({
      method: "GET",
      // Deliberately not nested under /orders/{orderId} (e.g. /orders/cursor)
      // to avoid any ambiguity with the getOrderAPI path pattern above.
      path: "/workspaces/{workspaceId}/orders-cursor",
      summary:
        "List orders, cursor-paginated (read-only; powers the admin Orders table)",
      tags: ["Orders"],
    })
    .input(listOrdersCursorRequest.and(z.object({ workspaceId: z.string() })))
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(listOrdersCursorResponse)
    .handler(async ({ input, context }) => {
      await requireEcommercePermission({
        workspaceId: context.workspace.id,
        userId: context.user.id,
      })

      const after = input.cursor
        ? decodeCursor(input.cursor, orderCursorPositionSchema)
        : null
      const { data, hasMore } = await orderService.listCursor({
        workspaceId: context.workspace.id,
        status: input.status,
        customerKeyword: input.customerKeyword,
        after: after ?? undefined,
        perPage: input.perPage,
      })

      return {
        data: data as OrderListItemResource[],
        nextCursor: buildOrdersNextCursor(data, hasMore),
      } satisfies ListOrdersCursorResponse
    }),
}
