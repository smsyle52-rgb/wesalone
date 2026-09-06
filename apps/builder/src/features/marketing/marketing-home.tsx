import { getLocale } from "next-intl/server"
import WesalSourceMarketingPage from "./wesal-source-marketing-page"

/**
 * One landing page for every visitor.
 *
 * Arabic used to get the Wesal design and every other locale got
 * `marketing-home-default` — a different layout with different copy, so a
 * reviewer switching to English saw a product they could not recognise. That
 * file is left in place because it comes from upstream and touching it makes
 * every future merge harder; it simply is not rendered any more.
 */
export async function MarketingHome() {
  const locale = await getLocale()

  return <WesalSourceMarketingPage lang={locale === "ar" ? "ar" : "en"} />
}
