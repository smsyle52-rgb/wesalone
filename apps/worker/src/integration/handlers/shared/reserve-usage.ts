import {
  InsufficientPointsError,
  type ReserveUsageOptions,
  type UsageReservation,
  usageMeteringService,
} from "@chatbotx.io/business"
import { normalizeError } from "universal-error-normalizer"
import { logger } from "../../../lib/logger"

/**
 * Reserves points for a customer-facing reply without ever letting a billing
 * problem turn into customer-facing silence.
 *
 * `usageMeteringService.reserve` throws for reasons that have nothing to do
 * with the merchant's balance — an inactive wallet, a duplicate operationId
 * when a job is retried, a plain database error. On every reply path those
 * throws land in a catch that returns null, so the customer receives nothing
 * and the only trace is a generic runner error. An unbilled answer is
 * recoverable; an unanswered customer is not. So infrastructure failures
 * degrade to an unmetered reply and are logged for reconciliation.
 *
 * `InsufficientPointsError` is the one case that must still stop the call: it
 * is a deliberate refusal, not a malfunction, and it only fires when
 * AI_POINTS_ENFORCEMENT_MODE is `enforce`.
 *
 * NOTE: that refusal currently still reaches the customer as silence. Telling
 * the customer and notifying the merchant is separate, required work before
 * enforcement is ever switched on.
 */
export const reserveUsageOrUnmetered = async (
  options: ReserveUsageOptions,
  context: { provider: string; modelId: string; conversationId: string },
): Promise<UsageReservation | undefined> => {
  try {
    return await usageMeteringService.reserve(options)
  } catch (error) {
    if (error instanceof InsufficientPointsError) {
      logger.error(
        {
          err: normalizeError(error),
          available: error.available,
          required: error.required,
          workspaceId: options.workspaceId,
          ...context,
        },
        "[usage] reply blocked: workspace is out of points",
      )
      throw error
    }
    logger.error(
      {
        err: normalizeError(error),
        workspaceId: options.workspaceId,
        operationId: options.operationId,
        ...context,
      },
      "[usage] reservation failed — replying unmetered",
    )
    return
  }
}
