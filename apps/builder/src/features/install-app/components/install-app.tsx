"use client"

import { Button, buttonVariants } from "@chatbotx.io/ui/components/ui/button"
import { useTranslations } from "next-intl"
import { type ReactNode, useEffect, useState } from "react"

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

type Platform = "ios" | "android" | "other"

const IOS_UA = /iPad|iPhone|iPod/
const ANDROID_UA = /Android/

const detectPlatform = (): Platform => {
  const ua = navigator.userAgent
  if (IOS_UA.test(ua)) {
    return "ios"
  }
  return ANDROID_UA.test(ua) ? "android" : "other"
}

const isInstalled = (): boolean =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

export function InstallApp() {
  const t = useTranslations("installApp")
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [platform, setPlatform] = useState<Platform>("other")
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    setPlatform(detectPlatform())
    setInstalled(isInstalled())
    // The browser only offers installation once the service worker is active.
    navigator.serviceWorker?.register("/wesal-sw.js").catch(() => undefined)
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPrompt(event as InstallPromptEvent)
    }
    const onInstalled = () => setInstalled(true)
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  const install = async () => {
    if (!prompt) {
      return
    }
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === "accepted") {
      setInstalled(true)
    }
    setPrompt(null)
  }

  const ios = platform === "ios"
  let body: ReactNode
  if (installed) {
    body = (
      <div className="mt-6 space-y-3">
        <p className="font-medium text-green-700">{t("installed")}</p>
        <a
          className={buttonVariants({ size: "lg", className: "w-full" })}
          href="/"
        >
          {t("open")}
        </a>
      </div>
    )
  } else if (prompt) {
    body = (
      <Button className="mt-6 h-14 w-full text-lg" onClick={install} size="lg">
        {t("install")}
      </Button>
    )
  } else {
    body = (
      <div className="mt-6 space-y-3 text-start">
        <p className="font-medium">{ios ? t("iosTitle") : t("manualTitle")}</p>
        <ol className="list-decimal space-y-2 ps-5 text-sm leading-6">
          <li>{ios ? t("iosStep1") : t("manualStep1")}</li>
          <li>{ios ? t("iosStep2") : t("manualStep2")}</li>
          <li>{ios ? t("iosStep3") : t("manualStep3")}</li>
        </ol>
      </div>
    )
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm">
        {/* biome-ignore lint/performance/noImgElement: static app icon on a public page */}
        <img
          alt=""
          className="mx-auto size-20 rounded-2xl"
          height={80}
          src="/brand/favicon/web-app-manifest-192x192.png"
          width={80}
        />
        <h1 className="mt-4 font-bold text-2xl">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>

        {body}

        <p className="mt-6 text-muted-foreground text-xs">
          {t("afterInstall")}
        </p>
      </div>
    </main>
  )
}
