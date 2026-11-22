"use client"

import { Button } from "@chatbotx.io/ui/components/ui/button"
import { DownloadIcon, Loader2Icon, PlayIcon } from "lucide-react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"

/**
 * WhatsApp voice notes are Ogg/Opus. Safari — and every browser on iPhone,
 * since they all run WebKit — cannot play that container, so on those devices
 * the clip is decoded in the browser (WASM) and played as a WAV blob instead.
 * Browsers that play Ogg/Opus natively keep the plain <audio> element.
 */

const OGG_OPUS_TYPE = 'audio/ogg; codecs="opus"'
const OGG_MIME = /ogg|opus/i
const WAV_HEADER_BYTES = 44
const PCM_MAX = 0x7f_ff

let nativeOggSupport: boolean | null = null

function browserPlaysOgg(): boolean {
  if (nativeOggSupport === null) {
    nativeOggSupport =
      document.createElement("audio").canPlayType(OGG_OPUS_TYPE) !== ""
  }
  return nativeOggSupport
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

/** Interleaves the decoded channels into a 16-bit PCM WAV file. */
function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const channelCount = channels.length
  const frames = channels[0]?.length ?? 0
  const dataBytes = frames * channelCount * 2
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, "RIFF")
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, "WAVE")
  writeAscii(view, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channelCount * 2, true)
  view.setUint16(32, channelCount * 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, "data")
  view.setUint32(40, dataBytes, true)

  let offset = WAV_HEADER_BYTES
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame] ?? 0))
      view.setInt16(offset, Math.round(sample * PCM_MAX), true)
      offset += 2
    }
  }
  return new Blob([buffer], { type: "audio/wav" })
}

async function decodeOggToWavUrl(src: string): Promise<string> {
  const response = await fetch(src)
  if (!response.ok) {
    throw new Error(`Audio fetch failed: ${response.status}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const { OggOpusDecoder } = await import("ogg-opus-decoder")
  const decoder = new OggOpusDecoder()
  try {
    await decoder.ready
    const decoded = await decoder.decodeFile(bytes)
    if (decoded.samplesDecoded === 0) {
      throw new Error("No audio decoded")
    }
    return URL.createObjectURL(
      encodeWav(decoded.channelData, decoded.sampleRate),
    )
  } finally {
    decoder.free()
  }
}

type DecodeState = "idle" | "loading" | "failed"

type OggCompatibleAudioProps = {
  src: string
  mimeType?: string | null
  onError: () => void
}

export function OggCompatibleAudio({
  src,
  mimeType,
  onError,
}: OggCompatibleAudioProps) {
  const t = useTranslations()
  const [needsDecode, setNeedsDecode] = useState(false)
  const [state, setState] = useState<DecodeState>("idle")
  const [wavUrl, setWavUrl] = useState<string | null>(null)

  useEffect(() => {
    setNeedsDecode(OGG_MIME.test(mimeType ?? "") && !browserPlaysOgg())
  }, [mimeType])

  // The parent keys this component by `src`, so a new source (e.g. a
  // re-signed URL) remounts it with fresh state.
  useEffect(
    () => () => {
      if (wavUrl) {
        URL.revokeObjectURL(wavUrl)
      }
    },
    [wavUrl],
  )

  if (!needsDecode) {
    return (
      // `preload="metadata"` (not "none") so the player shows the clip's
      // total duration at rest instead of 0:00 / 0:00.
      <audio controls key={src} onError={onError} preload="metadata">
        <track default kind="captions" />
        <source onError={onError} src={src} type={mimeType ?? undefined} />
      </audio>
    )
  }

  if (wavUrl) {
    return (
      <audio autoPlay controls key={wavUrl} src={wavUrl}>
        <track default kind="captions" />
      </audio>
    )
  }

  if (state === "failed") {
    return (
      <Link
        className="inline-flex items-center gap-2 rounded-xl bg-secondary p-3 text-sm"
        href={src}
        prefetch={false}
        target="_blank"
      >
        <DownloadIcon className="size-4" />
        {t("actions.download")}
      </Link>
    )
  }

  const handlePlay = async () => {
    setState("loading")
    try {
      setWavUrl(await decodeOggToWavUrl(src))
    } catch {
      setState("failed")
      onError()
    }
  }

  return (
    <Button
      disabled={state === "loading"}
      onClick={handlePlay}
      size="sm"
      type="button"
      variant="secondary"
    >
      {state === "loading" ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : (
        <PlayIcon className="size-4" />
      )}
      {state === "loading"
        ? t("actions.loading")
        : t("whatsapp.calls.card.play")}
    </Button>
  )
}
