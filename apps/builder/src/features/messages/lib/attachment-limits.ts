/**
 * Size caps for files an agent attaches in the inbox composer.
 *
 * Images stay at 5MB (WhatsApp's own image cap). Everything else — video,
 * audio, documents — goes up to 16MB, WhatsApp's cap for video and audio and
 * well inside its 100MB document cap. 16MB also keeps the whole request under
 * the server-action and proxy body limits set in `next.config.ts` (20MB).
 */
export const MAX_IMAGE_ATTACHMENT_MB = 5
export const MAX_OTHER_ATTACHMENT_MB = 16

const MB = 1000 * 1000

export const maxAttachmentBytes = (mimeType: string): number =>
  mimeType.startsWith("image/")
    ? MAX_IMAGE_ATTACHMENT_MB * MB
    : MAX_OTHER_ATTACHMENT_MB * MB

export const maxAttachmentMb = (mimeType: string): number =>
  mimeType.startsWith("image/")
    ? MAX_IMAGE_ATTACHMENT_MB
    : MAX_OTHER_ATTACHMENT_MB

export const isWithinAttachmentLimit = (file: {
  size: number
  type: string
}): boolean => file.size <= maxAttachmentBytes(file.type)

export const ATTACHMENT_LIMIT_MESSAGE = `Images can be up to ${MAX_IMAGE_ATTACHMENT_MB}MB; video, audio and documents up to ${MAX_OTHER_ATTACHMENT_MB}MB.`
