import { GoogleAuth } from "google-auth-library"
import {
  getPlatformTextToSpeechConfig,
  getVertexGoogleAuthOptions,
} from "./platform-provider"

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

  // A bare `new GoogleAuth()` looks for Application Default Credentials —
  // GOOGLE_APPLICATION_CREDENTIALS, a metadata server, a gcloud login. None of
  // those exist in the Azure containers this runs in, so the call failed at
  // authentication and the caller quietly fell through to the merchant's own
  // OpenAI key, leaving the platform's configured Arabic voice unused.
  //
  // The platform already builds a Workload Identity Federation credential for
  // Vertex from the Azure managed identity (no Google key is stored anywhere),
  // and it is what makes chat work from these same containers. Reuse it: the
  // scope it requests is cloud-platform, which covers the Text-to-Speech API.
  const authOptions = getVertexGoogleAuthOptions(capability.projectId)
  if (!authOptions) {
    return null
  }

  const auth = new GoogleAuth({
    ...authOptions,
    scopes: [CLOUD_PLATFORM_SCOPE],
  })
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
