import {
  AI_MESSAGE_HISTORY_LOOKBACK_MS,
  MAX_CONVERSATION_HISTORY,
  systemFunctionNames,
} from "@chatbotx.io/ai"
import { aiContextService } from "@chatbotx.io/ai/server"
import { automatedResponseService } from "@chatbotx.io/automated-response"
import { aiAgentService, workspaceService } from "@chatbotx.io/business"
import { isMessageStorageError } from "@chatbotx.io/database/errors"
import {
  aiAgentProviderModels,
  aiMessageRoles,
  defaultReplyFrequencies,
} from "@chatbotx.io/database/partials"
import {
  createMessageRepository,
  findConversationAIContextState,
  getSafeSinceTime,
} from "@chatbotx.io/database/repositories"
import { emit } from "@chatbotx.io/event-bus"
import {
  DOCX_MIME_TYPES,
  IMAGE_MIME_TYPES,
  PDF_MIME_TYPES,
} from "@chatbotx.io/sdk"
import type { IntegrationJobProcessAutomatedResponse } from "@chatbotx.io/worker-config"
import type { ModelMessage } from "ai"
import { normalizeError } from "universal-error-normalizer"
import { sendTypingToChannel } from "../../../chat/handlers/send-message"
import { detectConversationAndContactInbox } from "../../../lib/db"
import { logger } from "../../../lib/logger"
import {
  isSupportedAudioAttachment,
  transcribeAudioAttachments,
} from "./audio-transcription"
import { triggerDefaultReplyFlow } from "./default-reply"
import { replyByAI } from "./replies"

const TRIGGER_MESSAGE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Labels the WhatsApp integration stores for inbound types it has no parser
 * for. These two are events about a conversation, not messages in it, so the
 * agent has nothing to answer. Matched on the stored text because that is what
 * reaches this handler — the message type itself is not carried through.
 */
const CONVERSATION_EVENT_LABELS = new Set([
  "Received reaction",
  "Received revoke",
])

const SUPPORTED_DOCUMENT_MIME_TYPES = new Set<string>([
  ...PDF_MIME_TYPES,
  ...DOCX_MIME_TYPES,
])
const SUPPORTED_IMAGE_MIME_TYPES = new Set<string>(IMAGE_MIME_TYPES)

function normalizeMimeType(value: string): string {
  return value.toLowerCase().split(";")[0]?.trim() ?? ""
}

function isSupportedDocumentMimeType(mimeType: string): boolean {
  return SUPPORTED_DOCUMENT_MIME_TYPES.has(normalizeMimeType(mimeType))
}

function isSupportedImageMimeType(mimeType: string): boolean {
  return SUPPORTED_IMAGE_MIME_TYPES.has(normalizeMimeType(mimeType))
}

