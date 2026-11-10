/**
 * Wesal: speech from a cloned voice on ElevenLabs. The API key comes from
 * ELEVENLABS_API_KEY on the server; the voice id is set per workspace.
 * Returns null when the key is not configured, so the caller can fall back.
 */
const ELEVENLABS_MODEL = "eleven_multilingual_v2"

export async function synthesizeElevenLabsSpeech(props: {
  text: string
  voiceId: string
  signal?: AbortSignal
}): Promise<null | { audio: Uint8Array; mediaType: string }> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return null
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(props.voiceId)}?output_format=opus_48000_64`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        accept: "audio/ogg",
      },
      body: JSON.stringify({
        text: props.text,
        model_id: ELEVENLABS_MODEL,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.85,
          style: 0.2,
          use_speaker_boost: true,
        },
      }),
      signal: props.signal,
    },
  )

  if (!response.ok) {
    throw new Error(`ElevenLabs text-to-speech failed (${response.status})`)
  }

  const audio = new Uint8Array(await response.arrayBuffer())
  if (audio.byteLength === 0) {
    throw new Error("ElevenLabs text-to-speech returned no audio")
  }
  // Opus output comes in an Ogg container, which WhatsApp plays as a voice note.
  return { audio, mediaType: "audio/ogg" }
}
