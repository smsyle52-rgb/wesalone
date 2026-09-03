import {
  orderService,
  productCategoryService,
  productService,
} from "@chatbotx.io/business"
import { type ToolSet, tool } from "ai"
import { z } from "zod"
import { systemFunctionNames } from "../../constants"
import { logger } from "../../logger"
import type { SystemFunctionContext } from "./system-functions"

/**
 * Commerce tools every workspace gets, with no server and no token.
 *
 * The catalogue used to reach the agent one of two ways: pasted into its
 * instructions, which silently stops being true the moment a price changes,
 * or through the `wesal-mcp-commerce` container, which only answers a workspace
 * whose token was hand-added to `WORKSPACE_TOKENS` and the container restarted.
 * That made live product data an administrative favour rather than a feature —
 * three workspaces had it and the rest did not.
 *
 * These read the same tables through the same services the dashboard uses, so
 * they need no provisioning at all: the agent's tool picker builds itself from
 * `systemFunctionCatalog`, so ticking a box is the whole setup. The MCP server
 * stays for callers outside this deployment.
 *
 * Two product columns decide what the agent may see, and both already existed:
 * `isActive` (sellable at all) and `isSearchable` (may be surfaced). A merchant
 * who unticks either has already said no, and these tools honour that.
 */

/** Keeps a reply short enough to send on WhatsApp without truncation. */
const MAX_SEARCH_RESULTS = 8
const MAX_ORDER_LINES = 20
const MAX_LINE_QUANTITY = 10_000
/**
 * How much of the catalogue one lookup reads. The repository paginates, and
 * its default page is small enough that a merchant with a few hundred products
 * would have had the agent deny stock it actually holds.
 */
const MAX_CATALOGUE_SCAN = 500

export const searchProductsSchema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      "Words from the product name, as the customer said them. Omit to list what is available.",
    ),
  category: z
    .string()
    .optional()
    .describe("Restrict to this category name, exactly as list_categories returns it."),
})

export const getProductSchema = z.object({
  sku: z.string().optional().describe("The product's SKU, if the customer gave one."),
  name: z.string().optional().describe("The product name, when there is no SKU."),
})

export const checkStockSchema = z.object({
  sku: z.string().optional().describe("The product's SKU."),
  name: z.string().optional().describe("The product name, when there is no SKU."),
})

export const listCategoriesSchema = z.object({})

export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        sku: z
          .string()
          .optional()
          .describe("The SKU of the product being ordered."),
        name: z
          .string()
          .optional()
          .describe("The product name, when there is no SKU."),
        quantity: z.number().int().positive().describe("How many units."),
      }),
    )
    .min(1)
    .describe(
      "What the customer asked for. Never invent a price — the order is priced from the catalogue.",
    ),
})

export const getOrderStatusSchema = z.object({
  orderId: z.string().describe("The order number given to the customer."),
})

export type SearchProductsInput = z.infer<typeof searchProductsSchema>
export type GetProductInput = z.infer<typeof getProductSchema>
export type CheckStockInput = z.infer<typeof checkStockSchema>
export type CreateOrderInput = z.infer<typeof createOrderSchema>
export type GetOrderStatusInput = z.infer<typeof getOrderStatusSchema>

type ProductRow = {
  id: string
  name: string
  sku: string | null
  price: number
  discount: number
  currency: string
  shortDescription: string | null
  category: string | null
  subcategory: string | null
  isActive: boolean
  isSearchable: boolean
  inventoryPolicy: string
  inventoryQuantity: number
  allowOutOfStockPurchase: boolean
}

/**
 * The catalogue the agent is allowed to talk about.
 *
 * `list` cannot filter on `isSearchable`, so the gate is applied here rather
 * than by widening the repository: this is the only caller that needs it, and
 * a filter on the dashboard's own listing would hide rows the merchant is
 * editing.
 */
async function visibleProducts(
  workspaceId: string,
  input: { name?: string; categoryId?: string },
): Promise<ProductRow[]> {
  const { data } = await productService.list({
    workspaceId,
    name: input.name,
    categoryId: input.categoryId,
    page: 1,
    perPage: MAX_CATALOGUE_SCAN,
  })

  return (data as unknown as ProductRow[]).filter(
    (product) => product.isActive && product.isSearchable,
  )
}

function priceOf(product: ProductRow): string {
  const net = Math.max(product.price - product.discount, 0)
  return `${net} ${product.currency}`
}