export async function processAutomatedResponse(
  props: IntegrationJobProcessAutomatedResponse["data"],
) {
  const { conversationId, contactInboxId, messageId } = props
  const { conversation, contactInbox } =
    await detectConversationAndContactInbox({
      conversationId,
      contactInboxId,
    })

  const workspace = await workspaceService.findById({
    id: conversation.workspaceId,
  })
  if (!workspaceService.isActiveNow(workspace)) {
    return
  }
  // Robustness against a stale/unmigrated row: fall back to `allTime`
  // (today's behavior) rather than throwing on an unexpected column value.
  const defaultReplyFrequency =
    defaultReplyFrequencies.safeParse(workspace.defaultReplyFrequency).data ??
    defaultReplyFrequencies.enum.allTime

  const repo = await createMessageRepository()
  const triggerMessage = await repo.findTriggerMessage({
    id: messageId,
    conversationId: conversation.id,
    workspaceId: conversation.workspaceId,
    sinceTime:
      getSafeSinceTime(
        contactInbox.lastMessageAt ?? contactInbox.createdAt,
        TRIGGER_MESSAGE_LOOKBACK_MS,
      ) ?? new Date(0),
    requireCompleteResults: true,
  })
  if (!triggerMessage) {
    logger.warn(
      {
        contactInboxId: contactInbox.id,
        conversationId: conversation.id,
        messageId,
        workspaceId: conversation.workspaceId,
      },
      "Automated response trigger message was not found",
    )
  }
  // WhatsApp sends `reaction` (an emoji placed on an earlier message) and
  // `revoke` (the sender deleting one) through the same inbound path as real
  // messages. Neither has a parser upstream, so both land as the literal label
  // "Received reaction" / "Received revoke" — and waking the agent for those
  // makes it answer an emoji, and spends points doing it. Measured over one
  // week on production: 18 such rows across two live workspaces.
  //
  // The check lives here rather than in the WhatsApp integration because that
  // file is byte-identical to upstream ChatbotX and carries an upstream test
  // asserting the label; this handler already diverges, so the fix costs no
  // extra merge surface.
  if (
    triggerMessage?.senderType === "contact" &&
    CONVERSATION_EVENT_LABELS.has(triggerMessage.text ?? "")
  ) {
    logger.info(
      {
        conversationId: conversation.id,
        workspaceId: conversation.workspaceId,
        label: triggerMessage.text,
      },
      "[automated-response] skipped a conversation event, not a message",
    )
    return
  }

  const triggerAttachments = triggerMessage?.attachments ?? []
  const isFileOnlyTrigger =
    triggerMessage?.senderType === "contact" &&
    !triggerMessage.text &&
    triggerAttachments.length > 0
  const hasTriggerImage = triggerAttachments.some(
    (attachment) =>
      isSupportedImageMimeType(attachment.mimeType) ||
      attachment.fileType === "image" ||
      attachment.fileType === "gif",
  )
  const hasTriggerDocument = triggerAttachments.some((attachment) =>
    isSupportedDocumentMimeType(attachment.mimeType),
  )
  const hasTriggerAudio = triggerAttachments.some(isSupportedAudioAttachment)

  const repliedByAutomatedResponse = await automatedResponseService.process({
    conversation,
    contactInbox,
  })
  if (repliedByAutomatedResponse) {
    return
  }

  try {
    const aiAgent = await aiAgentService.findDefault(conversation.workspaceId)

    if (!aiAgent) {
      const defaultReplyResult = await triggerDefaultReplyFlow({
        workspaceId: conversation.workspaceId,
        defaultReplyFlowId: workspace.defaultReply,
        defaultReplyFrequency,
        conversation,
        contactInbox,
        trackingContext: messageId
          ? {
              aiProvider: "none",
              conversationId: conversation.id,
              messageId,
              responseType: "flow",
              startTime: Date.now(),
              triggerType: "bot_response_default_reply_flow_no_ai_agent",
              workspaceId: conversation.workspaceId,
            }
          : undefined,
      })
      if (defaultReplyResult !== "triggered" && messageId) {
        await emit("analytics:dashboard", {
          eventType: "message:bot_received",
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          messageId,
          occurredAt: new Date(),
          hasResponse: false,
          responseType: "none",
          routeType: "fallback",
          result: "fallback",
          aiProvider: "none",
          metadata: {
            latency: 0,
            fallbackReason: "no_ai_agent",
            triggerContext: {
              triggerSource: "worker",
              triggerHandler: "triggerAutomatedResponse",
              triggerType: "bot_response_fallback_no_ai_agent",
            },
          },
        })
      }
      return
    }

    const aiAgentModels = aiAgentProviderModels.parse(aiAgent.models)
    const aiContext = await aiContextService.getOrInitContext({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      preferredModels: aiAgentModels,
    })
    const markerMessageId =
      aiContext?.markerMessageId ??
      (
        await findConversationAIContextState({
          conversationId: conversation.id,
          workspaceId: conversation.workspaceId,
        })
      )?.aiContextLastMessageId ??
      null

    let messages: ModelMessage[] = []
    let summary = ""

    if (aiContext) {
      const contextSinceTime =
        getSafeSinceTime(
          contactInbox.lastMessageAt ?? contactInbox.createdAt,
          AI_MESSAGE_HISTORY_LOOKBACK_MS,
        ) ?? new Date(0)
      const newDbMessages = await repo.findAIContextMessages({
        conversationId: conversation.id,
        limit: MAX_CONVERSATION_HISTORY,
        markerMessageId,
        sinceTime: contextSinceTime,
        workspaceId: conversation.workspaceId,
      })

      const newMessages = newDbMessages.flatMap((msg) => {
        if (!msg.text) {
          return []
        }
        let role: "user" | "assistant" | null = null
        if (msg.senderType === "contact") {
          role = "user"
        } else if (msg.senderType === "user" || msg.senderType === "bot") {
          role = "assistant"
        }
        if (!role) {
          return []
        }
        return [
          {
            message: { role, content: msg.text } as ModelMessage,
            messageId: msg.id,
            createdAt: msg.createdAt.getTime(),
          },
        ]
      })

      const refreshedContext =
        newMessages.length > 0
          ? await aiContextService.appendHistory({
              conversationId: conversation.id,
              newMessages,
            })
          : aiContext

      if (refreshedContext) {
        messages = aiContextService.mapContextToModelMessages(
          refreshedContext.history,
        )
        summary = refreshedContext.summary
      }
    }

    if (messages.length === 0) {
      const dbMessages = await repo.findAIContextMessages({
        conversationId: conversation.id,
        limit: 100,
        markerMessageId,
        sinceTime:
          getSafeSinceTime(
            contactInbox.lastMessageAt ?? contactInbox.createdAt,
            AI_MESSAGE_HISTORY_LOOKBACK_MS,
          ) ?? new Date(0),
        workspaceId: conversation.workspaceId,
      })
      const aiHistory = aiContextService.mapDbMessagesToContext(dbMessages)
      messages = aiContextService.mapContextToModelMessages(aiHistory)
    }

    const audioTranscripts = hasTriggerAudio
      ? await transcribeAudioAttachments({
          attachments: triggerAttachments,
          conversationId: conversation.id,
          workspaceId: conversation.workspaceId,
        })
      : []

    for (const transcript of audioTranscripts) {
      messages.push({
        role: aiMessageRoles.enum.user,
        content: `Transcription of the attached voice message:\n${transcript}`,
      })
    }

    if (isFileOnlyTrigger) {
      messages.push({
        role: aiMessageRoles.enum.user,
        content: getFileOnlyPrompt({
          hasAudio: hasTriggerAudio,
          hasDocument: hasTriggerDocument,
          hasImage: hasTriggerImage,
          audioTranscribed: audioTranscripts.length > 0,
          language: workspace.language,
        }),
      })
    }

    const sendTyping = () =>
      sendTypingToChannel({
        conversation,
        contactInbox,
        typing: true,
        seconds: 5,
      }).catch((err) => {
        logger.debug(
          { err, conversationId: conversation.id },
          "[automated-response] typing indicator failed",
        )
      })

    sendTyping()
    const typingIntervalId = setInterval(sendTyping, 4000)

    const startTime = Date.now()
    let aiResult: Awaited<ReturnType<typeof replyByAI>>
    try {
      aiResult = await replyByAI({
        conversation,
        contactInbox,
        channel: contactInbox.channel,
        messages,
        aiAgent,
        triggerMessageId: messageId,
        fileOnlyTrigger: isFileOnlyTrigger,
        allowedSystemFunctionIds: isFileOnlyTrigger
          ? getFileOnlySystemFunctionIds({
              hasDocument: hasTriggerDocument,
              hasImage: hasTriggerImage,
            })
          : undefined,
        summary,
        defaultReplyFlowId: workspace.defaultReply,
        workspaceLanguage: workspace.language,
        defaultReplyFrequency,
      })
    } finally {
      clearInterval(typingIntervalId)
    }

    if (aiResult && !aiResult.usedFallbackText) {
      // AI produced its own response; bot_received emit happens inside
      // sendChatMessage via trackingContext (first streamed part only).
      return
    }

    if (aiResult?.usedFallbackText) {
      // The tool-call fallback branch inside runAIReply already resolved
      // this — either by sending the default reply flow or the canned
      // fallback text — so don't trigger the default reply flow again here.
      if (messageId) {
        await emit("analytics:dashboard", {
          eventType: "message:bot_received",
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          messageId,
          occurredAt: new Date(),
          hasResponse: true,
          responseType: "ai_agent",
          routeType: "agent",
          result: "fallback",
          aiProvider: aiResult.provider,
          metadata: {
            latency: Date.now() - startTime,
            fallbackReason: "no_intent_match",
            toolStats: aiResult.toolStats,
            triggerContext: {
              triggerSource: "worker",
              triggerHandler: "triggerAutomatedResponse",
              triggerType: "bot_response_ai_agent_fallback_text",
            },
          },
        })
      }
      return
    }

    // AI agent exists but failed to produce any response at all → fallback flow.
    const defaultReplyResult = await triggerDefaultReplyFlow({
      workspaceId: conversation.workspaceId,
      defaultReplyFlowId: workspace.defaultReply,
      defaultReplyFrequency,
      conversation,
      contactInbox,
      trackingContext: messageId
        ? {
            aiProvider: "none",
            conversationId: conversation.id,
            messageId,
            responseType: "flow",
            startTime,
            triggerType: "bot_response_default_reply_flow_ai_failed",
            workspaceId: conversation.workspaceId,
          }
        : undefined,
    })
    if (defaultReplyResult !== "triggered" && messageId) {
      await emit("analytics:dashboard", {
        eventType: "message:bot_received",
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        messageId,
        occurredAt: new Date(),
        hasResponse: false,
        responseType: "ai_agent",
        routeType: "agent",
        result: "fallback",
        aiProvider: "none",
        metadata: {
          latency: Date.now() - startTime,
          fallbackReason: "no_intent_match",
          triggerContext: {
            triggerSource: "worker",
            triggerHandler: "triggerAutomatedResponse",
            triggerType: "bot_response_ai_agent_failed",
          },
        },
      })
    }
  } catch (error) {
    const normalizedError = normalizeError(error)
    logger.error(
      {
        err: normalizedError,
        conversationId: conversation.id,
        workspaceId: conversation.workspaceId,
      },
      "[automated-response] triggerAutomatedResponse failed",
    )
    if (isMessageStorageError(error)) {
      throw error
    }
  }
}

