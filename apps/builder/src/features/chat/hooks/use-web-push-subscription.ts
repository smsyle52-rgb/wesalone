"use client"

import { useEffect } from "react"
import { client } from "@/lib/orpc/orpc"

const SERVICE_WORKER_URL = "/wesal-sw.js"

/** VAPID keys are URL-safe base64; PushManager wants the raw bytes. */
export const decodeVapidKey = (base64Url: string): Uint8Array<ArrayBuffer> => {
  const padded = `${base64Url}${"=".repeat((4 - (base64Url.length % 4)) % 4)}`
  const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const sameKey = (
  current: ArrayBuffer | null | undefined,
  expected: Uint8Array,
): boolean => {
  if (!current) {
    return false
  }
  const bytes = new Uint8Array(current)
  return (
    bytes.length === expected.length &&
    bytes.every((value, index) => value === expected[index])
  )
}

const isSupported = (): boolean =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window

async function subscribe(publicKey: string, workspaceId: string) {
  if (Notification.permission !== "granted") {
    return
  }
  const registration = await navigator.serviceWorker.register(
    SERVICE_WORKER_URL,
    { scope: "/" },
  )
  await navigator.serviceWorker.ready
  const applicationServerKey = decodeVapidKey(publicKey)
  let subscription = await registration.pushManager.getSubscription()
  // A subscription made for another server key can never be delivered to.
  if (
    subscription &&
    !sameKey(subscription.options.applicationServerKey, applicationServerKey)
  ) {
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  })
  await client.deviceTokensAPI.registerDeviceTokenAPI({
    platform: "web",
    token: JSON.stringify(subscription.toJSON()),
    workspaceId,
  })
}

/**
 * Subscribes this browser to Web Push so new-message alerts reach the agent
 * even when the inbox tab (or the installed app) is closed. Runs only for
 * members who turned on browser notifications; the permission prompt needs a
 * user gesture, so it is asked on the agent's first click in the page.
 */
export function useWebPushSubscription(props: {
  enabled: boolean
  publicKey: string | undefined
  workspaceId: string
}) {
  const { enabled, publicKey, workspaceId } = props

  useEffect(() => {
    if (!(enabled && publicKey && workspaceId && isSupported())) {
      return
    }
    const run = () => {
      subscribe(publicKey, workspaceId).catch(() => undefined)
    }
    run()

    const onFirstClick = () => {
      if (Notification.permission !== "default") {
        return
      }
      Notification.requestPermission()
        .then((permission) => {
          if (permission === "granted") {
            run()
          }
        })
        .catch(() => undefined)
    }
    document.addEventListener("pointerdown", onFirstClick, { once: true })
    return () => document.removeEventListener("pointerdown", onFirstClick)
  }, [enabled, publicKey, workspaceId])
}
