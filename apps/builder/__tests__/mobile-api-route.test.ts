import { beforeEach, describe, expect, it, vi } from "vitest"

const handle = vi.fn()

vi.mock("@orpc/openapi/fetch", () => ({
  OpenAPIHandler: class {
    handle = handle
  },
}))
vi.mock("@orpc/json-schema", () => ({ SmartCoercionPlugin: class {} }))
vi.mock("@orpc/server/plugins", () => ({ ResponseHeadersPlugin: class {} }))
vi.mock("@orpc/zod/zod4", () => ({ ZodToJsonSchemaConverter: class {} }))
vi.mock("@orpc/server", () => ({ onError: vi.fn() }))
vi.mock("@/lib/orpc/handlers", () => ({
  createTimingInterceptor: vi.fn(),
  logUnexpectedOrpcErrorCallback: vi.fn(),
}))
vi.mock("@/routers", () => ({ router: {} }))
vi.mock("@/polyfill", () => ({}))

const { GET } = await import("@/app/api/mobile/[[...rest]]/route")

const URL_BASE = "https://wesal.one/api/mobile/users/me/workspaces"

describe("/api/mobile route", () => {
  beforeEach(() => {
    handle.mockReset()
    handle.mockResolvedValue({ response: new Response("ok") })
  })

  it("refuses a request without a bearer token", async () => {
    const response = await GET(
      new Request(URL_BASE, { headers: { cookie: "session=abc" } }),
    )

    expect(response.status).toBe(401)
    expect(handle).not.toHaveBeenCalled()
  })

  it("strips the cookie so only the bearer token authenticates", async () => {
    await GET(
      new Request(URL_BASE, {
        headers: { authorization: "Bearer tok", cookie: "session=abc" },
      }),
    )

    const [, options] = handle.mock.calls[0] ?? []
    expect(options.context.headers.get("cookie")).toBeNull()
    expect(options.context.headers.get("authorization")).toBe("Bearer tok")
    expect(options.prefix).toBe("/api/mobile")
  })

  it("returns 404 when no procedure matches", async () => {
    handle.mockResolvedValue({ response: undefined })

    const response = await GET(
      new Request(URL_BASE, { headers: { authorization: "Bearer tok" } }),
    )

    expect(response.status).toBe(404)
  })
})
