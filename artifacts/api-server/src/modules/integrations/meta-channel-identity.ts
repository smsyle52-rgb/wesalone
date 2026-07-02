type ChannelAccountLike = {
  id: string;
  channelType: string;
  providerConfig: unknown;
  externalPhoneId?: string | null;
};

type MetaChannelIdentity = {
  phoneNumberId: string | null;
  igAccountId: string | null;
  pageId: string | null;
};

function isWhatsAppChannelType(channelType: string): boolean {
  return channelType === "whatsapp" || channelType === "whatsapp_api";
}

function providerConfigRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function configString(config: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function lookupAliasesForMetaKey(key: string): string[] {
  switch (key) {
    case "phone_number_id":
    case "phoneNumberId":
      return ["phone_number_id", "phoneNumberId"];
    case "ig_account_id":
    case "igAccountId":
      return ["ig_account_id", "igAccountId"];
    case "page_id":
    case "pageId":
      return ["page_id", "pageId"];
    case "waba_id":
    case "wabaId":
      return ["waba_id", "wabaId"];
    default:
      return [key];
  }
}

export function extractMetaChannelIdentity(account: Pick<ChannelAccountLike, "providerConfig" | "externalPhoneId">): MetaChannelIdentity {
  const config = providerConfigRecord(account.providerConfig);
  return {
    phoneNumberId: configString(config, "phone_number_id", "phoneNumberId") ?? account.externalPhoneId ?? null,
    igAccountId: configString(config, "ig_account_id", "igAccountId"),
    pageId: configString(config, "page_id", "pageId", "linked_page_id", "linkedPageId"),
  };
}

export function channelsShareMetaIdentity(
  left: Pick<ChannelAccountLike, "channelType" | "providerConfig" | "externalPhoneId">,
  right: Pick<ChannelAccountLike, "channelType" | "providerConfig" | "externalPhoneId">,
): boolean {
  if (left.channelType !== right.channelType && !(isWhatsAppChannelType(left.channelType) && isWhatsAppChannelType(right.channelType))) {
    return false;
  }

  const a = extractMetaChannelIdentity(left);
  const b = extractMetaChannelIdentity(right);

  if (isWhatsAppChannelType(left.channelType) && isWhatsAppChannelType(right.channelType)) {
    return Boolean(a.phoneNumberId && b.phoneNumberId && a.phoneNumberId === b.phoneNumberId);
  }

  switch (left.channelType) {
    case "instagram":
      return Boolean(
        (a.igAccountId && b.igAccountId && a.igAccountId === b.igAccountId)
        || (a.pageId && b.pageId && a.pageId === b.pageId),
      );
    case "messenger":
      return Boolean(a.pageId && b.pageId && a.pageId === b.pageId);
    default:
      return false;
  }
}

export function collectEquivalentMetaChannelIds<T extends ChannelAccountLike>(target: T, candidates: T[]): string[] {
  return candidates
    .filter((candidate) => candidate.id === target.id || channelsShareMetaIdentity(candidate, target))
    .map((candidate) => candidate.id);
}
