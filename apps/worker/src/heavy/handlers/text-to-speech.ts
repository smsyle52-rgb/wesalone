import { aiTimeouts } from "@chatbotx.io/ai"
import {
  aiIntegrationService,
  getAIModel,
  synthesizePlatformSpeech,
} from "@chatbotx.io/ai/server"
import {
  type UsageReservation,
  usageMeteringService,
} from "@chatbotx.io/business"
import type { AITextToSpeechSchema } from "@chatbotx.io/flow-config"
import {
  experimental_generateSpeech as generateSpeech,
  NoSpeechGeneratedError,
} from "ai"
import { normalizeError } from "universal-error-normalizer"
import type { HeavyStepComputeProps } from "../../integration/handlers/flow-utils"
import { textToSpeechStorageService } from "../../integration/handlers/text-to-speech/storage"
import { logger } from "../../lib/logger"
import { ExpectedHeavyStepError } from "./errors"

function getExecutionId(
  metadataStepId: string | undefined,
  stepId: string,
): string {
  return metadataStepId ?? stepId
}

export async function textToSpeechOutput({
  conversation,
  metadata,
  step,
}: HeavyStepComputeProps<AITextToSpeechSchema>): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), aiTimeouts.aiTotal)
  let reservation: UsageReservation | undefined

  try {
    reservation = await usageMeteringService.reserve({
      workspaceId: conversation.workspaceId,
      operationId: `flow:text-to-speech:${conversation.id}:${getExecutionId(metadata?.stepId, step.id)}`,
      category: "speech",
      provider: step.provider,
      model: step.model,
      metadata: { conversationId: conversation.id, stepId: step.id },
    })

    // Wesal One: the platform voice comes first — merchants have no key of
    // their own, so a workspace integration is only the fallback.
    const platformSpeech = await synthesizePlatformSpeech({
      text: step.message,
      signal: controller.signal,
    })

    let audioData: string | Uint8Array
    let mediaType: string

    if (platformSpeech) {
      audioData = platformSpeech.audio
      mediaType = platformSpeech.mediaType
    } else {
      const aiConfig = await aiIntegrationService.findBy({
        workspaceId: conversation.workspaceId,
        provider: step.provider,
      })
      if (!aiConfig) {
        logger.warn(
          { workspaceId: conversation.workspaceId, provider: step.provider },
          "[ai-text-to-speech] AI configuration not found",
        )
        throw new ExpectedHeavyStepError("AI integration not found")
      }

      const openaiProvider = getAIModel(aiConfig, "openai")
      if (!("speech" in openaiProvider)) {
        throw new ExpectedHeavyStepError(
          `Provider ${step.provider} does not support text-to-speech`,
        )
      }

      const result = await generateSpeech({
        model: openaiProvider.speech(step.model),
        text: step.message,
        voice: step.voiceType,
        abortSignal: controller.signal,
        instructions:
          step.model === "gpt-4o-mini-tts"
            ? step.voiceTone || undefined
            : undefined,
      })

      audioData =
        result.audio.uint8Array && result.audio.uint8Array.byteLength > 0
          ? result.audio.uint8Array
          : result.audio.base64
      mediaType = result.audio.mediaType
    }

    if (!audioData) {
      throw new Error("[ai-text-to-speech] Empty audio payload from provider")
    }

    await usageMeteringService.settleUnits(
      reservation,
      "speech",
      step.message.length,
      { characters: step.message.length },
    )
    // Settled: a later storage failure must not release a charge that ran.
    reservation = undefined

    const audioOutput = await textToSpeechStorageService.saveAudio({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      executionId: getExecutionId(metadata?.stepId, step.id),
      audioData,
      mediaType,
    })

    return audioOutput.publicUrl
  } catch (err) {
    if (reservation) {
      await usageMeteringService.release(reservation, err)
    }
    if (err instanceof NoSpeechGeneratedError) {
      logger.error(
        {
          conversationId: conversation.id,
          err: normalizeError(err),
          model: step.model,
          provider: step.provider,
          workspaceId: conversation.workspaceId,
        },
        "[ai-text-to-speech] No speech generated",
      )
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}
