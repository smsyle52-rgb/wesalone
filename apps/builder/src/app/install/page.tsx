import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { InstallApp } from "@/features/install-app/components/install-app"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("installApp")
  return { title: t("title") }
}

/**
 * Wesal: a link staff open on their phone to install Wesal One as an app
 * (PWA). Public, so it works before signing in. UI-only plumbing — exempt
 * from the public-API rule (AGENTS.md invariant 23).
 */
export default function InstallPage() {
  return <InstallApp />
}
