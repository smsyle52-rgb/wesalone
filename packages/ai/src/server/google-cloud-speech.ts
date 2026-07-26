import { GoogleAuth } from "google-auth-library"
import { getPlatformTextToSpeechConfig } from "./platform-provider"

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
const VOICE_LANGUAGE_CODE_PATTERN = /^([a-z]{2,3}-[A-Z]{2})-/

type GoogleTextToSpeechResponse = {
  audioContent?: string
}

function inferLanguageCode(voice: string): string {
  const match = VOICE_LANGUAGE_CODE_PATTERN.exec(voice)
  return match?.[1] ?? "ar-XA"
}

export async function synthesizePlatformSpeech(props: {
  text: string
  signal?: AbortSignal
}): Promise<null | { audio: Uint8Array; mediaType: string }> {
  const capability = await getPlatformTextToSpeechConfig()
  if (!capability) {
    return null
  }

  const voice = capability.voice ?? "ar-XA-Chirp3-HD-Aoede"
  const auth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] })
  const client = await auth.getClient()
  const authHeaders = await client.getRequestHeaders()
  const requestHeaders: Record<string, string> = {}
  authHeaders.forEach((value, key) => {
    requestHeaders[key] = value
  })
  const response = await fetch(
    "https://texttospeech.googleapis.com/v1/text:synthesize",
    {
      method: "POST",
      headers: {
        ...requestHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input: { text: props.text },
        voice: {
          languageCode: inferLanguageCode(voice),
          name: voice,
        },
        audioConfig: { audioEncoding: "MP3" },
      }),
      signal: props.signal,
    },
  )

  if (!response.ok) {
    throw new Error(`Google Cloud Text-to-Speech failed (${response.status})`)
  }

  const payload = (await response.json()) as GoogleTextToSpeechResponse
  if (!payload.audioContent) {
    throw new Error("Google Cloud Text-to-Speech returned no audio")
  }

  return {
    audio: Uint8Array.from(Buffer.from(payload.audioContent, "base64")),
    mediaType: "audio/mpeg",
  }
}
