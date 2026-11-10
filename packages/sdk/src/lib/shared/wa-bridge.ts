/**
 * Wesal: workspaces whose inbox may send WhatsApp messages through the
 * WhatsApp Web bridge (a linked device of the number's WhatsApp Business app)
 * instead of the Cloud API. Only an agent's own inbox message takes that route,
 * and only when the Cloud API cannot carry it: the 24-hour customer-service
 * window is closed, or a video is larger than the Cloud API's 16MB cap.
 *
 * Everything else — replies inside the window, bot replies, flows, templates,
 * broadcasts — stays on the official Cloud API (coexistence) unchanged.
 */
export const WA_BRIDGE_WORKSPACE_IDS: readonly string[] = [
  "11767468508764852",
  "11617037325598720",
]

export const isWaBridgeWorkspace = (
  workspaceId: string | null | undefined,
): boolean =>
  Boolean(workspaceId) && WA_BRIDGE_WORKSPACE_IDS.includes(String(workspaceId))

/**
 * A message the bridge sends is stored with sourceId `wab.<key id>`, where the
 * key id is WhatsApp's own message id (the last part of whatsapp-web.js's
 * `true_<chat>_<key id>`). The Cloud API echo of that same message arrives
 * later with a `wamid.` that wraps the same key id, so the coexistence import
 * can find the bridge row and adopt the wamid instead of adding a duplicate.
 */
export const WA_BRIDGE_SOURCE_ID_PREFIX = "wab."

const BRIDGE_ID = /^(?:true|false)_[^_]+_([A-Za-z0-9]+)/
const KEY_ID = /^[A-Za-z0-9]{8,64}$/

export const toWaBridgeSourceId = (bridgeId: string): string => {
  const keyId = BRIDGE_ID.exec(bridgeId)?.[1]
  return keyId ? `${WA_BRIDGE_SOURCE_ID_PREFIX}${keyId}` : bridgeId
}

/**
 * The WhatsApp key id inside a Cloud API `wamid.` (base64 of a Thrift-compact
 * struct: the chat id first, the key id last). Null when it does not parse.
 */
export const wamidKeyId = (wamid: string): string | null => {
  if (!wamid.startsWith("wamid.")) {
    return null
  }
  let decoded: string
  try {
    decoded = Buffer.from(wamid.slice(6), "base64").toString("latin1")
  } catch {
    return null
  }
  const runs = decoded.match(/[A-Za-z0-9]{8,64}/g)
  const last = runs?.at(-1)
  return last && KEY_ID.test(last) ? last : null
}

/** Cloud API caps video and audio at 16MB. */
export const WA_CLOUD_API_MAX_MEDIA_BYTES = 16 * 1000 * 1000

/** Bridge workspaces may attach video, audio and documents up to 32MB. */
export const WA_BRIDGE_MAX_ATTACHMENT_MB = 32

/** A little under 24h so a send racing the boundary never hits Meta's 131047. */
export const WA_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000 - 5 * 60 * 1000

export const isWaServiceWindowClosed = (
  lastIncomingMessageAt: Date | string | null | undefined,
  now = Date.now(),
): boolean => {
  if (!lastIncomingMessageAt) {
    return true
  }
  const ts = new Date(lastIncomingMessageAt).getTime()
  if (!Number.isFinite(ts)) {
    return true
  }
  return now - ts > WA_SERVICE_WINDOW_MS
}
