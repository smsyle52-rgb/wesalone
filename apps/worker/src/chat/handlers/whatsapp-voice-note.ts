import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { uploader } from "@chatbotx.io/filesystem"
import { logger } from "../../lib/logger"

/**
 * WhatsApp only delivers Ogg/Opus reliably as a voice note. Safari's
 * MediaRecorder produces fragmented MP4/AAC, which WhatsApp rejects with
 * error 131053 ("Media upload error") — the agent sees the message as sent
 * while the customer never receives it. Before a WhatsApp send, any audio
 * attachment that is not already Ogg/Opus is transcoded with ffmpeg into an
 * Ogg/Opus copy next to the original object, and the outgoing message points
 * at that copy. The stored attachment row is left untouched, so the inbox
 * keeps playing the original recording.
 *
 * Every failure (ffmpeg missing, unreadable input, storage error) falls back
 * to the original attachment, i.e. the behavior before this transcode existed.
 */

const FFMPEG_TIMEOUT_MS = 30_000
const MAX_INPUT_BYTES = 16 * 1024 * 1024
const MAX_STDERR_CHARS = 2000
export const VOICE_NOTE_SUFFIX = "-voice.ogg"

type AudioAttachmentLike = {
  fileType?: string | null
  mimeType?: string | null
  url?: string | null
  originPath?: string | null
}

function baseMimeType(mimeType?: string | null): string {
  return (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
}

/** True for audio that WhatsApp would not accept as a voice note. */
export function needsVoiceNoteTranscode(
  attachment: AudioAttachmentLike,
): boolean {
  if (attachment.fileType !== "audio") {
    return false
  }
  const base = baseMimeType(attachment.mimeType)
  if (base === "audio/ogg" || base === "audio/opus") {
    return false
  }
  return Boolean(
    attachment.originPath && attachment.url?.includes(attachment.originPath),
  )
}

/** The public URL of the transcoded copy, derived from the original URL. */
export function voiceNoteUrl(url: string, originPath: string): string {
  return url.replace(originPath, `${originPath}${VOICE_NOTE_SUFFIX}`)
}

function runFfmpeg(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        input,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "libopus",
        "-b:a",
        "32k",
        "-application",
        "voip",
        "-f",
        "ogg",
        output,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    )
    let stderr = ""
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_CHARS) {
        stderr += chunk.toString()
      }
    })
    const timer = setTimeout(() => child.kill("SIGKILL"), FFMPEG_TIMEOUT_MS)
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve()
      } else {
        reject(
          new Error(
            `ffmpeg exited with ${code}: ${stderr.slice(0, MAX_STDERR_CHARS)}`,
          ),
        )
      }
    })
  })
}

async function transcodeToVoiceNote<T extends AudioAttachmentLike>(
  attachment: T & { originPath: string; url: string },
): Promise<T> {
  const source = await uploader.getObject(attachment.originPath)
  if (source.byteLength > MAX_INPUT_BYTES) {
    throw new Error(`Audio too large to transcode (${source.byteLength} bytes)`)
  }

  const dir = await mkdtemp(join(tmpdir(), "wa-voice-"))
  try {
    const input = join(dir, "input")
    const output = join(dir, "output.ogg")
    await writeFile(input, source)
    await runFfmpeg(input, output)
    const ogg = await readFile(output)

    const path = `${attachment.originPath}${VOICE_NOTE_SUFFIX}`
    await uploader.putObject(path, ogg, {
      ACL: "public-read",
      ContentLength: ogg.byteLength,
      ContentType: "audio/ogg",
    })

    return {
      ...attachment,
      mimeType: "audio/ogg",
      url: voiceNoteUrl(attachment.url, attachment.originPath),
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Returns the message with every non-Ogg audio attachment replaced by an
 * Ogg/Opus copy for the WhatsApp send. Never throws.
 *
 * The queued message type does not declare `attachments` (they are added by
 * the producer at runtime), so the input is accepted as any object.
 */
export async function withWhatsappVoiceNotes<T extends object>(
  message: T,
): Promise<T> {
  const attachments = (
    message as { attachments?: AudioAttachmentLike[] | null }
  ).attachments
  if (!(attachments?.length && attachments.some(needsVoiceNoteTranscode))) {
    return message
  }

  const converted = await Promise.all(
    attachments.map(async (attachment) => {
      if (!needsVoiceNoteTranscode(attachment)) {
        return attachment
      }
      try {
        return await transcodeToVoiceNote(
          attachment as typeof attachment & { originPath: string; url: string },
        )
      } catch (error) {
        logger.warn(
          { err: error, originPath: attachment.originPath },
          "Voice note transcode failed; sending the original audio",
        )
        return attachment
      }
    }),
  )

  return { ...message, attachments: converted } as T
}
