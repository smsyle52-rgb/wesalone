import { SiFacebook, SiMake } from "@icons-pack/react-simple-icons"
import { CodeIcon, MailIcon, TableIcon } from "lucide-react"
import type { ComponentType } from "react"

/**
 * Ordered registry of the workspace-settings integration providers, following
 * the `CHANNEL_CAPABILITIES` pattern in `@chatbotx.io/utils`.
 *
 * `slug` is the single source of truth for BOTH the route directory name
 * (`settings/integrations/<slug>/page.tsx`) and the accordion's active-segment
 * matching (`useSelectedLayoutSegment()`), so a mismatch between a row and its
 * page cannot silently happen — the row simply 404s. Adding a provider means
 * adding one entry here plus one `page.tsx`; the shared settings route no
 * longer grows with each provider.
 *
 * `titleKey` values are existing message keys in `apps/builder/messages/*` —
 * do not add new keys here without adding the translations first.
 */
export type IntegrationSettingsEntry = {
  /** Kebab-case route segment under `settings/integrations/`. */
  slug: string
  /** `next-intl` message key for the row title (must already exist). */
  titleKey: string
  icon: ComponentType<{ size?: number | string }>
}

export const INTEGRATION_SETTINGS_REGISTRY: readonly IntegrationSettingsEntry[] =
  [
    {
      slug: "workspace-token",
      titleKey: "workspaceToken.title",
      icon: CodeIcon,
    },
    // The six bring-your-own-key AI provider rows (openai, gemini, claude,
    // deepseek, openrouter, openai-compatible) are intentionally absent: the
    // platform serves every workspace from its own AI provider, so asking a
    // merchant for an API key offers them a setup that cannot help and a bill
    // they should not pay. The layout comment above this registry already
    // described this as the intended behaviour; the rows simply outlived it.
    // Their route directories are left in place so re-enabling is one commit.
    { slug: "google-sheets", titleKey: "googleSheets.title", icon: TableIcon },
    { slug: "facebook-ads", titleKey: "facebookAds.title", icon: SiFacebook },
    { slug: "make", titleKey: "make.title", icon: SiMake },
    {
      slug: "active-campaign",
      titleKey: "activeCampaign.title",
      icon: MailIcon,
    },
    { slug: "get-response", titleKey: "getResponse.title", icon: MailIcon },
    { slug: "mailchimp", titleKey: "mailchimp.title", icon: MailIcon },
    { slug: "mailer-lite", titleKey: "mailerLite.title", icon: MailIcon },
    { slug: "moosend", titleKey: "moosend.title", icon: MailIcon },
    { slug: "drip", titleKey: "drip.title", icon: MailIcon },
    { slug: "sendgrid", titleKey: "sendGrid.title", icon: MailIcon },
    { slug: "klaviyo", titleKey: "klaviyo.title", icon: MailIcon },
  ]
