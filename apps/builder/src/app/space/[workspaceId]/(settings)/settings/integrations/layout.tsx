import type { ReactNode } from "react"
import { IntegrationsAccordionShell } from "./integrations-accordion-shell"

// BYOK AI provider slots (openAI/gemini/claude/deepSeek/openRouter/
// openaiCompatible) are deliberately not rendered here: the platform now
// runs a single internal Vertex AI provider (see platform-ai settings)
// instead of per-workspace bring-your-own-key AI credentials.
type SettingIntegrationLayoutProps = {
  children?: ReactNode
}

// Server shell: rows come from INTEGRATION_SETTINGS_REGISTRY; the active
// provider's page renders as {children} inside its accordion panel. Visiting
// /settings/integrations executes zero provider pages (index) or exactly one
// (open panel) — previously all 18 parallel-route slots ran server-side on
// every visit.
export default function SettingIntegrationLayout({
  children,
}: SettingIntegrationLayoutProps) {
  return <IntegrationsAccordionShell>{children}</IntegrationsAccordionShell>
}
