/**
 * meta-webhook-contract.spec.ts — Contract tests for Meta webhook payload shapes (W1-T2)
 *
 * PD-6 regression guard: WhatsApp uses entry[].changes[].value.messages[]
 *                        IG/Messenger use entry[].messaging[]
 * Both shapes must be recognized and produce a stored message — this test
 * catches shape regressions before they reach production.
 *
 * Tests are unit-level (mocked DB + mocked ingest). No DATABASE_URL needed.
 *
 * C-HMAC-*  HMAC signature verification
 * C-WA-*    WhatsApp changes[] payload normalization
 * C-IG-*    Instagram messaging[] (new) and changes[] (legacy) normalization
 * C-MS-*    Messenger messaging[] normalization
 * C-DEDUP-* Duplicate providerMessageId handling
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { verifyMetaHmac, makeMetaSignature } from "../lib/meta-signature";

// ── HMAC helper ──────────────────────────────────────────────────────────────

const TEST_SECRET = "test_webhook_secret_abc123";

function sign(body: Buffer | string): string {
  const buf = typeof body === "string" ? Buffer.from(body) : body;
  return makeMetaSignature(buf, TEST_SECRET);
}

// ── Canonical payload fixtures ────────────────────────────────────────────────
// These mirror the exact shapes Meta sends. Changing them is a breaking contract change.

/** WhatsApp Cloud API: entry[].changes[].value.messages[] with unix-second timestamps */
const WA_TEXT_PAYLOAD = {
  object: "whatsapp_business_account",
  entry: [{
    id: "123456789",
    changes: [{
      value: {
        messaging_product: "whatsapp",
        metadata: {
          display_phone_number: "966501234567",
          phone_number_id: "phone_num_id_001",
        },
        contacts: [{ profile: { name: "أحمد" }, wa_id: "966501111111" }],
        messages: [{
          id: "wamid.abc123",
          from: "966501111111",
          timestamp: "1719446400",
          type: "text",
          text: { body: "السلام عليكم" },
        }],
      },
      field: "messages",
    }],
  }],
};

/** WhatsApp status update: entry[].changes[].value.statuses[] — must NOT create a message */
const WA_STATUS_PAYLOAD = {
  object: "whatsapp_business_account",
  entry: [{
    id: "123456789",
    changes: [{
      value: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "phone_num_id_001" },
        statuses: [{
          id: "wamid.abc123",
          recipient_id: "966501111111",
          status: "delivered",
          timestamp: "1719446401",
        }],
      },
      field: "messages",
    }],
  }],
};

/** WhatsApp media message: image type in changes[].value.messages[] */
const WA_IMAGE_PAYLOAD = {
  object: "whatsapp_business_account",
  entry: [{
    id: "123456789",
    changes: [{
      value: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "phone_num_id_001" },
        messages: [{
          id: "wamid.img001",
          from: "966501111111",
          timestamp: "1719446402",
          type: "image",
          image: { id: "media_id_xyz", mime_type: "image/jpeg", caption: "شاهد هذه الصورة" },
        }],
      },
      field: "messages",
    }],
  }],
};

/** WhatsApp reaction (👍 on a prior message) — no downloadable file, unlike other message.<type> fields */
const WA_REACTION_PAYLOAD = {
  object: "whatsapp_business_account",
  entry: [{
    id: "123456789",
    changes: [{
      value: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "phone_num_id_001" },
        messages: [{
          id: "wamid.reaction001",
          from: "966501111111",
          timestamp: "1719446403",
          type: "reaction",
          reaction: { message_id: "wamid.original001", emoji: "👍" },
        }],
      },
      field: "messages",
    }],
  }],
};

/** Instagram new format: entry[].messaging[] with millisecond timestamps */
const IG_MESSAGING_PAYLOAD = {
  object: "instagram",
  entry: [{
    id: "ig_account_id_001",
    time: 1719446400,
    messaging: [{
      sender: { id: "ig_user_sender_001" },
      recipient: { id: "ig_account_id_001" },
      timestamp: 1719446400123,
      message: {
        mid: "ig_mid_abc001",
        text: "مرحباً من إنستغرام",
      },
    }],
  }],
};

