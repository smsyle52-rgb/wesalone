import { WA_BRIDGE_MAX_ATTACHMENT_MB } from "@chatbotx.io/sdk"

/**
 * Size caps for files an agent attaches in the inbox composer.
 *
 * Images stay at 5MB (WhatsApp's own image cap). Everything else — video,
 * audio, documents — goes up to 16MB, WhatsApp's cap for video and audio and
 * well inside its 100MB document cap.
 *
 * Wesal: WhatsApp Web bridge workspaces (`WA_BRIDGE_WORKSPACE_IDS`) may attach
 * up to 32MB; the worker sends those over the bridge, which has no 16MB cap.
 * The server-side schema therefore accepts the larger cap for every request
 * (it cannot see the workspace); the composer applies the per-workspace one.
 * Both stay under the server-action and proxy body limits in `next.config.ts`
 * (40MB).
 */
export const MAX_IMAGE_ATTACHMENT_MB = 5
export const MAX_OTHER_ATTACHMENT_MB = 16
export const MAX_BRIDGE_ATTACHMENT_MB = WA_BRIDGE_MAX_ATTACHMENT_MB

const MB = 1000 * 1000

export const maxAttachmentBytes = (
  mimeType: string,
  maxOtherMb: number = MAX_OTHER_ATTACHMENT_MB,
): number =>
  mimeType.startsWith("image/") ? MAX_IMAGE_ATTACHMENT_MB * MB : maxOtherMb * MB

export const maxAttachmentMb = (
  mimeType: string,
  maxOtherMb: number = MAX_OTHER_ATTACHMENT_MB,
): number =>
  mimeType.startsWith("image/") ? MAX_IMAGE_ATTACHMENT_MB : maxOtherMb

export const isWithinAttachmentLimit = (
  file: {
    size: number
    type: string
  },
  maxOtherMb: number = MAX_OTHER_ATTACHMENT_MB,
): boolean => file.size <= maxAttachmentBytes(file.type, maxOtherMb)

/** Server-side ceiling: the largest cap any workspace may use. */
export const isWithinServerAttachmentLimit = (file: {
  size: number
  type: string
}): boolean => isWithinAttachmentLimit(file, MAX_BRIDGE_ATTACHMENT_MB)

export const ATTACHMENT_LIMIT_MESSAGE = `Images can be up to ${MAX_IMAGE_ATTACHMENT_MB}MB; video, audio and documents up to ${MAX_OTHER_ATTACHMENT_MB}MB (${MAX_BRIDGE_ATTACHMENT_MB}MB on WhatsApp Web workspaces).`
