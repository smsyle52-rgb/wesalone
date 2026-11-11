import { getPlatformAzureFoundryChatConfig } from "./platform-provider"

/** API version of Azure's deployment-scoped chat completions endpoint. */
const CHAT_API_VERSION = "2024-10-21"

const TRANSCRIBE_PROMPT =
  "اكتب نص هذه الرسالة الصوتية حرفيًا كما قيلت وباللهجة نفسها، كاملة بدون حذف، وبدون أي إضافة أو شرح. إذا ما فيها كلام مفهوم، لا تكتب شيئًا."

/** Audio formats the chat model's `input_audio` part accepts, by mime type. */
const AUDIO_FORMATS: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
}

/**
 * Wesal: transcribes a customer's voice note with the platform's first-choice
 * chat model (Gemini on Azure AI Foundry), which hears Yemeni Arabic far more
 * completely than the speech-to-text model — that one dropped whole sentences
 * (a price question, a refund question) from real voice notes.
 *
 * Returns null when no chat model is configured or the audio format is not
 * one the model takes; the caller then uses the speech-to-text model.
 */
export async function transcribeWithPlatformChatModel(props: {
  audio: Uint8Array
  mimeType: string
  signal?: AbortSignal
}): Promise<{ text: string; modelId: string } | null> {
  const config = getPlatformAzureFoundryChatConfig()
  const format =
    AUDIO_FORMATS[props.mimeType.toLowerCase().split(";")[0]?.trim() ?? ""]
  if (!(config && format)) {
    return null
  }

  const url = new URL(
    `openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions`,
    config.endpoint,
  )
  url.searchParams.set("api-version", CHAT_API_VERSION)

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "api-key": config.apiKey,
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: TRANSCRIBE_PROMPT },
            {
              type: "input_audio",
              input_audio: {
                data: Buffer.from(props.audio).toString("base64"),
                format,
              },
            },
          ],
        },
      ],
    }),
    signal: props.signal,
  })
  if (!response.ok) {
    throw new Error(
      `Chat model transcription failed with HTTP ${response.status}`,
    )
  }
  const body = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[]
  }
  return {
    text: (body.choices?.[0]?.message?.content ?? "").trim(),
    modelId: config.model,
  }
}
