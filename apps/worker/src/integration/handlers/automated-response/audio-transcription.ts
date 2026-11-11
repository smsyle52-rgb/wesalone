import { aiTimeouts } from "@chatbotx.io/ai"
import {
  getPlatformAzureFoundryChatConfig,
  getPlatformTranscriptionModel,
  transcribeWithPlatformChatModel,
} from "@chatbotx.io/ai/server"
import { usageMeteringService } from "@chatbotx.io/business"
import type { AttachmentModel } from "@chatbotx.io/database/types"
import { uploader } from "@chatbotx.io/filesystem"
import { experimental_transcribe as transcribe } from "ai"
import { normalizeError } from "universal-error-normalizer"
import { logger } from "../../../lib/logger"

const MAX_AUDIO_BYTES = 25 * 1024 * 1024

const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/x-wav",
  "audio/mp3",
])

function normalizeMimeType(value: string): string {
  return value.toLowerCase().split(";")[0]?.trim() ?? ""
}

export function isSupportedAudioAttachment(
  attachment: AttachmentModel,
): boolean {
  return (
    attachment.fileType === "audio" ||
    SUPPORTED_AUDIO_MIME_TYPES.has(normalizeMimeType(attachment.mimeType))
  )
}

export async function transcribeAudioAttachments(props: {
  attachments: AttachmentModel[]
  conversationId: string
  workspaceId: string
}): Promise<string[]> {
  const audioAttachments = props.attachments.filter(isSupportedAudioAttachment)
  if (audioAttachments.length === 0) {
    return []
  }

  const platformTranscription = await getPlatformTranscriptionModel()
  // Wesal: the platform chat model (Gemini) listens first; the speech-to-text
  // model is the fallback.
  const chatModelId = getPlatformAzureFoundryChatConfig()?.model
  if (!(platformTranscription || chatModelId)) {
    logger.warn(
      {
        conversationId: props.conversationId,
        workspaceId: props.workspaceId,
      },
      "[automated-response] platform speech-to-text is not configured",
    )
    return []
  }

  const transcripts: string[] = []
  for (const attachment of audioAttachments) {
    const reservation = await usageMeteringService.reserve({
      workspaceId: props.workspaceId,
      operationId: `auto-transcription:${props.conversationId}:${attachment.id}`,
      category: "transcription",
      provider: "platform",
      model: chatModelId ?? platformTranscription?.modelId,
      metadata: {
        conversationId: props.conversationId,
        attachmentId: attachment.id,
      },
    })
    try {
      if (attachment.size > MAX_AUDIO_BYTES) {
        throw new Error("Audio attachment is too large for transcription")
      }

      const audio = await uploader.getObject(attachment.originPath)
      if (audio.byteLength > MAX_AUDIO_BYTES) {
        throw new Error("Audio attachment is too large for transcription")
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), aiTimeouts.aiTotal)
      try {
        const heard = await transcribeWithChatModel({
          audio: new Uint8Array(audio),
          mimeType: attachment.mimeType,
          signal: controller.signal,
          conversationId: props.conversationId,
        })
        if (heard !== null) {
          await usageMeteringService.settleUnits(
            reservation,
            "transcription",
            estimateVoiceNoteSeconds(audio.byteLength),
            { model: chatModelId },
          )
          if (heard) {
            transcripts.push(heard)
          }
          continue
        }
        if (!platformTranscription) {
          throw new Error("Speech-to-text is not configured")
        }
        const result = await transcribe({
          model: platformTranscription.model,
          audio: new Uint8Array(audio),
          abortSignal: controller.signal,
          providerOptions: {
            googleVertex: {
              languageCodes: ["auto"],
              region: platformTranscription.region,
              enableAutomaticPunctuation: true,
            },
          },
        })
        const text = result.text.trim()
        await usageMeteringService.settleUnits(
          reservation,
          "transcription",
          result.durationInSeconds ?? 1,
          { durationInSeconds: result.durationInSeconds },
        )
        if (text) {
          transcripts.push(text)
        }
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (error) {
      await usageMeteringService.release(reservation, error)
      logger.error(
        {
          err: normalizeError(error),
          attachmentId: attachment.id,
          conversationId: props.conversationId,
          modelId: chatModelId ?? platformTranscription?.modelId,
          workspaceId: props.workspaceId,
        },
        "[automated-response] audio transcription failed",
      )
    }
  }

  return transcripts
}

/** WhatsApp voice notes are Opus at roughly 16 kbit/s. */
const estimateVoiceNoteSeconds = (bytes: number): number =>
  Math.max(1, Math.round(bytes / 2000))

/**
 * The chat model's transcript, or null when it is not available or failed —
 * then the speech-to-text model takes over.
 */
async function transcribeWithChatModel(props: {
  audio: Uint8Array
  mimeType: string
  signal: AbortSignal
  conversationId: string
}): Promise<string | null> {
  try {
    const result = await transcribeWithPlatformChatModel(props)
    return result ? result.text : null
  } catch (err) {
    logger.warn(
      { err, conversationId: props.conversationId },
      "[automated-response] chat-model transcription failed — using speech-to-text",
    )
    return null
  }
}