function getFileOnlySystemFunctionIds(input: {
  hasDocument: boolean
  hasImage: boolean
}): string[] {
  const systemFunctionIds: string[] = []

  if (input.hasImage) {
    systemFunctionIds.push(systemFunctionNames.imageReader)
  }

  if (input.hasDocument) {
    systemFunctionIds.push(systemFunctionNames.documentReader)
  }

  return systemFunctionIds
}

function getFileOnlyPrompt(input: {
  hasAudio: boolean
  audioTranscribed: boolean
  hasDocument: boolean
  hasImage: boolean
  language?: string
}): string {
  const isArabic = input.language?.toLowerCase().startsWith("ar") ?? false

  if (input.hasAudio && input.audioTranscribed) {
    return "The attached voice message has been transcribed above. Answer the user's spoken request directly."
  }

  if (input.hasAudio) {
    return "I uploaded a voice message, but it could not be transcribed. Ask me to resend it or write the request as text."
  }

  if (input.hasImage && !input.hasDocument) {
    return isArabic
      ? "أرفقت صورة. حلّلها وقدّم ملخصًا قصيرًا بالعربية، ثم اسألني عن التفصيل المحدد الذي أريد معرفة المزيد عنه."
      : "I uploaded an image. Please analyze it, provide a short summary, then ask what specific detail I want to know more about."
  }

  if (input.hasDocument && !input.hasImage) {
    return "I uploaded a document. Please read it, provide a short summary, then ask what specific part I want to know more about."
  }

  return "I uploaded one or more files. Please inspect the supported attachment, provide a short summary, then ask what specific detail I want to know more about."
}
