import { SdkException, UNKNOWN_ERROR } from "./exception"
import type { ParsedError } from "./schemas"

export function guessFileTypeFromMimeType(mimeType: string) {
  const prefix = mimeType.split("/")[0]

  switch (prefix) {
    case "image":
    case "video":
    case "audio":
      return prefix
    default:
      return "file"
  }
}

/**
 * The attachment kinds Meta and Zalo declare in the webhook itself, mapped onto
 * our `FileType`. Kinds with no media of their own (`location`, `share`,
 * `story_mention`, `template`, `fallback`) are absent on purpose — they fall
 * through to whatever the download header says.
 */
const DECLARED_ATTACHMENT_FILE_TYPES: Record<
  string,
  "audio" | "file" | "image" | "video"
> = {
  audio: "audio",
  file: "file",
  ig_reel: "video",
  image: "image",
  reel: "video",
  sticker: "image",
  video: "video",
}

const DEFAULT_MIME_TYPE_BY_FILE_TYPE: Record<string, string> = {
  audio: "audio/mpeg",
  file: "application/octet-stream",
  image: "image/png",
  video: "video/mp4",
}

/**
 * Types an inbound attachment, preferring the channel's own declared kind over
 * a generic download header.
 *
 * Messenger, Instagram and Zalo all type an attachment by fetching its CDN URL
 * and reading the response `content-type`. Meta serves voice clips as
 * `application/octet-stream`, so `guessFileTypeFromMimeType` filed every one of
 * them as `file` — and the automated-response handler only transcribes an
 * attachment whose `fileType` is `audio`, so no Instagram voice note has ever
 * reached speech-to-text. Measured on production 8 Sep 2026: 178 Instagram
 * attachments stored as `file`/`application/octet-stream` over seven days and
 * **zero** as `audio`, against 4,789 correctly typed WhatsApp voice notes —
 * WhatsApp carries `mime_type` in the webhook payload and never has to guess.
 *
 * The webhook already tells us the kind (`attachment.type`), so use it whenever
 * the header is missing or too generic to be informative.
 */
export function resolveIncomingFileType(
  headerMimeType: string | null | undefined,
  declaredType: string | null | undefined,
) {
  const declared = declaredType
    ? DECLARED_ATTACHMENT_FILE_TYPES[declaredType]
    : undefined

  if (!headerMimeType) {
    return declared ?? "file"
  }

  const guessed = guessFileTypeFromMimeType(headerMimeType)
  // `guessed === "file"` covers both `application/octet-stream` and any other
  // non-media content type the CDN returns for real media.
  return guessed === "file" ? (declared ?? guessed) : guessed
}

/**
 * The mime type to store when the CDN sent no `content-type` at all. These call
 * sites used to default to `image/png` unconditionally, which labelled a
 * headerless voice note as an image in the inbox and uploaded it to storage
 * under that content type.
 */
export function defaultMimeTypeForFileType(fileType: string) {
  return DEFAULT_MIME_TYPE_BY_FILE_TYPE[fileType] ?? "application/octet-stream"
}

export async function parseSdkError(
  error: Error | SdkException | unknown,
): Promise<ParsedError> {
  if (error instanceof SdkException) {
    return await error.getErrorData()
  }

  console.error("parseSdkError: Unknown error", error)

  return UNKNOWN_ERROR
}
