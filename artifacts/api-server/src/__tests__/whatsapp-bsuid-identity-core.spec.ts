import { describe, expect, it } from "vitest";
import {
  extractWhatsAppInboundIdentity,
  normalizeWhatsAppPhone,
  resolveWhatsAppRecipientAddress,
} from "../modules/integrations/whatsapp-identity-core";

describe("WhatsApp BSUID identity core", () => {
  it("keeps legacy phone-only webhooks working", () => {
    const identity = extractWhatsAppInboundIdentity(
      { contacts: [{ profile: { name: "Ahmed" }, wa_id: "966501111111" }] },
      { from: "966501111111", type: "text" },
    );

    expect(identity.phone).toBe("+966501111111");
    expect(identity.bsuid).toBeNull();
    expect(identity.profileName).toBe("Ahmed");
  });

  it("accepts BSUID-only payloads without forcing E.164 formatting", () => {
    const identity = extractWhatsAppInboundIdentity(
      { contacts: [{ user_id: "bsuid_user_123", username: "customer_handle" }] },
      { from: "bsuid_user_123", type: "text" },
    );

    expect(identity.phone).toBeNull();
    expect(identity.bsuid).toBe("bsuid_user_123");
    expect(identity.username).toBe("customer_handle");
  });

  it("extracts both phone and BSUID when Meta sends wa_id plus user_id", () => {
    const identity = extractWhatsAppInboundIdentity(
      { contacts: [{ wa_id: "967777111222", user_id: "bsuid_abc" }] },
      { from: "bsuid_abc", type: "text" },
    );

    expect(identity.phone).toBe("+967777111222");
    expect(identity.bsuid).toBe("bsuid_abc");
  });

  it("treats a from value different from wa_id as BSUID", () => {
    const identity = extractWhatsAppInboundIdentity(
      { contacts: [{ wa_id: "967777111222" }] },
      { from: "wamid_scoped_user_99", type: "text" },
    );

    expect(identity.phone).toBe("+967777111222");
    expect(identity.bsuid).toBe("wamid_scoped_user_99");
  });

  it("does not normalize alphanumeric BSUIDs as phone numbers", () => {
    expect(normalizeWhatsAppPhone("bsuid_user_123")).toBeNull();
  });

  it("uses phone recipients with the feature flag disabled", () => {
    const recipient = resolveWhatsAppRecipientAddress({
      phone: "+967777111222",
      bsuid: "bsuid_abc",
      conversationThreadId: "+967777111222",
      bsuidEnabled: false,
    });

    expect(recipient).toEqual({ ok: true, to: "+967777111222", identityType: "whatsapp_phone" });
  });

  it("blocks BSUID recipients while WHATSAPP_BSUID_ENABLED is disabled", () => {
    const recipient = resolveWhatsAppRecipientAddress({
      phone: null,
      bsuid: "bsuid_abc",
      conversationThreadId: "bsuid_abc",
      bsuidEnabled: false,
    });

    expect(recipient.ok).toBe(false);
    if (!recipient.ok) expect(recipient.code).toBe("WHATSAPP_BSUID_DISABLED");
  });

  it("returns BSUID recipients when enabled and the conversation is linked to BSUID", () => {
    const recipient = resolveWhatsAppRecipientAddress({
      phone: "+967777111222",
      bsuid: "bsuid_abc",
      conversationThreadId: "bsuid_abc",
      bsuidEnabled: true,
    });

    expect(recipient).toEqual({ ok: true, to: "bsuid_abc", identityType: "whatsapp_bsuid" });
  });
});
