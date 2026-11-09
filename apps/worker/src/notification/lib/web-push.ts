import webpush from "web-push"
import { env } from "../../env"
import { logger } from "../../lib/logger"

let configured: boolean | undefined

/**
 * Configures the VAPID keys once. Returns false (and logs once) when the keys
 * are not set — browser push is opt-in infrastructure, like Expo push.
 */
export const isWebPushConfigured = (): boolean => {
  if (configured !== undefined) {
    return configured
  }
  if (!(env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY)) {
    logger.info("WEB_PUSH_VAPID_* not set — browser push disabled")
    configured = false
    return configured
  }
  webpush.setVapidDetails(
    env.WEB_PUSH_SUBJECT,
    env.WEB_PUSH_VAPID_PUBLIC_KEY,
    env.WEB_PUSH_VAPID_PRIVATE_KEY,
  )
  configured = true
  return configured
}

export type WebPushPayload = {
  title: string
  body: string
  /** Page the notification opens, relative to the site root. */
  url: string
  /** Notifications with the same tag replace each other (one per chat). */
  tag: string
}

export type WebPushResult = "sent" | "gone" | "failed"

type StoredSubscription = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Parses a stored token; null when it is not a usable PushSubscription. */
export const parseWebPushSubscription = (
  token: string,
): StoredSubscription | null => {
  try {
    const value = JSON.parse(token) as Partial<StoredSubscription>
    if (
      typeof value.endpoint === "string" &&
      value.endpoint.startsWith("https://") &&
      typeof value.keys?.p256dh === "string" &&
      typeof value.keys?.auth === "string"
    ) {
      return {
        endpoint: value.endpoint,
        keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
      }
    }
  } catch {
    // Not JSON: treated as unusable below.
  }
  return null
}

/** Push services answer 404/410 once a subscription has been revoked. */
const GONE_STATUS_CODES = new Set([404, 410])

export const sendWebPush = async (
  subscription: StoredSubscription,
  payload: WebPushPayload,
): Promise<WebPushResult> => {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 60 * 60,
      urgency: "high",
    })
    return "sent"
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode
    if (statusCode && GONE_STATUS_CODES.has(statusCode)) {
      return "gone"
    }
    logger.warn({ err, statusCode }, "web push send failed")
    return "failed"
  }
}
