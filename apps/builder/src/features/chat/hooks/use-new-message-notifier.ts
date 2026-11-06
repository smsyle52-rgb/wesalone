"use client"

import { useTranslations } from "next-intl"
import { useContext, useEffect, useRef } from "react"
import type { MessageResourceWithRelations } from "@/features/messages/schema/resource"
import { ChatStoreContext } from "../store/chat-store-provider"

const BODY_PREVIEW_LENGTH = 120

/**
 * Plays a short two-tone chime. Built with the Web Audio API so no sound file
 * ships with the app. Browsers only allow audio after the agent has interacted
 * with the page once, so a blocked chime is skipped silently.
 */
function playChime(context: AudioContext | null): void {
  if (!context) {
    return
  }
  try {
    const now = context.currentTime
    for (const [offset, frequency] of [
      [0, 880],
      [0.16, 1320],
    ] as const) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = "sine"
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.14)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(now + offset)
      oscillator.stop(now + offset + 0.15)
    }
  } catch {
    // Audio is a nicety; never let it break message handling.
  }
}

const isPageInFocus = (): boolean =>
  typeof document !== "undefined" &&
  document.visibilityState === "visible" &&
  document.hasFocus()

/**
 * Alerts the agent about new customer messages while the inbox is open:
 * a chime always, plus a system notification when the tab is in the
 * background. Only runs for members who turned on "New message to human"
 * with the "Browser" channel. Messages in conversations the bot is handling,
 * and in the conversation the agent is already reading, are skipped. The
 * realtime socket already limits "assigned contacts only" members to their
 * own conversations, so they are never alerted about anyone else's chats.
 */
export function useNewMessageNotifier(enabled: boolean) {
  const t = useTranslations()
  const store = useContext(ChatStoreContext)
  const audioContextRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return
    }
    // Permission prompts and audio both need a user gesture in most
    // browsers, so arm them on the agent's first click in the page.
    const arm = () => {
      try {
        audioContextRef.current ??= new AudioContext()
        if (audioContextRef.current.state === "suspended") {
          audioContextRef.current.resume().catch(() => undefined)
        }
      } catch {
        audioContextRef.current = null
      }
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => undefined)
      }
    }
    document.addEventListener("pointerdown", arm, { once: true })
    return () => document.removeEventListener("pointerdown", arm)
  }, [enabled])

  return (messages: MessageResourceWithRelations[]): void => {
    if (!(enabled && store)) {
      return
    }
    const { conversations, activeConversationId } = store.getState()
    const focused = isPageInFocus()
    const toAlert = messages.filter((message) => {
      if (message.messageType !== "incoming") {
        return false
      }
      if (focused && message.conversationId === activeConversationId) {
        return false
      }
      const conversation = conversations.find(
        (item) => item.id === message.conversationId,
      )
      // Unknown (brand-new) conversations alert; bot-handled ones do not.
      return conversation?.botEnabled !== true
    })
    if (toAlert.length === 0) {
      return
    }

    playChime(audioContextRef.current)

    if (
      focused ||
      typeof window === "undefined" ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) {
      return
    }
    const title = t("fields.notificationType.newMessageToHuman")
    for (const message of toAlert) {
      const name = message.contact?.fullName?.trim()
      const preview = (message.text ?? "").trim().slice(0, BODY_PREVIEW_LENGTH)
      try {
        const notification = new Notification(title, {
          body: [name, preview].filter(Boolean).join(": ") || undefined,
          // One notification per conversation: a burst replaces, not stacks.
          tag: `wesal-conversation-${message.conversationId}`,
        })
        notification.onclick = () => {
          window.focus()
          notification.close()
        }
      } catch {
        // Some browsers only allow notifications from a service worker.
      }
    }
  }
}
