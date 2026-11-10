import {
  synthesizeElevenLabsSpeech,
  synthesizePlatformSpeech,
} from "@chatbotx.io/ai/server"
import { usageMeteringService } from "@chatbotx.io/business"
import type { ConversationModel } from "@chatbotx.io/database/types"
import { splitVoiceReply } from "@chatbotx.io/sdk"
import type { BotResponseTrackingContext } from "@chatbotx.io/worker-config"
import { logger } from "../../../lib/logger"
import { sendMessageAndWait } from "../../utils/message"
import { textToSpeechStorageService } from "../text-to-speech/storage"

const VOICE_REPLY_TIMEOUT_MS = 45_000

/** The cloned ElevenLabs voice first, then the platform's Google voice. */
async function synthesizeSpeech(props: {
  text: string
  voice?: string
  elevenLabsVoiceId?: string
  signal: AbortSignal
}): ReturnType<typeof synthesizePlatformSpeech> {
  if (props.elevenLabsVoiceId) {
    try {
      const cloned = await synthesizeElevenLabsSpeech({
        text: props.text,
        voiceId: props.elevenLabsVoiceId,
        signal: props.signal,
      })
      if (cloned) {
        return cloned
      }
    } catch (err) {
      logger.warn(
        { err },
        "[automated-response] ElevenLabs voice failed — trying the platform voice",
      )
    }
  }
  return await synthesizePlatformSpeech({
    text: props.text,
    encoding: "OGG_OPUS",
    voice: props.voice,
    signal: props.signal,
  })
}

/**
 * Wesal: sends an AI agent reply as a voice note (Ogg/Opus, which WhatsApp
 * plays as a voice message), followed by any account or phone numbers as text
 * so the customer can copy them.
 *
 * Returns false — having sent nothing — when the reply cannot be spoken
 * (nothing speakable, platform speech not configured, or synthesis failed);
 * the caller then sends the reply as text.
 */
export async function sendVoiceReply(props: {
  conversation: Pick<ConversationModel, "id" | "workspaceId">
  text: string
  voice?: string
  elevenLabsVoiceId?: string
  operationKey: string
  takeTrackingContext: () => BotResponseTrackingContext | undefined
}): Promise<boolean> {
  const { conversation, text, voice, elevenLabsVoiceId, operationKey } = props
  const { spoken, textOnly } = splitVoiceReply(text)
  if (!spoken) {
    return false
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), VOICE_REPLY_TIMEOUT_MS)
  let audioUrl: string
  let storagePath: string
  try {
    const reservation = await usageMeteringService.reserve({
      workspaceId: conversation.workspaceId,
      operationId: `ai-voice-reply:${conversation.id}:${operationKey}`,
      category: "speech",
      provider: "platform",
      metadata: { conversationId: conversation.id },
    })
    let speech: Awaited<ReturnType<typeof synthesizePlatformSpeech>>
    try {
      speech = await synthesizeSpeech({
        text: spoken,
        voice,
        elevenLabsVoiceId,
        signal: controller.signal,
      })
    } catch (error) {
      await usageMeteringService.release(reservation, error)
      throw error
    }
    if (!speech) {
      await usageMeteringService.release(reservation)
      return false
    }
    await usageMeteringService.settleUnits(
      reservation,
      "speech",
      spoken.length,
      { characters: spoken.length },
    )

    const saved = await textToSpeechStorageService.saveAudio({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      executionId: `voice-reply-${operationKey}`,
      audioData: speech.audio,
      mediaType: speech.mediaType,
    })
    audioUrl = saved.publicUrl
    storagePath = saved.storagePath
  } catch (err) {
    logger.warn(
      { err, conversationId: conversation.id },
      "[automated-response] voice reply failed — sending text instead",
    )
    return false
  } finally {
    clearTimeout(timeout)
  }

  await sendMessageAndWait(
    conversation.id,
    audioUrl,
    props.takeTrackingContext(),
    { forceUrl: true, storagePath },
  )
  if (textOnly) {
    await sendMessageAndWait(conversation.id, textOnly)
  }
  return true
}
