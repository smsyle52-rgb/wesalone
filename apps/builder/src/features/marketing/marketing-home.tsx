import { getLocale } from "next-intl/server"
import { MarketingHome as DefaultMarketingHome } from "./marketing-home-default"
import WesalSourceMarketingPage from "./wesal-source-marketing-page"

export async function MarketingHome() {
  const locale = await getLocale()

  if (locale === "ar") {
    return <WesalSourceMarketingPage />
  }

  return <DefaultMarketingHome />
}
