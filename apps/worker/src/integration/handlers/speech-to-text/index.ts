import { aiTimeouts } from "@chatbotx.io/ai"
import {
  aiIntegrationService,
  getAIModel,
  getPlatformTranscriptionModel,
} from "@chatbotx.io/ai/server"
import {
  type UsageReservation,
  usageMeteringService,
} from "@chatbotx.io/business"
import type { AISpeechToTextSchema } from "@chatbotx.io/flow-config"
import { experimental_transcribe as transcribe } from "ai"
import ky from "ky"
import { normalizeError } from "universal-error-normalizer"
import { z } from "zod"
import { logger } from "../../../lib/logger"
import {
  readCustomFieldValue,
  saveResultToCustomField,
} from "../../utils/contact"
import type { ExecuteStepProps } from "../flow"
import type { ExecuteStepResult } from "../step"

const supportedAudioMimeTypes = z.enum([
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/x-wav",
  "audio/mp3",
])

export async function handleAISpeechToText({
  conversation,
  contactInbox,
  flowVersion,
  step,
  triggerMessageId,
}: ExecuteStepProps<AISpeechToTextSchema>): Promise<ExecuteStepResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), aiTimeouts.aiTotal)
  let reservation: UsageReservation | undefined

  try {
    const platformTranscription = await getPlatformTranscriptionModel()

    // Resolve Audio URL
    const audioUrl = await readCustomFieldValue({
      customFieldId: step.inputFieldId,
      contactId: conversation.contactId,
    })

    if (!audioUrl) {
      return {
        status: "error",
        errorMessage: "No audio URL provided",
        result: null,
      }
    }

    const audioResponse = await ky.get(audioUrl, {
      signal: controller.signal,
      throwHttpErrors: false,
    })
    const rawContentType = audioResponse.headers.get("content-type") ?? ""
    const contentType = rawContentType.split(";")[0]?.trim() ?? ""

    if (
      !(
        contentType &&
        (supportedAudioMimeTypes.options as string[]).includes(contentType)
      )
    ) {
      return {
        status: "error",
        errorMessage: `Unsupported audio format: ${rawContentType || "unknown"}`,
        result: null,
      }
    }

    const audioBuffer = await audioResponse.arrayBuffer()

    let transcriptionModel = platformTranscription?.model
    if (!transcriptionModel) {
      const aiConfig = await aiIntegrationService.findBy({
        workspaceId: conversation.workspaceId,
        provider: step.provider,
      })
      if (!aiConfig) {
        return {
          status: "error",
          errorMessage: "AI integration not found",
          result: null,
        }
      }
      const openaiProvider = getAIModel(aiConfig, "openai")
      if (!("transcription" in openaiProvider)) {
        throw new Error(
          `Provider ${step.provider} does not support transcription`,
        )
      }
      transcriptionModel = openaiProvider.transcription(step.model)
    }

    reservation = await usageMeteringService.reserve({
      workspaceId: conversation.workspaceId,
      operationId: `flow:speech-to-text:${conversation.id}:${triggerMessageId ?? flowVersion.id}:${step.id}`,
      category: "transcription",
      provider: platformTranscription ? "platform" : step.provider,
      model: step.model,
      metadata: { conversationId: conversation.id, stepId: step.id },
    })

    const transcript = await transcribe({
      model: transcriptionModel,
      audio: new Uint8Array(audioBuffer),
      abortSignal: controller.signal,
      providerOptions: platformTranscription
        ? {
            googleVertex: {
              languageCodes: ["auto"],
              region: platformTranscription.region,
              enableAutomaticPunctuation: true,
            },
          }
        : undefined,
    })

    await usageMeteringService.settleUnits(
      reservation,
      "transcription",
      transcript.durationInSeconds ?? 1,
      { durationInSeconds: transcript.durationInSeconds },
    )

    if (step.outputFieldId) {
      await saveResultToCustomField({
        contactId: conversation.contactId,
        customFieldId: step.outputFieldId,
        fullText: transcript.text,
        workspaceId: conversation.workspaceId,
        contactInboxId: contactInbox.id,
      })
    }

    return { status: "success", result: null }
  } catch (err) {
    if (reservation) {
      await usageMeteringService.release(reservation, err)
    }
    const error = normalizeError(err)
    logger.error(error, "[ai-speech-to-text] Step failed")
    return { status: "error", errorMessage: error.message, result: null }
  } finally {
    clearTimeout(timeoutId)
  }
}
