import { describe, expect, it } from "vitest";
import {
  channelsShareMetaIdentity,
  collectEquivalentMetaChannelIds,
  lookupAliasesForMetaKey,
} from "../modules/integrations/meta-channel-identity";

describe("meta channel identity helpers", () => {
  it("treats phone_number_id and phoneNumberId as the same WhatsApp identifier", () => {
    const legacy = {
      id: "legacy",
      channelType: "whatsapp",
      providerConfig: { phone_number_id: "phone-123" },
      externalPhoneId: null,
    };
    const newer = {
      id: "newer",
      channelType: "whatsapp",
      providerConfig: { phoneNumberId: "phone-123" },
      externalPhoneId: null,
    };

    expect(channelsShareMetaIdentity(legacy, newer)).toBe(true);
  });

  it("treats whatsapp and whatsapp_api rows for the same phone as the same owner", () => {
    const direct = {
      id: "direct",
      channelType: "whatsapp",
      providerConfig: { phone_number_id: "phone-123" },
      externalPhoneId: null,
    };
    const api = {
      id: "api",
      channelType: "whatsapp_api",
      providerConfig: { phoneNumberId: "phone-123" },
      externalPhoneId: null,
    };

    expect(channelsShareMetaIdentity(direct, api)).toBe(true);
  });

  it("does not merge unrelated WhatsApp numbers", () => {
    const first = {
      id: "first",
      channelType: "whatsapp",
      providerConfig: { phone_number_id: "phone-123" },
      externalPhoneId: null,
    };
    const second = {
      id: "second",
      channelType: "whatsapp",
      providerConfig: { phoneNumberId: "phone-456" },
      externalPhoneId: null,
    };

    expect(channelsShareMetaIdentity(first, second)).toBe(false);
  });

  it("collects duplicate channel rows for the same connected number", () => {
    const target = {
      id: "target",
      channelType: "whatsapp",
      providerConfig: { phoneNumberId: "phone-123" },
      externalPhoneId: null,
    };
    const duplicate = {
      id: "duplicate",
      channelType: "whatsapp",
      providerConfig: { phone_number_id: "phone-123" },
      externalPhoneId: null,
    };
    const unrelated = {
      id: "other",
      channelType: "whatsapp",
      providerConfig: { phone_number_id: "phone-999" },
      externalPhoneId: null,
    };

    expect(collectEquivalentMetaChannelIds(target, [target, duplicate, unrelated])).toEqual(["target", "duplicate"]);
  });

  it("returns alias keys for mixed Meta config naming", () => {
    expect(lookupAliasesForMetaKey("phone_number_id")).toEqual(["phone_number_id", "phoneNumberId"]);
    expect(lookupAliasesForMetaKey("phoneNumberId")).toEqual(["phone_number_id", "phoneNumberId"]);
  });
});
