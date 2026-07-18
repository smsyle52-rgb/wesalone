import { paymentService } from "@chatbotx.io/business"
import { ChatbotXException } from "@chatbotx.io/business/errors"
import type { NextRequest } from "next/server"
import { logger } from "@/lib/log"

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024
const PROVIDER_NAME = /^[a-z0-9_-]{1,64}$/

// Deliberately NOT an oRPC procedure: signature verification needs the exact
// raw request bytes, and this must stay reachable without a session (the
// payment gateway calling in has no cookies). `/api` is already a public
// route in proxy.ts; this handler is its own auth boundary via the provider
// adapter's signature check — see packages/business/src/payment/provider.ts.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params
  if (!PROVIDER_NAME.test(provider)) {
    return Response.json({ received: false }, { status: 400 })
  }
  const declaredLength = Number(req.headers.get("content-length") ?? "0")
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return Response.json({ received: false }, { status: 413 })
  }
  const rawBody = await req.text()
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return Response.json({ received: false }, { status: 413 })
  }
  // biome-ignore lint/suspicious/noExplicitAny: Headers iterator typing gap, same workaround as proxy.ts's _logRequest
  const headers = Object.fromEntries(req.headers as any)

  try {
    const result = await paymentService.confirmFromWebhook({
      provider,
      rawBody,
      headers,
    })
    return Response.json({ received: true, ...result })
  } catch (error) {
    const status =
      error instanceof ChatbotXException ? error.httpStatusCode : 400
    logger.error({ err: error, provider }, "[payment webhook] rejected")
    return Response.json({ received: false }, { status })
  }
}
