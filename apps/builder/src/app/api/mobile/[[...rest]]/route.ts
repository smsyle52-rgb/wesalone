import { SmartCoercionPlugin } from "@orpc/json-schema"
import { OpenAPIHandler } from "@orpc/openapi/fetch"
import { onError } from "@orpc/server"
import { ResponseHeadersPlugin } from "@orpc/server/plugins"
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4"
import {
  createTimingInterceptor,
  logUnexpectedOrpcErrorCallback,
} from "@/lib/orpc/handlers"
import { router } from "@/routers"
import "@/polyfill"

const LOG_LABEL = "Mobile OpenAPI handler"

// REST surface for the Wesal One mobile app (chatbotx-mobile-app), which calls
// the session-authed procedures (`/workspaces/{workspaceId}/...`) over REST
// with a better-auth bearer token. `/api` serves only `publicRouter`, so the
// app gets the full router here instead.
//
// Bearer-only on purpose: the Cookie header is stripped before the router
// sees the request, so a browser can never reach this surface with an ambient
// session cookie (no CSRF), and a request without `Authorization: Bearer` is
// refused outright. No docs/spec plugin, so the private spec is not published.
const openAPIHandler = new OpenAPIHandler(router, {
  interceptors: [
    createTimingInterceptor(LOG_LABEL),
    onError(logUnexpectedOrpcErrorCallback(LOG_LABEL)),
  ],
  plugins: [
    new SmartCoercionPlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
    new ResponseHeadersPlugin(),
  ],
})

const BEARER_PATTERN = /^Bearer\s+\S+/i

async function handleRequest(request: Request) {
  if (!BEARER_PATTERN.test(request.headers.get("authorization") ?? "")) {
    return Response.json(
      { code: "UNAUTHORIZED", message: "Bearer token required" },
      { status: 401 },
    )
  }

  const headers = new Headers(request.headers)
  headers.delete("cookie")
  const bearerOnlyRequest = new Request(request, { headers })

  const { response } = await openAPIHandler.handle(bearerOnlyRequest, {
    prefix: "/api/mobile",
    context: { headers, url: request.url },
  })
  return response ?? new Response("Not found", { status: 404 })
}

export const GET = handleRequest
export const POST = handleRequest
export const PUT = handleRequest
export const PATCH = handleRequest
export const DELETE = handleRequest