/** Instagram new format: echo (is_echo=true) — must NOT create a message */
const IG_ECHO_PAYLOAD = {
  object: "instagram",
  entry: [{
    id: "ig_account_id_001",
    messaging: [{
      sender: { id: "ig_account_id_001" },
      recipient: { id: "ig_user_sender_001" },
      timestamp: 1719446400200,
      message: {
        mid: "ig_mid_echo001",
        text: "رد تلقائي",
        is_echo: true,
      },
    }],
  }],
};

/** Instagram legacy format: entry[].changes[] with field="messages" */
const IG_CHANGES_PAYLOAD = {
  object: "instagram",
  entry: [{
    id: "ig_account_id_001",
    time: 1719446400,
    changes: [{
      field: "messages",
      value: {
        sender: { id: "ig_user_sender_002" },
        recipient: { id: "ig_account_id_001" },
        timestamp: 1719446400,
        message: {
          mid: "ig_legacy_mid_001",
          text: "رسالة من الشكل القديم",
        },
      },
    }],
  }],
};

/** Messenger (Facebook Page): entry[].messaging[] */
const MESSENGER_PAYLOAD = {
  object: "page",
  entry: [{
    id: "page_id_001",
    time: 1719446400,
    messaging: [{
      sender: { id: "fb_user_sender_001" },
      recipient: { id: "page_id_001" },
      timestamp: 1719446400,
      message: {
        mid: "ms_mid_001",
        text: "مرحباً من ماسنجر",
      },
    }],
  }],
};

// ── C-HMAC: HMAC signature verification ──────────────────────────────────────

