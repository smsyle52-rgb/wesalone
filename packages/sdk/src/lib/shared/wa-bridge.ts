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
