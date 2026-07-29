import type { ChannelType } from "@chatbotx.io/database/partials"

/**
 * Channels this deployment does not offer.
 *
 * Zalo is a Vietnamese messenger inherited from upstream ChatbotX. Wesal One
 * serves Arabic-speaking merchants, none of whom use it, and it was surfacing
 * as a permanently greyed-out option in the channel picker plus an empty tab
 * in channel settings.
 *
 * Hidden, not removed: the integration, its webhooks, and its settings code
 * all stay in place so an upstream sync does not conflict, and so any existing
 * connection keeps working. Delete an entry here to offer the channel again.
 */
export const HIDDEN_CHANNELS: readonly ChannelType[] = ["zalo"]

export function isHiddenChannel(channel: ChannelType): boolean {
  return HIDDEN_CHANNELS.includes(channel)
}