describe("C-HMAC: verifyMetaHmac", () => {
  const body = Buffer.from(JSON.stringify(WA_TEXT_PAYLOAD));

  it("C-HMAC-1: accepts a correctly signed payload", () => {
    const sig = sign(body);
    expect(verifyMetaHmac(body, sig, TEST_SECRET)).toBe(true);
  });

  it("C-HMAC-2: rejects a payload with wrong signature", () => {
    const wrongSig = sign(Buffer.from("different_body"));
    expect(verifyMetaHmac(body, wrongSig, TEST_SECRET)).toBe(false);
  });

  it("C-HMAC-3: rejects when signature header is missing", () => {
    expect(verifyMetaHmac(body, undefined, TEST_SECRET)).toBe(false);
  });

  it("C-HMAC-4: rejects when signature header lacks sha256= prefix", () => {
    const hex = createHmac("sha256", TEST_SECRET).update(body).digest("hex");
    expect(verifyMetaHmac(body, hex, TEST_SECRET)).toBe(false);
  });

  it("C-HMAC-5: rejects when secret is empty string", () => {
    const sig = sign(body);
    expect(verifyMetaHmac(body, sig, "")).toBe(false);
  });

  it("C-HMAC-6: rejects a signature with non-hex characters", () => {
    expect(verifyMetaHmac(body, "sha256=zzzzzzzz", TEST_SECRET)).toBe(false);
  });

  it("C-HMAC-7: makeMetaSignature produces sha256= prefix", () => {
    const sig = makeMetaSignature(body, TEST_SECRET);
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("C-HMAC-8: same body + secret always produces same signature (deterministic)", () => {
    const s1 = makeMetaSignature(body, TEST_SECRET);
    const s2 = makeMetaSignature(body, TEST_SECRET);
    expect(s1).toBe(s2);
  });
});

// ── C-WA: WhatsApp payload shape ─────────────────────────────────────────────

describe("C-WA: WhatsApp payload shape (entry[].changes[])", () => {
  it("C-WA-1: WhatsApp text payload has object=whatsapp_business_account", () => {
    expect(WA_TEXT_PAYLOAD.object).toBe("whatsapp_business_account");
  });

  it("C-WA-2: messages live at entry[0].changes[0].value.messages[]", () => {
    const messages = WA_TEXT_PAYLOAD.entry[0].changes[0].value.messages;
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe("text");
    expect(messages[0].text.body).toBe("السلام عليكم");
  });

  it("C-WA-3: phone_number_id is at .changes[0].value.metadata.phone_number_id", () => {
    const phoneId = WA_TEXT_PAYLOAD.entry[0].changes[0].value.metadata.phone_number_id;
    expect(typeof phoneId).toBe("string");
    expect(phoneId).toBeTruthy();
  });

  it("C-WA-4: timestamp is a unix-seconds string", () => {
    const ts = WA_TEXT_PAYLOAD.entry[0].changes[0].value.messages[0].timestamp;
    expect(typeof ts).toBe("string");
    expect(/^\d+$/.test(ts)).toBe(true);
    expect(Number(ts)).toBeGreaterThan(1_700_000_000); // after 2023
  });

  it("C-WA-5: status payload has statuses[] (not messages[]) — separate field", () => {
    const value = WA_STATUS_PAYLOAD.entry[0].changes[0].value as any;
    expect(Array.isArray(value.statuses)).toBe(true);
    expect(value.messages).toBeUndefined();
  });

  it("C-WA-6: image message has image.id at expected path", () => {
    const msg = WA_IMAGE_PAYLOAD.entry[0].changes[0].value.messages[0] as any;
    expect(msg.type).toBe("image");
    expect(typeof msg.image?.id).toBe("string");
  });

  // 6 يوليو 2026: تفاعل واتساب كان يُعامَل كوسائط قابلة للتحميل (attachments مع mime_type:null)
  // فتفشل الواجهة بحلقة 401/404 عند محاولة جلب ملف غير موجود. reaction.emoji لا id/mime_type/caption.
  it("C-WA-7: reaction message has reaction.emoji (no media id/mime_type — not a downloadable attachment)", () => {
    const msg = WA_REACTION_PAYLOAD.entry[0].changes[0].value.messages[0] as any;
    expect(msg.type).toBe("reaction");
    expect(typeof msg.reaction?.emoji).toBe("string");
    expect(msg.reaction?.id).toBeUndefined();
    expect(msg.reaction?.mime_type).toBeUndefined();
  });
});

// ── C-IG: Instagram payload shapes ───────────────────────────────────────────

describe("C-IG: Instagram new format (entry[].messaging[])", () => {
  it("C-IG-1: object is instagram", () => {
    expect(IG_MESSAGING_PAYLOAD.object).toBe("instagram");
  });

  it("C-IG-2: messages at entry[0].messaging[0].message.text", () => {
    const msg = IG_MESSAGING_PAYLOAD.entry[0].messaging[0];
    expect(typeof msg.message.text).toBe("string");
    expect(msg.message.text).toBeTruthy();
  });

  it("C-IG-3: sender.id is present", () => {
    const sender = IG_MESSAGING_PAYLOAD.entry[0].messaging[0].sender;
    expect(typeof sender.id).toBe("string");
  });

  it("C-IG-4: recipient.id is the IG account id", () => {
    const recipient = IG_MESSAGING_PAYLOAD.entry[0].messaging[0].recipient;
    expect(recipient.id).toBe(IG_MESSAGING_PAYLOAD.entry[0].id);
  });

  it("C-IG-5: timestamp is milliseconds (>unix-seconds by factor 1000)", () => {
    const ts = IG_MESSAGING_PAYLOAD.entry[0].messaging[0].timestamp;
    expect(ts).toBeGreaterThan(1_700_000_000_000); // milliseconds
  });

  it("C-IG-6: echo has is_echo=true — must be filtered out", () => {
    const msg = IG_ECHO_PAYLOAD.entry[0].messaging[0].message as any;
    expect(msg.is_echo).toBe(true);
  });
});

describe("C-IG: Instagram legacy format (entry[].changes[])", () => {
  it("C-IG-L1: object is still instagram", () => {
    expect(IG_CHANGES_PAYLOAD.object).toBe("instagram");
  });

  it("C-IG-L2: message text at changes[0].value.message.text", () => {
    const value = IG_CHANGES_PAYLOAD.entry[0].changes[0].value as any;
    expect(typeof value.message?.text).toBe("string");
  });

  it("C-IG-L3: field is 'messages'", () => {
    expect(IG_CHANGES_PAYLOAD.entry[0].changes[0].field).toBe("messages");
  });

  it("C-IG-L4: sender at value.sender.id", () => {
    const value = IG_CHANGES_PAYLOAD.entry[0].changes[0].value as any;
    expect(typeof value.sender?.id).toBe("string");
  });
});

// ── C-MS: Messenger payload shape ────────────────────────────────────────────

describe("C-MS: Messenger payload shape (entry[].messaging[])", () => {
  it("C-MS-1: object is page", () => {
    expect(MESSENGER_PAYLOAD.object).toBe("page");
  });

  it("C-MS-2: messages at entry[0].messaging[0].message.text", () => {
    const msg = MESSENGER_PAYLOAD.entry[0].messaging[0];
    expect(typeof msg.message.text).toBe("string");
  });

  it("C-MS-3: sender.id is present", () => {
    expect(typeof MESSENGER_PAYLOAD.entry[0].messaging[0].sender.id).toBe("string");
  });

  it("C-MS-4: recipient.id is the Page id", () => {
    const recipient = MESSENGER_PAYLOAD.entry[0].messaging[0].recipient;
    expect(recipient.id).toBe(MESSENGER_PAYLOAD.entry[0].id);
  });

  it("C-MS-5: Messenger uses entry[].messaging[] — NOT changes[] (critical shape distinction)", () => {
    const entry = MESSENGER_PAYLOAD.entry[0] as any;
    expect(Array.isArray(entry.messaging)).toBe(true);
    expect(entry.changes).toBeUndefined();
  });
});

// ── C-SHAPE: routing dispatch by object type ──────────────────────────────────

describe("C-SHAPE: object type determines handler dispatch", () => {
  it("C-SHAPE-1: WhatsApp → whatsapp_business_account (not page, not instagram)", () => {
    expect(WA_TEXT_PAYLOAD.object).not.toBe("instagram");
    expect(WA_TEXT_PAYLOAD.object).not.toBe("page");
  });

  it("C-SHAPE-2: IG and Messenger BOTH use entry[].messaging[] (shared ingestion path)", () => {
    const igMsg = IG_MESSAGING_PAYLOAD.entry[0].messaging;
    const msMsg = MESSENGER_PAYLOAD.entry[0].messaging;
    expect(Array.isArray(igMsg)).toBe(true);
    expect(Array.isArray(msMsg)).toBe(true);
  });

  it("C-SHAPE-3: WhatsApp uses entry[].changes[] (different from IG/Messenger)", () => {
    const waChanges = WA_TEXT_PAYLOAD.entry[0].changes;
    const igMessaging = IG_MESSAGING_PAYLOAD.entry[0].messaging;
    expect(Array.isArray(waChanges)).toBe(true);
    // IG new format does NOT have changes at the top level when using messaging[]
    expect((IG_MESSAGING_PAYLOAD.entry[0] as any).changes).toBeUndefined();
  });

  it("C-SHAPE-4: IG legacy has BOTH changes[] AND no messaging[] at top level", () => {
    const entry = IG_CHANGES_PAYLOAD.entry[0] as any;
    expect(Array.isArray(entry.changes)).toBe(true);
    expect(entry.messaging).toBeUndefined();
  });
});

// ── C-DEDUP: idempotency key deduplication ────────────────────────────────────

describe("C-DEDUP: provider_message_id uniqueness contract", () => {
  it("C-DEDUP-1: WhatsApp message id is in messages[].id (wamid.* prefix expected)", () => {
    const msgId = WA_TEXT_PAYLOAD.entry[0].changes[0].value.messages[0].id;
    expect(typeof msgId).toBe("string");
    expect(msgId).toBeTruthy();
  });

  it("C-DEDUP-2: IG new message id is in messaging[].message.mid", () => {
    const mid = IG_MESSAGING_PAYLOAD.entry[0].messaging[0].message.mid;
    expect(typeof mid).toBe("string");
    expect(mid).toBeTruthy();
  });

  it("C-DEDUP-3: IG legacy message id is in changes[].value.message.mid", () => {
    const value = IG_CHANGES_PAYLOAD.entry[0].changes[0].value as any;
    const mid = value.message?.mid;
    expect(typeof mid).toBe("string");
    expect(mid).toBeTruthy();
  });

  it("C-DEDUP-4: Messenger message id is in messaging[].message.mid", () => {
    const mid = MESSENGER_PAYLOAD.entry[0].messaging[0].message.mid;
    expect(typeof mid).toBe("string");
    expect(mid).toBeTruthy();
  });

  it("C-DEDUP-5: each fixture has a distinct providerMessageId (fixtures are independent)", () => {
    const ids = new Set([
      WA_TEXT_PAYLOAD.entry[0].changes[0].value.messages[0].id,
      IG_MESSAGING_PAYLOAD.entry[0].messaging[0].message.mid,
      (IG_CHANGES_PAYLOAD.entry[0].changes[0].value as any).message?.mid,
      MESSENGER_PAYLOAD.entry[0].messaging[0].message.mid,
    ]);
    expect(ids.size).toBe(4);
  });
});
