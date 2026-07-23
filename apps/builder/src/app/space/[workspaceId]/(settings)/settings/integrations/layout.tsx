"use client"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@chatbotx.io/ui/components/ui/accordion"
import { SiFacebook } from "@icons-pack/react-simple-icons"
import { CodeIcon, MailIcon, TableIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import type { ReactNode } from "react"

// BYOK AI provider slots (openAI/gemini/claude/deepSeek/openRouter/
// openaiCompatible) are deliberately not rendered here: the platform now
// runs a single internal Vertex AI provider (see platform-ai settings)
// instead of per-workspace bring-your-own-key AI credentials.
type SettingIntegrationLayoutProps = {
  children?: ReactNode
  workspaceToken?: ReactNode
  googleSheets?: ReactNode
  facebookAds?: ReactNode
  activeCampaign?: ReactNode
  getResponse?: ReactNode
  mailchimp?: ReactNode
  mailerLite?: ReactNode
  moosend?: ReactNode
  drip?: ReactNode
  sendGrid?: ReactNode
  klaviyo?: ReactNode
}

export default function SettingIntegrationLayout({
  workspaceToken,
  googleSheets,
  facebookAds,
  activeCampaign,
  getResponse,
  mailchimp,
  mailerLite,
  moosend,
  drip,
  sendGrid,
  klaviyo,
}: SettingIntegrationLayoutProps) {
  const t = useTranslations()

  const integrationItems = [
    {
      keyName: t("workspaceToken.title"),
      icon: CodeIcon,
      content: workspaceToken,
    },
    {
      keyName: t("googleSheets.title"),
      icon: TableIcon,
      content: googleSheets,
    },
    {
      keyName: t("facebookAds.title"),
      icon: SiFacebook,
      content: facebookAds,
    },
    {
      keyName: t("activeCampaign.title"),
      icon: MailIcon,
      content: activeCampaign,
    },
    {
      keyName: t("getResponse.title"),
      icon: MailIcon,
      content: getResponse,
    },
    {
      keyName: t("mailchimp.title"),
      icon: MailIcon,
      content: mailchimp,
    },
    {
      keyName: t("mailerLite.title"),
      icon: MailIcon,
      content: mailerLite,
    },
    {
      keyName: t("moosend.title"),
      icon: MailIcon,
      content: moosend,
    },
    {
      keyName: t("drip.title"),
      icon: MailIcon,
      content: drip,
    },
    {
      keyName: t("sendGrid.title"),
      icon: MailIcon,
      content: sendGrid,
    },
    {
      keyName: t("klaviyo.title"),
      icon: MailIcon,
      content: klaviyo,
    },
  ]

  return (
    <Accordion className="w-full" collapsible type="single">
      {integrationItems.map((integration) => (
        <AccordionItem
          className="transition-all hover:data-[state=open]:rounded-none"
          key={integration.keyName}
          value={integration.keyName}
        >
          <AccordionTrigger className="rounded-none px-4 transition-all hover:bg-muted hover:no-underline data-[state=open]:bg-muted">
            <div className="flex items-center gap-2">
              <integration.icon size={24} />
              {integration.keyName}
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-4">
            {integration.content}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
