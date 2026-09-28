import { normalizeError } from "universal-error-normalizer"
import { logger } from "../../../lib/logger"
import { handoffExecutorService } from "../../../trigger/services/handoff-executor.service"
import { sendMessageWithRender } from "../../utils/message"
import type { ReplyByAIExecutionResult, ReplyByAIProps } from "./replies"

/**
 * What the customer reads when the merchant's AI points have run out. It says
 * nothing about billing — that is the merchant's business, not the
 * customer's — only that a person will answer.
 */
export function getPointsExhaustedReply(language?: string): string {
  if (language?.toLowerCase().startsWith("ar")) {
    return "شكرًا لتواصلك معنا! سيرد عليك أحد أفراد فريقنا في أقرب وقت."
  }
  return "Thanks for reaching out! A member of our team will get back to you shortly."
}

/**
 * The graceful stop for an agent whose workspace is out of points.
 *
 * Before this, `InsufficientPointsError` ended the reply in silence (or, one
 * layer up, in the generic "could not answer" fallback repeated on every
 * message). Now the customer gets one polite line, and the conversation is
 * handed to the team: the bot pauses for this conversation (so the customer
 * is not told the same thing on every message) and agents are notified, the
 * same path the "connect to a human" tool takes. The merchant hears about the
 * balance from the points-balance notice.
 */
export async function handlePointsExhausted(
  props: ReplyByAIProps,
  context: { provider: ReplyByAIExecutionResult["provider"]; modelId: string },
): Promise<ReplyByAIExecutionResult> {
  const { conversation, contactInbox } = props
  logger.warn(
    {
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId,
    },
    "[automated-response] out of AI points; handing the conversation to the team",
  )

  await sendMessageWithRender(
    conversation.id,
    getPointsExhaustedReply(
      props.workspaceLanguage ?? contactInbox.language ?? undefined,
    ),
  )

  try {
    await handoffExecutorService.execute({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      reason: "ai_points_exhausted",
      source: "automated_response",
      channel: props.channel,
    })
  } catch (error) {
    // The customer already has their answer; a failed handoff only means the
    // next message repeats it.
    logger.error(
      { err: normalizeError(error), conversationId: conversation.id },
      "[automated-response] points-exhausted handoff failed",
    )
  }

  return {
    responded: true,
    provider: context.provider,
    modelId: context.modelId,
    usedFallbackText: true,
    toolStats: {
      steps: 0,
      toolCallsCount: 0,
      toolResultsCount: 0,
      toolErrorsCount: 0,
      toolNames: [],
      finishReasons: [],
    },
  }
}
