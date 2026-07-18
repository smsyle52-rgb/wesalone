import {
  resolveTenantSettingsByDomain,
  type TenantSettings,
} from "@chatbotx.io/business"
import { getLocale } from "next-intl/server"
import { getDomainFromHeader } from "@/lib/domain"

// The default root-tenant name is set once in packages/business (framework-
// agnostic), so it can't call next-intl itself. This is the one app-layer
// seam where locale is available — override the display name for Arabic
// only when it's still the unbranded default, so a white-label tenant's own
// configured brandName (applyTenantSetting) is never clobbered.
const DEFAULT_NAME = "Wesal One"
const DEFAULT_NAME_AR = "وصال ون"

export const getTenantSettings = async (): Promise<TenantSettings> => {
  const [domain, locale] = await Promise.all([
    getDomainFromHeader(),
    getLocale(),
  ])
  const settings = await resolveTenantSettingsByDomain(domain)
  if (locale === "ar" && settings.name === DEFAULT_NAME) {
    return { ...settings, name: DEFAULT_NAME_AR }
  }
  return settings
}
