"use client"

import { Button } from "@chatbotx.io/ui/components/ui/button"
import { MicIcon, SquareIcon, XIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  pickRecordingFormat,
  type RecordingFormat,
  toVoiceNoteFile,
} from "../lib/voice-note"

/** WhatsApp voice notes are short; stop automatically after this long. */
const MAX_RECORDING_SECONDS = 5 * 60
const AUDIO_BITS_PER_SECOND = 32_000

type Recording = {
  recorder: MediaRecorder
  stream: MediaStream
  chunks: Blob[]
  format: RecordingFormat
  cancelled: boolean
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

/**
 * Mic button for the inbox composer. Records a voice note in the browser and
 * hands back a file WhatsApp plays as a voice message (Ogg/Opus), which the
 * composer then attaches like any other file.
 */
export function VoiceRecorder({
  disabled,
  onRecorded,
}: {
  disabled?: boolean
  onRecorded: (file: File) => void
}) {
  const t = useTranslations("voiceNote")
  const recordingRef = useRef<Recording | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const releaseStream = useCallback(() => {
    for (const track of recordingRef.current?.stream.getTracks() ?? []) {
      track.stop()
    }
    recordingRef.current = null
    setIsRecording(false)
    setElapsed(0)
  }, [])

  const stop = useCallback((cancel: boolean) => {
    const recording = recordingRef.current
    if (!recording) {
      return
    }
    recording.cancelled = cancel
    if (recording.recorder.state !== "inactive") {
      recording.recorder.stop()
    }
  }, [])

  // Tick the timer and enforce the length cap while recording.
  useEffect(() => {
    if (!isRecording) {
      return
    }
    const timer = setInterval(() => {
      setElapsed((value) => {
        const next = value + 1
        if (next >= MAX_RECORDING_SECONDS) {
          stop(false)
        }
        return next
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [isRecording, stop])

  // Never leave the microphone open when the composer unmounts.
  useEffect(
    () => () => {
      const recording = recordingRef.current
      if (recording) {
        recording.cancelled = true
        if (recording.recorder.state !== "inactive") {
          recording.recorder.stop()
        }
        for (const track of recording.stream.getTracks()) {
          track.stop()
        }
      }
    },
    [],
  )

  const start = useCallback(async () => {
    const format =
      typeof MediaRecorder === "undefined"
        ? null
        : pickRecordingFormat((type) => MediaRecorder.isTypeSupported(type))
    if (!(format && navigator.mediaDevices?.getUserMedia)) {
      toast.error(t("unsupported"))
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
    } catch {
      toast.error(t("micDenied"))
      return
    }

    const recorder = new MediaRecorder(stream, {
      mimeType: format.recorderMimeType,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    })
    const recording: Recording = {
      recorder,
      stream,
      chunks: [],
      format,
      cancelled: false,
    }
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recording.chunks.push(event.data)
      }
    }
    recorder.onstop = async () => {
      const { cancelled, chunks } = recording
      releaseStream()
      if (cancelled || chunks.length === 0) {
        return
      }
      try {
        const blob = new Blob(chunks, { type: format.recorderMimeType })
        onRecorded(await toVoiceNoteFile(blob, format))
      } catch {
        toast.error(t("failed"))
      }
    }

    recordingRef.current = recording
    recorder.start(250)
    setElapsed(0)
    setIsRecording(true)
  }, [onRecorded, releaseStream, t])

  if (isRecording) {
    return (
      <div className="flex items-center gap-1 rounded-full bg-destructive/10 ps-2 text-destructive">
        <span
          aria-hidden="true"
          className="size-2 animate-pulse rounded-full bg-destructive"
        />
        <span className="min-w-10 text-sm tabular-nums" role="timer">
          {formatElapsed(elapsed)}
        </span>
        <Button
          aria-label={t("cancel")}
          className="px-2 py-1.5 [&_svg]:size-5"
          onClick={() => stop(true)}
          type="button"
          variant="ghost"
        >
          <XIcon aria-hidden="true" />
        </Button>
        <Button
          aria-label={t("stop")}
          className="px-2 py-1.5 text-destructive [&_svg]:size-5"
          onClick={() => stop(false)}
          type="button"
          variant="ghost"
        >
          <SquareIcon aria-hidden="true" className="fill-current" />
        </Button>
      </div>
    )
  }

  return (
    <Button
      aria-label={t("record")}
      className="px-2 py-1.5 [&_svg]:size-5"
      disabled={disabled}
      onClick={start}
      title={t("record")}
      type="button"
      variant="ghost"
    >
      <MicIcon aria-hidden="true" />
    </Button>
  )
}
