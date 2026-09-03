import { beforeEach, describe, expect, test, vi } from "vitest"

// ---------------------------------------------------------------------------
// The commerce tools are the whole reason a merchant's agent can quote a real
// price, so the properties worth pinning are the ones a wrong answer costs
// money on: a product the merchant hid must never be quoted, an ambiguous name
// must produce a question rather than a guess, and an order must be priced from
// the catalogue rather than from whatever the model typed.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listProducts: vi.fn(),
  listCategories: vi.fn(),
  createDraft: vi.fn(),
  addItem: vi.fn(),
  getOrderById: vi.fn(),
}))

vi.mock("@chatbotx.io/business", () => ({
  productService: { list: mocks.listProducts },
  productCategoryService: { list: mocks.listCategories },
  orderService: {
    createDraft: mocks.createDraft,
    addItem: mocks.addItem,
    getById: mocks.getOrderById,
  },
}))

const { commerceToolBuilders } = await import(
  "../src/server/tools/commerce-functions"
)

const context = {
  contactId: "contact-1",
  conversationId: "conversation-1",
  workspaceId: "workspace-1",
}

const options = { systemFunctionContextGetter: async () => context }

const product = (over: Record<string, unknown> = {}) => ({
  id: "product-1",
  name: "صابون فاس كلين",
  sku: "FAS-1",
  price: 1200,
  discount: 200,
  currency: "YER",
  shortDescription: null,
  category: "منظفات",
  subcategory: null,
  isActive: true,
  isSearchable: true,
  inventoryPolicy: "dont_track",
  inventoryQuantity: 0,
  allowOutOfStockPurchase: false,
  ...over,
})

const run = async (id: keyof typeof commerceToolBuilders, args: unknown) => {
  const built = commerceToolBuilders[id](options)
  const execute = built.execute as (input: unknown) => Promise<string>
  return await execute(args)
}

beforeEach(() => {
  mocks.listProducts.mockReset().mockResolvedValue({ data: [], pageCount: 1 })
  mocks.listCategories.mockReset().mockResolvedValue([])
  mocks.createDraft.mockReset().mockResolvedValue({ id: "order-9" })
  mocks.addItem.mockReset().mockResolvedValue(undefined)
  mocks.getOrderById.mockReset()
})

describe("search_products", () => {
  test("quotes the price net of the discount, in the product's own currency", async () => {
    mocks.listProducts.mockResolvedValue({ data: [product()], pageCount: 1 })

    const reply = await run("search_products", {})

    expect(reply).toContain("1000 YER")
  })

  test("never surfaces a product the merchant deactivated or hid", async () => {
    mocks.listProducts.mockResolvedValue({
      data: [
        product({ id: "p-hidden", name: "مخفي", isSearchable: false }),
        product({ id: "p-off", name: "موقوف", isActive: false }),
      ],
      pageCount: 1,
    })

    const reply = await run("search_products", {})

    expect(reply).not.toContain("مخفي")
    expect(reply).not.toContain("موقوف")
    expect(reply).toBe("The catalogue is empty.")
  })

  test("says so plainly instead of offering something else", async () => {
    const reply = await run("search_products", { query: "ثلاجة" })

    expect(reply).toContain("ثلاجة")
    expect(reply.toLowerCase()).toContain("nothing")
  })
})

describe("check_stock", () => {
  test("reports the tracked quantity rather than a bare yes", async () => {
    mocks.listProducts.mockResolvedValue({
      data: [product({ inventoryPolicy: "track", inventoryQuantity: 7 })],
      pageCount: 1,
    })

    const reply = await run("check_stock", { name: "صابون" })

    expect(reply).toContain("7 in stock")
  })

  test("calls a tracked product with nothing left out of stock", async () => {
    mocks.listProducts.mockResolvedValue({
      data: [product({ inventoryPolicy: "track", inventoryQuantity: 0 })],
      pageCount: 1,
    })

    const reply = await run("check_stock", { name: "صابون" })

    expect(reply).toContain("out of stock")
  })
})

describe("create_order", () => {
  test("asks which product instead of guessing between matches", async () => {
    mocks.listProducts.mockResolvedValue({
      data: [
        product({ id: "a", name: "صابون كبير" }),
        product({ id: "b", name: "صابون صغير" }),
      ],
      pageCount: 1,
    })

    const reply = await run("create_order", {
      items: [{ name: "صابون", quantity: 1 }],
    })

    expect(reply).toContain("Ask the customer which one")
    expect(mocks.createDraft).not.toHaveBeenCalled()
  })

  test("creates nothing when any line fails to resolve", async () => {
    mocks.listProducts.mockImplementation(({ name }: { name?: string }) =>
      Promise.resolve({
        data: name === "صابون" ? [product()] : [],
        pageCount: 1,
      }),
    )

    const reply = await run("create_order", {
      items: [
        { name: "صابون", quantity: 2 },
        { name: "ثلاجة", quantity: 1 },
      ],
    })

    expect(reply).toContain("ثلاجة")
    expect(mocks.createDraft).not.toHaveBeenCalled()
    expect(mocks.addItem).not.toHaveBeenCalled()
  })

  test("keys the draft on the conversation so a retry does not duplicate it", async () => {
    mocks.listProducts.mockResolvedValue({ data: [product()], pageCount: 1 })
    mocks.getOrderById.mockResolvedValue({
      id: "order-9",
      total: 2000,
      items: [],
    })

    await run("create_order", { items: [{ sku: "FAS-1", quantity: 2 }] })

    expect(mocks.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "agent:conversation-1" }),
    )
  })

  test("sends the product id and quantity only — the price is the catalogue's", async () => {
    mocks.listProducts.mockResolvedValue({ data: [product()], pageCount: 1 })
    mocks.getOrderById.mockResolvedValue({
      id: "order-9",
      total: 2000,
      items: [],
    })

    await run("create_order", { items: [{ sku: "FAS-1", quantity: 2 }] })

    expect(mocks.addItem).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      orderId: "order-9",
      productId: "product-1",
      quantity: 2,
    })
  })
})

describe("get_order_status", () => {
  test("refuses an order that belongs to another customer", async () => {
    mocks.getOrderById.mockResolvedValue({
      id: "order-9",
      status: "draft",
      total: 2000,
      contactId: "someone-else",
      items: [],
    })

    const reply = await run("get_order_status", { orderId: "order-9" })

    expect(reply).toContain("does not belong to this customer")
    expect(reply).not.toContain("2000")
  })

  test("reports status and contents for the customer's own order", async () => {
    mocks.getOrderById.mockResolvedValue({
      id: "order-9",
      status: "confirmed",
      total: 2000,
      contactId: "contact-1",
      items: [{ quantity: 2, product: { name: "صابون فاس كلين" } }],
    })

    const reply = await run("get_order_status", { orderId: "order-9" })

    expect(reply).toContain("confirmed")
    expect(reply).toContain("2 × صابون فاس كلين")
  })
})
