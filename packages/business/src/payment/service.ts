import {
  and,
  db,
  eq,
  isUniqueViolationError,
} from "@chatbotx.io/database/client"
import {
  paymentModel,
  paymentWebhookEventModel,
} from "@chatbotx.io/database/schema"
import { createId } from "@chatbotx.io/utils"
import { BaseService } from "../base.service"
import {
  ChatbotXException,
  invalidWebhookSignatureException,
  paymentMismatchException,
} from "../errors"
import { logger } from "../logger"
import { orderService } from "../order/service"
import { getPaymentProvider } from "./registry"

const roundMoney = (value: number) => Math.round(value * 100) / 100

export type ConfirmWebhookResult = {
  status: "ok" | "ignored"
  reason?: string
}

class PaymentService extends BaseService {
  /**
   * The only entry point for moving a Payment (and its Order) to "paid".
   * Never callable by anything other than a verified provider webhook —
   * there is deliberately no "confirm payment" method reachable from the
   * authenticated dashboard/agent API surface.
   */
  async confirmFromWebhook(props: {
    provider: string
    rawBody: string
    headers: Record<string, string | undefined>
  }): Promise<ConfirmWebhookResult> {
    const { provider, rawBody, headers } = props
    const adapter = getPaymentProvider(provider)

    const verified = await adapter.verifyAndParseWebhook({ rawBody, headers })
    if (!verified.valid) {
      logger.warn(
        { provider, reason: verified.reason },
        "[payment webhook] rejected: signature verification failed",
      )
      throw invalidWebhookSignatureException()
    }

    const { event } = verified

    return await db.transaction(async (tx) => {
      // Replay guard: (provider, providerEventId) is globally unique. A
      // second delivery of the same event hits the unique violation below
      // and is ignored before it can touch Payment/Order state at all.
      let webhookEventId: string
      try {
        const [inserted] = await tx
          .insert(paymentWebhookEventModel)
          .values({
            id: createId(),
            provider,
            providerEventId: event.providerEventId,
            // Sanitized summary only — never the raw body, headers, or secret.
            payloadSummary: {
              status: event.status,
              amount: event.amount,
              currency: event.currency,
              checkoutReference: event.checkoutReference ?? null,
            },
          })
          .returning()
        if (!inserted) {
          throw new ChatbotXException("Failed to record webhook event")
        }
        webhookEventId = inserted.id
      } catch (error) {
        if (isUniqueViolationError(error)) {
          logger.info(
            { provider, providerEventId: event.providerEventId },
            "[payment webhook] duplicate event ignored",
          )
          return { status: "ignored", reason: "duplicate_event" }
        }
        throw error
      }

      const payment = event.checkoutReference
        ? await tx.query.paymentModel.findFirst({
            where: { checkoutReference: event.checkoutReference, provider },
          })
        : undefined

      if (!payment) {
        logger.warn(
          { provider, checkoutReference: event.checkoutReference },
          "[payment webhook] no matching payment for checkoutReference",
        )
        return { status: "ignored", reason: "payment_not_found" }
      }

      await tx
        .update(paymentWebhookEventModel)
        .set({ paymentId: payment.id, workspaceId: payment.workspaceId })
        .where(eq(paymentWebhookEventModel.id, webhookEventId))

      if (payment.amount !== roundMoney(event.amount)) {
        throw paymentMismatchException(
          "Webhook amount does not match the order's payment amount",
        )
      }
      if (payment.currency.toLowerCase() !== event.currency.toLowerCase()) {
        throw paymentMismatchException(
          "Webhook currency does not match the order's payment currency",
        )
      }

      if (event.status === "failed") {
        if (payment.status !== "pending") {
          return { status: "ignored", reason: "payment_not_pending" }
        }
        const [failed] = await tx
          .update(paymentModel)
          .set({
            status: "failed",
            providerPaymentReference: event.providerPaymentReference,
            failureReason: "Rejected by provider",
          })
          .where(
            and(
              eq(paymentModel.id, payment.id),
              eq(paymentModel.status, "pending"),
            ),
          )
          .returning()
        if (!failed) {
          return { status: "ignored", reason: "payment_not_pending" }
        }
        await orderService.reopenAfterPaymentFailure({
          orderId: payment.orderId,
          workspaceId: payment.workspaceId,
          tx,
        })
        return { status: "ok" }
      }

      if (event.status === "refunded") {
        if (payment.status !== "paid") {
          return { status: "ignored", reason: "payment_not_paid" }
        }
        const [refunded] = await tx
          .update(paymentModel)
          .set({
            status: "refunded",
            providerPaymentReference: event.providerPaymentReference,
          })
          .where(
            and(
              eq(paymentModel.id, payment.id),
              eq(paymentModel.status, "paid"),
            ),
          )
          .returning()
        if (!refunded) {
          return { status: "ignored", reason: "payment_not_paid" }
        }
        await orderService.markRefunded({
          orderId: payment.orderId,
          workspaceId: payment.workspaceId,
          tx,
        })
        return { status: "ok" }
      }

      if (payment.status !== "pending") {
        return { status: "ignored", reason: "payment_not_pending" }
      }

      // Guarded pending -> paid transition: the rowcount check is the single
      // point that decides "already processed", even under a race with
      // another copy of this same event (the replay guard above should have
      // already caught that, but this is the belt to its suspenders).
      const [confirmed] = await tx
        .update(paymentModel)
        .set({
          status: "paid",
          confirmedAt: new Date(),
          providerPaymentReference: event.providerPaymentReference,
        })
        .where(
          and(
            eq(paymentModel.id, payment.id),
            eq(paymentModel.status, "pending"),
          ),
        )
        .returning()

      if (!confirmed) {
        return { status: "ignored", reason: "payment_not_pending" }
      }

      await orderService.settlePaid({
        orderId: payment.orderId,
        workspaceId: payment.workspaceId,
        tx,
      })

      return { status: "ok" }
    })
  }
}

export const paymentService = new PaymentService()