function availabilityOf(product: ProductRow): string {
  if (product.inventoryPolicy === "dont_track") {
    return "available"
  }
  if (product.inventoryQuantity > 0) {
    return `${product.inventoryQuantity} in stock`
  }
  return product.allowOutOfStockPurchase ? "available to order" : "out of stock"
}

function describe(product: ProductRow): string {
  const parts = [
    product.name,
    product.sku ? `SKU ${product.sku}` : null,
    priceOf(product),
    availabilityOf(product),
    product.category,
  ].filter(Boolean)
  return parts.join(" — ")
}

/**
 * Resolve one product from whatever the customer said.
 *
 * An exact SKU wins; otherwise the name has to match exactly one row, because
 * answering "which of these three did you mean" is the agent's job and quietly
 * picking the first is how a customer ends up ordering the wrong size.
 */
async function resolveOne(
  workspaceId: string,
  ref: { sku?: string; name?: string },
): Promise<{ product: ProductRow } | { error: string }> {
  if (!(ref.sku || ref.name)) {
    return { error: "Give either a SKU or a product name." }
  }

  const candidates = await visibleProducts(workspaceId, { name: ref.name })

  if (ref.sku) {
    const bySku = (
      await visibleProducts(workspaceId, {})
    ).filter((product) => product.sku?.toLowerCase() === ref.sku?.toLowerCase())
    if (bySku.length === 1) {
      return { product: bySku[0] as ProductRow }
    }
    if (bySku.length === 0 && !ref.name) {
      return { error: `No product with SKU ${ref.sku}.` }
    }
  }

  if (candidates.length === 1) {
    return { product: candidates[0] as ProductRow }
  }
  if (candidates.length === 0) {
    return { error: `Nothing in the catalogue matches "${ref.name ?? ref.sku}".` }
  }
  return {
    error: `Several products match "${ref.name}": ${candidates
      .slice(0, MAX_SEARCH_RESULTS)
      .map((product) => product.name)
      .join(", ")}. Ask the customer which one.`,
  }
}

type Builder = (options: {
  systemFunctionContextGetter?: () => Promise<SystemFunctionContext | null>
}) => ToolSet[string]

const requireContext = async (options: {
  systemFunctionContextGetter?: () => Promise<SystemFunctionContext | null>
}): Promise<SystemFunctionContext | null> =>
  (await options.systemFunctionContextGetter?.()) ?? null

const buildSearchProducts: Builder = (options) =>
  tool({
    description:
      "Search this workspace's product catalogue by name or category and return each match with its current price and availability. Prices come from the catalogue, never from memory.",
    inputSchema: searchProductsSchema,
    execute: async (args: SearchProductsInput) => {
      const context = await requireContext(options)
      if (!context) {
        return "The catalogue is unavailable right now."
      }

      let categoryId: string | undefined
      if (args.category) {
        const categories = await productCategoryService.list(
          context.workspaceId,
        )
        categoryId = (
          categories as unknown as Array<{ id: string; name: string }>
        ).find(
          (category) =>
            category.name.toLowerCase() === args.category?.toLowerCase(),
        )?.id
        if (!categoryId) {
          return `There is no category called "${args.category}".`
        }
      }

      const products = await visibleProducts(context.workspaceId, {
        name: args.query,
        categoryId,
      })

      if (products.length === 0) {
        return args.query
          ? `Nothing in the catalogue matches "${args.query}".`
          : "The catalogue is empty."
      }

      const shown = products.slice(0, MAX_SEARCH_RESULTS)
      const more =
        products.length > shown.length
          ? `\n(+${products.length - shown.length} more — narrow the search.)`
          : ""
      return shown.map(describe).join("\n") + more
    },
  })

