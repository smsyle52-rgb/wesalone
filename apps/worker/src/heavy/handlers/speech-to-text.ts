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
import { z } from "zod"
import { env } from "../../env"
import type { HeavyStepComputeProps } from "../../integration/handlers/flow-utils"
import { readCustomFieldValue } from "../../integration/utils/contact"
import { downloadWithByteLimit } from "./bounded-download"
import { ExpectedHeavyStepError } from "./errors"

const supportedAudioMimeTypes = z.enum([
  "audio/flac",
  "audio/mpeg",
  "audio/mpga",
  "audio/m4a",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/x-wav",
  "audio/mp3",
])

export async function speechToTextOutput({
  conversation,
  metadata,
  step,
}: HeavyStepComputeProps<AISpeechToTextSchema>): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), aiTimeouts.aiTotal)
  let reservation: UsageReservation | undefined

  try {
    const audioUrl = await readCustomFieldValue({
      customFieldId: step.inputFieldId,
      contactId: conversation.contactId,
    })

    if (!audioUrl) {
      throw new ExpectedHeavyStepError("No audio URL provided")
    }

    // Wesal One: the platform transcription model comes first — merchants have
    // no key of their own, so a workspace integration is only the fallback.
    const platformTranscription = await getPlatformTranscriptionModel()
    let transcriptionModel = platformTranscription?.model

    if (!transcriptionModel) {
      const aiConfig = await aiIntegrationService.findBy({
        workspaceId: conversation.workspaceId,
        provider: step.provider,
      })

      if (!aiConfig) {
        throw new ExpectedHeavyStepError("AI integration not found")
      }

      const openaiProvider = getAIModel(aiConfig, "openai")
      if (!("transcription" in openaiProvider)) {
        throw new ExpectedHeavyStepError(
          `Provider ${step.provider} does not support transcription`,
        )
      }
      transcriptionModel = openaiProvider.transcription(step.model)
    }

    const audio = await downloadWithByteLimit({
      allowedMimeTypes: new Set(supportedAudioMimeTypes.options),
      label: "audio",
      maxBytes: env.HEAVY_MAX_AUDIO_BYTES,
      signal: controller.signal,
      url: audioUrl,
    })

    reservation = await usageMeteringService.reserve({
      workspaceId: conversation.workspaceId,
      operationId: `flow:speech-to-text:${conversation.id}:${metadata?.stepId ?? step.id}`,
      category: "transcription",
      provider: platformTranscription ? "platform" : step.provider,
      model: step.model,
      metadata: { conversationId: conversation.id, stepId: step.id },
    })

    const transcript = await transcribe({
      model: transcriptionModel,
      audio: new Uint8Array(audio.buffer),
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
    reservation = undefined

    return transcript.text
  } catch (err) {
    if (reservation) {
      await usageMeteringService.release(reservation, err)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}
