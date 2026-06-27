/**
 * ingestion-adapters.spec.ts — W2-T2 adapter unit tests
 *
 * A-WA-*  WhatsApp adapter routes to handleMetaWhatsAppWebhook
 * A-IG-*  Instagram adapter routes to handleInstagramWebhook
 * A-MS-*  Messenger adapter routes to handleMessengerWebhook
 * A-DISP-* Dispatch result shape contract
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../modules/integrations/meta-webhook.handler", () => ({
  handleMetaWhatsAppWebhook: vi.fn(),
  handleMetaWebhook: vi.fn(),
}));

vi.mock("../modules/integrations/instagram.handler", () => ({
  handleInstagramWebhook: vi.fn(),
}));

vi.mock("../modules/integrations/messenger.handler", () => ({
  handleMessengerWebhook: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));

import {
  handleMetaWhatsAppWebhook,
} from "../modules/integrations/meta-webhook.handler";
import {
  handleInstagramWebhook,
} from "../modules/integrations/instagram.handler";
import {
  handleMessengerWebhook,
} from "../modules/integrations/messenger.handler";
import { dispatchWhatsAppWebhook } from "../modules/integrations/adapters/whatsapp.adapter";
import { dispatchInstagramWebhook } from "../modules/integrations/adapters/instagram.adapter";
import { dispatchMessengerWebhook } from "../modules/integrations/adapters/messenger.adapter";

const WA_PAYLOAD = {
  object: "whatsapp_business_account",
  entry: [{ changes: [{ value: { metadata: { phone_number_id: "p1" }, messages: [{ id: "wamid.1", from: "9665", timestamp: "1719446400", type: "text", text: { body: "مرحبا" } }] } }] }],
};
const IG_PAYLOAD = {
  object: "instagram",
  entry: [{ id: "ig1", messaging: [{ sender: { id: "u1" }, recipient: { id: "ig1" }, timestamp: 1719446400000, message: { mid: "ig_mid_1", text: "مرحبا" } }] }],
};
const MS_PAYLOAD = {
  object: "page",
  entry: [{ id: "pg1", messaging: [{ sender: { id: "u1" }, recipient: { id: "pg1" }, timestamp: 1719446400, message: { mid: "ms_mid_1", text: "مرحبا" } }] }],
};

const OK_RESULT = { handled: true, messagesCreated: 1, statusesUpdated: 0 };

beforeEach(() => { vi.clearAllMocks(); });

// ── A-WA: WhatsApp adapter ─────────────────────────────────────────────────

describe("A-WA: WhatsApp adapter", () => {
  it("A-WA-1: calls handleMetaWhatsAppWebhook with the raw payload", async () => {
    vi.mocked(handleMetaWhatsAppWebhook).mockResolvedValueOnce(OK_RESULT);
    await dispatchWhatsAppWebhook(WA_PAYLOAD);
    expect(handleMetaWhatsAppWebhook).toHaveBeenCalledOnce();
    expect(handleMetaWhatsAppWebhook).toHaveBeenCalledWith(WA_PAYLOAD);
  });

  it("A-WA-2: returns the result from the handler unchanged", async () => {
    vi.mocked(handleMetaWhatsAppWebhook).mockResolvedValueOnce(OK_RESULT);
    const result = await dispatchWhatsAppWebhook(WA_PAYLOAD);
    expect(result).toEqual(OK_RESULT);
  });

  it("A-WA-3: propagates handler errors (caller handles retry)", async () => {
    vi.mocked(handleMetaWhatsAppWebhook).mockRejectedValueOnce(new Error("DB error"));
    await expect(dispatchWhatsAppWebhook(WA_PAYLOAD)).rejects.toThrow("DB error");
  });

  it("A-WA-4: 0 messagesCreated when handler finds no matching channel", async () => {
    vi.mocked(handleMetaWhatsAppWebhook).mockResolvedValueOnce({ handled: false, messagesCreated: 0, statusesUpdated: 0 });
    const result = await dispatchWhatsAppWebhook(WA_PAYLOAD);
    expect(result.handled).toBe(false);
    expect(result.messagesCreated).toBe(0);
  });
});

// ── A-IG: Instagram adapter ────────────────────────────────────────────────

describe("A-IG: Instagram adapter", () => {
  it("A-IG-1: calls handleInstagramWebhook with the raw payload", async () => {
    vi.mocked(handleInstagramWebhook).mockResolvedValueOnce(1);
    await dispatchInstagramWebhook(IG_PAYLOAD);
    expect(handleInstagramWebhook).toHaveBeenCalledOnce();
    expect(handleInstagramWebhook).toHaveBeenCalledWith(IG_PAYLOAD);
  });

  it("A-IG-2: wraps count result into DispatchResult shape", async () => {
    vi.mocked(handleInstagramWebhook).mockResolvedValueOnce(2);
    const result = await dispatchInstagramWebhook(IG_PAYLOAD);
    expect(result.messagesCreated).toBe(2);
    expect(result.statusesUpdated).toBe(0);
    expect(result.handled).toBe(true);
  });

  it("A-IG-3: handled=false when 0 messages created", async () => {
    vi.mocked(handleInstagramWebhook).mockResolvedValueOnce(0);
    const result = await dispatchInstagramWebhook(IG_PAYLOAD);
    expect(result.handled).toBe(false);
  });

  it("A-IG-4: propagates handler errors", async () => {
    vi.mocked(handleInstagramWebhook).mockRejectedValueOnce(new Error("Network"));
    await expect(dispatchInstagramWebhook(IG_PAYLOAD)).rejects.toThrow("Network");
  });
});

// ── A-MS: Messenger adapter ────────────────────────────────────────────────

describe("A-MS: Messenger adapter", () => {
  it("A-MS-1: calls handleMessengerWebhook with the raw payload", async () => {
    vi.mocked(handleMessengerWebhook).mockResolvedValueOnce(1);
    await dispatchMessengerWebhook(MS_PAYLOAD);
    expect(handleMessengerWebhook).toHaveBeenCalledOnce();
    expect(handleMessengerWebhook).toHaveBeenCalledWith(MS_PAYLOAD);
  });

  it("A-MS-2: wraps count result into DispatchResult shape", async () => {
    vi.mocked(handleMessengerWebhook).mockResolvedValueOnce(3);
    const result = await dispatchMessengerWebhook(MS_PAYLOAD);
    expect(result.messagesCreated).toBe(3);
    expect(result.statusesUpdated).toBe(0);
    expect(result.handled).toBe(true);
  });

  it("A-MS-3: handled=false when 0 messages created", async () => {
    vi.mocked(handleMessengerWebhook).mockResolvedValueOnce(0);
    const result = await dispatchMessengerWebhook(MS_PAYLOAD);
    expect(result.handled).toBe(false);
  });

  it("A-MS-4: propagates handler errors", async () => {
    vi.mocked(handleMessengerWebhook).mockRejectedValueOnce(new Error("Timeout"));
    await expect(dispatchMessengerWebhook(MS_PAYLOAD)).rejects.toThrow("Timeout");
  });
});

// ── A-DISP: dispatch result shape contract ────────────────────────────────

describe("A-DISP: DispatchResult shape contract", () => {
  it("A-DISP-1: WA result always has handled, messagesCreated, statusesUpdated", async () => {
    vi.mocked(handleMetaWhatsAppWebhook).mockResolvedValueOnce(OK_RESULT);
    const r = await dispatchWhatsAppWebhook(WA_PAYLOAD);
    expect(typeof r.handled).toBe("boolean");
    expect(typeof r.messagesCreated).toBe("number");
    expect(typeof r.statusesUpdated).toBe("number");
  });

  it("A-DISP-2: IG result always has handled, messagesCreated, statusesUpdated", async () => {
    vi.mocked(handleInstagramWebhook).mockResolvedValueOnce(1);
    const r = await dispatchInstagramWebhook(IG_PAYLOAD);
    expect(typeof r.handled).toBe("boolean");
    expect(typeof r.messagesCreated).toBe("number");
    expect(typeof r.statusesUpdated).toBe("number");
  });

  it("A-DISP-3: Messenger result always has handled, messagesCreated, statusesUpdated", async () => {
    vi.mocked(handleMessengerWebhook).mockResolvedValueOnce(1);
    const r = await dispatchMessengerWebhook(MS_PAYLOAD);
    expect(typeof r.handled).toBe("boolean");
    expect(typeof r.messagesCreated).toBe("number");
    expect(typeof r.statusesUpdated).toBe("number");
  });

  it("A-DISP-4: adapters are idempotent — 0 msgs on second call (handler-level dedup)", async () => {
    // First call: message created
    vi.mocked(handleMetaWhatsAppWebhook)
      .mockResolvedValueOnce({ handled: true, messagesCreated: 1, statusesUpdated: 0 })
      .mockResolvedValueOnce({ handled: true, messagesCreated: 0, statusesUpdated: 0 }); // dup → 0
    const r1 = await dispatchWhatsAppWebhook(WA_PAYLOAD);
    const r2 = await dispatchWhatsAppWebhook(WA_PAYLOAD);
    expect(r1.messagesCreated).toBe(1);
    expect(r2.messagesCreated).toBe(0);
  });
});