const buildGetProduct: Builder = (options) =>
  tool({
    description:
      "Look up one product by SKU or exact name and return its price, availability and description.",
    inputSchema: getProductSchema,
    execute: async (args: GetProductInput) => {
      const context = await requireContext(options)
      if (!context) {
        return "The catalogue is unavailable right now."
      }
      const resolved = await resolveOne(context.workspaceId, args)
      if ("error" in resolved) {
        return resolved.error
      }
      const { product } = resolved
      return [
        describe(product),
        product.shortDescription,
        product.subcategory ? `Subcategory: ${product.subcategory}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    },
  })

const buildCheckStock: Builder = (options) =>
  tool({
    description:
      "Report how many units of one product are available before promising a customer anything.",
    inputSchema: checkStockSchema,
    execute: async (args: CheckStockInput) => {
      const context = await requireContext(options)
      if (!context) {
        return "Stock is unavailable right now."
      }
      const resolved = await resolveOne(context.workspaceId, args)
      if ("error" in resolved) {
        return resolved.error
      }
      const { product } = resolved
      return `${product.name}: ${availabilityOf(product)}`
    },
  })

const buildListCategories: Builder = (options) =>
  tool({
    description:
      "List the categories this workspace sells in, to steer a customer who does not know what to ask for.",
    inputSchema: listCategoriesSchema,
    execute: async () => {
      const context = await requireContext(options)
      if (!context) {
        return "The catalogue is unavailable right now."
      }
      const categories = (await productCategoryService.list(
        context.workspaceId,
      )) as unknown as Array<{ name: string }>
      if (categories.length === 0) {
        return "This catalogue has no categories."
      }
      return categories.map((category) => category.name).join(", ")
    },
  })

const buildCreateOrder: Builder = (options) =>
  tool({
    description:
      "Record what the customer wants to buy as a draft order for the merchant to confirm. Prices and totals are taken from the catalogue, so never state a total of your own. Tell the customer the order number this returns.",
    inputSchema: createOrderSchema,
    execute: async (args: CreateOrderInput) => {
      const context = await requireContext(options)
      if (!context) {
        return "Orders cannot be recorded right now."
      }
      if (args.items.length > MAX_ORDER_LINES) {
        return `An order can hold at most ${MAX_ORDER_LINES} lines.`
      }

      // Resolve every line BEFORE creating the order: a draft with half its
      // lines is worse than none, because the merchant sees an order the
      // customer never agreed to.
      const lines: Array<{ product: ProductRow; quantity: number }> = []
      for (const item of args.items) {
        if (item.quantity > MAX_LINE_QUANTITY) {
          return `${item.sku ?? item.name}: ${item.quantity} is not a plausible quantity.`
        }
        const resolved = await resolveOne(context.workspaceId, item)
        if ("error" in resolved) {
          return resolved.error
        }
        lines.push({ product: resolved.product, quantity: item.quantity })
      }

      try {
        // Keyed on the conversation so a retried tool call re-uses the same
        // draft instead of leaving the merchant two orders for one request.
        const order = await orderService.createDraft({
          workspaceId: context.workspaceId,
          contactId: context.contactId,
          idempotencyKey: `agent:${context.conversationId}`,
        })

        for (const line of lines) {
          await orderService.addItem({
            workspaceId: context.workspaceId,
            orderId: order.id,
            productId: line.product.id,
            quantity: line.quantity,
          })
        }

        const detail = await orderService.getById({
          workspaceId: context.workspaceId,
          orderId: order.id,
        })

        const summary = lines
          .map((line) => `${line.quantity} × ${line.product.name}`)
          .join(", ")
        return `Draft order ${order.id} recorded for this customer: ${summary}. Total ${detail.total} ${lines[0]?.product.currency ?? ""}. The merchant confirms it before anything ships.`
      } catch (error) {
        logger.error(
          { error, workspaceId: context.workspaceId },
          "[ai-package] create_order failed",
        )
        return "The order could not be recorded. Tell the customer someone will follow up."
      }
    },
  })

const buildGetOrderStatus: Builder = (options) =>
  tool({
    description:
      "Look up an order the customer already placed, by its order number, and report its status and contents.",
    inputSchema: getOrderStatusSchema,
    execute: async (args: GetOrderStatusInput) => {
      const context = await requireContext(options)
      if (!context) {
        return "Orders cannot be looked up right now."
      }
      try {
        const order = await orderService.getById({
          workspaceId: context.workspaceId,
          orderId: args.orderId,
        })
        // An order id alone is enough to read someone else's order if the
        // lookup is not tied to the person asking, so it is.
        if (order.contactId && order.contactId !== context.contactId) {
          return `Order ${args.orderId} does not belong to this customer.`
        }
        const items = order.items
          .map(
            (item) =>
              `${item.quantity} × ${item.product?.name ?? "item"}`,
          )
          .join(", ")
        return `Order ${order.id}: ${order.status}. ${items}. Total ${order.total}.`
      } catch {
        return `No order numbered ${args.orderId} for this customer.`
      }
    },
  })

export const commerceToolBuilders = {
  [systemFunctionNames.searchProducts]: buildSearchProducts,
  [systemFunctionNames.getProduct]: buildGetProduct,
  [systemFunctionNames.checkStock]: buildCheckStock,
  [systemFunctionNames.listCategories]: buildListCategories,
  [systemFunctionNames.createOrder]: buildCreateOrder,
  [systemFunctionNames.getOrderStatus]: buildGetOrderStatus,
} as const
