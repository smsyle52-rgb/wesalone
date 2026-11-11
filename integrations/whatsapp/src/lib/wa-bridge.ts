import {
  contentTypes,
  getWhatsappCallPermissionRequest,
  isMessageProductEntity,
  isWaBridgeWorkspace,
  isWaServiceWindowClosed,
  type OutgoingContact,
  type OutgoingMessage,
  type OutgoingSendResult,
  toWaBridgeSourceId,
  WA_CLOUD_API_MAX_MEDIA_BYTES,
} from "@chatbotx.io/sdk"
import { logger } from "./logger"

/**
 * Wesal: sends an agent's inbox message through the WhatsApp Web bridge
 * (`wa-bridge` container) when the Cloud API cannot carry it. Returns null
 * when the message must stay on the Cloud API — the caller then sends as
 * usual. See `WA_BRIDGE_WORKSPACE_IDS` for the rules.
 */

// Long enough for the bridge to upload a 100MB video to WhatsApp.
const BRIDGE_TIMEOUT_MS = 300_000

const PHONE_DIGITS = /^\d{7,15}$/

type BridgeMedia = { url: string; mimeType: string; name?: string | null }

const hasLargeMedia = (message: OutgoingMessage): boolean =>
  (message.attachments ?? []).some(
    (attachment) =>
      attachment.fileType !== "image" &&
      Number(attachment.size) > WA_CLOUD_API_MAX_MEDIA_BYTES,
  )

/** The bridge carries plain text and file attachments only. */
const isBridgeable = (message: OutgoingMessage): boolean =>
  message.contentType === contentTypes.enum.text &&
  !isMessageProductEntity(message.contentAttributes) &&
  !getWhatsappCallPermissionRequest(message.contentAttributes) &&
  Boolean(message.text?.trim() || message.attachments?.length)

export const shouldUseWaBridge = (props: {
  contact: OutgoingContact
  message: OutgoingMessage
  sendFrom?: "inbox"
}): boolean => {
  const { contact, message, sendFrom } = props
  if (sendFrom !== "inbox") {
    return false
  }
  if (!isWaBridgeWorkspace(message.workspaceId)) {
    return false
  }
  if (!(process.env.WA_BRIDGE_URL && process.env.WA_BRIDGE_TOKEN)) {
    return false
  }
  if (!PHONE_DIGITS.test(contact.sourceId ?? "")) {
    return false
  }
  if (!isBridgeable(message)) {
    return false
  }
  return (
    isWaServiceWindowClosed(contact.lastIncomingMessageAt) ||
    hasLargeMedia(message)
  )
}

export const sendViaWaBridge = async (props: {
  contact: OutgoingContact
  message: OutgoingMessage
  /** The inbox's own number (display form is fine); the bridge prefers it. */
  fromPhoneNumber?: string | null
}): Promise<OutgoingSendResult> => {
  const { contact, message, fromPhoneNumber } = props
  const from = (fromPhoneNumber ?? "").replace(/\D/g, "")
  const media: BridgeMedia[] = (message.attachments ?? [])
    .filter((attachment) => Boolean(attachment.url))
    .map((attachment) => ({
      url: attachment.url,
      mimeType: attachment.mimeType,
      name: attachment.name ?? null,
    }))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${process.env.WA_BRIDGE_URL}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bridge-token": process.env.WA_BRIDGE_TOKEN ?? "",
      },
      body: JSON.stringify({
        workspaceId: message.workspaceId,
        to: contact.sourceId,
        from: from || undefined,
        text: message.text ?? "",
        media,
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  const body = (await response.json().catch(() => ({}))) as {
    ids?: string[]
    from?: string
    error?: string
  }
  if (!response.ok) {
    logger.error(
      { status: response.status, error: body.error, messageId: message.id },
      "wa-bridge send failed",
    )
    throw new Error(`WhatsApp Web: ${body.error ?? `HTTP ${response.status}`}`)
  }

  // `wab.<key id>` lets the coexistence echo of this message (a `wamid.`
  // wrapping the same key id) merge into this row instead of duplicating it.
  const messageIds = (body.ids ?? []).map(toWaBridgeSourceId)
  logger.info(
    { messageId: message.id, count: messageIds.length, from: body.from },
    "wa-bridge send ok",
  )
  return { messageIds, sentCount: messageIds.length }
}
