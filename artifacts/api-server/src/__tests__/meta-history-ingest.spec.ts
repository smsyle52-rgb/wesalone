/**
 * meta-history-ingest.spec.ts — WhatsApp coexistence "history" payload parsing (Meta sync Phase 3b)
 *
 * extractHistoryMessages is a pure function (no DB, no Express) — these are plain unit
 * tests, no mocking required. Covers: direction derivation, unix-seconds/number timestamp
 * conversion, the external_message_id used as the (workspace_id, external_message_id)
 * dedup key at the DB layer, and defensive handling of malformed/partial payloads.
 *
 * H-DIR-*   direction derivation (from vs thread id)
 * H-TS-*    timestamp conversion
 * H-SHAPE-* multi-thread/multi-chunk flattening
 * H-SKIP-*  defensive skip of unusable entries (no crash, no data invented)
 * H-DEDUP-* external_message_id extraction (the dedup key component owned by this layer)
 */

import { describe, expect, it } from "vitest";
import { extractHistoryMessages } from "../modules/webhooks/meta-history-ingest";

const CUSTOMER_WA_ID = "967700000001";
const BUSINESS_WA_ID = "967775324950";

/** Realistic WhatsApp Coexistence "history" change value (field="history" lives on the change, not value) */
function historyValue(threads: unknown[]) {
  return {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: BUSINESS_WA_ID, phone_number_id: "phone_num_id_001" },
    history: [
      {
        metadata: { phase: 0, chunk_order: 0, progress: 10 },
        threads,
      },
    ],
  };
}

describe("H-DIR: direction derivation", () => {
  it("H-DIR-1: message.from === thread id => inbound (from the customer)", () => {
    const value = historyValue([
      {
        id: CUSTOMER_WA_ID,
        messages: [
          { id: "wamid.hist.1", from: CUSTOMER_WA_ID, timestamp: "1700000000", type: "text", text: { body: "كم سعر المنتج؟" } },
        ],
      },
    ]);

    const rows = extractHistoryMessages(value);
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe("inbound");
  });

  it("H-DIR-2: message.from !== thread id => outbound (from the business), even though the business identifier itself is never compared directly", () => {
    const value = historyValue([
      {
        id: CUSTOMER_WA_ID,
        messages: [
          { id: "wamid.hist.2", from: BUSINESS_WA_ID, timestamp: "1700000600", type: "text", text: { body: "السعر 50 ريال" } },
        ],
      },
    ]);

    const rows = extractHistoryMessages(value);
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe("outbound");
  });

  it("H-DIR-3: a full inbound/outbound exchange in one thread resolves both directions correctly", () => {
    const value = historyValue([
      {
        id: CUSTOMER_WA_ID,
        messages: [
          { id: "wamid.hist.3", from: CUSTOMER_WA_ID, timestamp: "1700000000", type: "text", text: { body: "هل يوجد توصيل؟" } },
          { id: "wamid.hist.4", from: BUSINESS_WA_ID, timestamp: "1700000300", type: "text", text: { body: "نعم، يوجد توصيل لجميع المناطق" } },
        ],
      },
    ]);

    const rows = extractHistoryMessages(value);
    expect(rows.map((r) => r.direction)).toEqual(["inbound", "outbound"]);
  });
});

describe("H-TS: timestamp conversion", () => {
  it("H-TS-1: unix-seconds string is converted to a Date (multiplied by 1000, not used as-is)", () => {
    const value = historyValue([
      { id: CUSTOMER_WA_ID, messages: [{ id: "wamid.ts.1", from: CUSTOMER_WA_ID, timestamp: "1700000000", type: "text", text: { body: "؟" } }] },
    ]);

    const [row] = extractHistoryMessages(value);
    expect(row.messageTimestamp).toBeInstanceOf(Date);
    expect(row.messageTimestamp?.getTime()).toBe(1_700_000_000 * 1000);
  });

  it("H-TS-2: a numeric timestamp (not just a string) is also accepted", () => {
    const value = historyValue([
      { id: CUSTOMER_WA_ID, messages: [{ id: "wamid.ts.2", from: CUSTOMER_WA_ID, timestamp: 1700000000, type: "text", text: { body: "؟" } }] },
    ]);

    const [row] = extractHistoryMessages(value);
    expect(row.messageTimestamp?.getTime()).toBe(1_700_000_000 * 1000);
  });

  it("H-TS-3: a missing/unparseable timestamp becomes null — never invented as \"now\" for a historical message", () => {
    const value = historyValue([
      { id: CUSTOMER_WA_ID, messages: [{ id: "wamid.ts.3", from: CUSTOMER_WA_ID, type: "text", text: { body: "؟" } }] },
    ]);

    const [row] = extractHistoryMessages(value);
    expect(row.messageTimestamp).toBeNull();
  });

  it("H-TS-4: a non-digit timestamp string is rejected (not silently coerced)", () => {
    const value = historyValue([
      { id: CUSTOMER_WA_ID, messages: [{ id: "wamid.ts.4", from: CUSTOMER_WA_ID, timestamp: "not-a-number", type: "text", text: { body: "؟" } }] },
    ]);

    const [row] = extractHistoryMessages(value);
    expect(row.messageTimestamp).toBeNull();
  });
});

describe("H-SHAPE: multi-thread / multi-chunk / media handling", () => {
  it("H-SHAPE-1: multiple threads in one chunk all flatten into the result with their own customerWaId", () => {
    const value = historyValue([
      { id: "967700000001", messages: [{ id: "wamid.a", from: "967700000001", timestamp: "1700000000", type: "text", text: { body: "سؤال أ" } }] },
      { id: "967700000002", messages: [{ id: "wamid.b", from: "967700000002", timestamp: "1700000000", type: "text", text: { body: "سؤال ب" } }] },
    ]);

    const rows = extractHistoryMessages(value);
    expect(rows.map((r) => r.customerWaId).sort()).toEqual(["967700000001", "967700000002"]);
  });

  it("H-SHAPE-2: multiple history chunks (pagination) both contribute rows", () => {
    const value = {
      metadata: { phone_number_id: "phone_num_id_001" },
      history: [
        { threads: [{ id: CUSTOMER_WA_ID, messages: [{ id: "wamid.chunk0", from: CUSTOMER_WA_ID, timestamp: "1700000000", type: "text", text: { body: "أول" } }] }] },
        { threads: [{ id: CUSTOMER_WA_ID, messages: [{ id: "wamid.chunk1", from: CUSTOMER_WA_ID, timestamp: "1700000100", type: "text", text: { body: "ثاني" } }] }] },
      ],
    };

    const rows = extractHistoryMessages(value);
    expect(rows.map((r) => r.externalMessageId)).toEqual(["wamid.chunk0", "wamid.chunk1"]);
  });

  it("H-SHAPE-3: a non-text message (e.g. image) keeps its type but content is null — never invents caption text", () => {
    const value = historyValue([
      {
        id: CUSTOMER_WA_ID,
        messages: [{ id: "wamid.img.1", from: CUSTOMER_WA_ID, timestamp: "1700000000", type: "image", image: { id: "media_1" } }],
      },
    ]);

    const [row] = extractHistoryMessages(value);
    expect(row.messageType).toBe("image");
    expect(row.content).toBeNull();
  });

  it("H-SHAPE-4: a text message with only whitespace body extracts as null content, not an empty string", () => {
    const value = historyValue([
      { id: CUSTOMER_WA_ID, messages: [{ id: "wamid.blank.1", from: CUSTOMER_WA_ID, timestamp: "1700000000", type: "text", text: { body: "   " } }] },
    ]);

    const [row] = extractHistoryMessages(value);
    expect(row.content).toBeNull();
  });

  it("H-SHAPE-5: an unrelated change shape (e.g. smb_app_state_sync, no history[] key) returns an empty array without throwing", () => {
    const value = { metadata: { phone_number_id: "phone_num_id_001" }, contacts: [{ wa_id: CUSTOMER_WA_ID }] };
    expect(extractHistoryMessages(value)).toEqual([]);
  });

  it("H-SHAPE-6: completely empty value ({}) is handled defensively", () => {
    expect(extractHistoryMessages({})).toEqual([]);
  });
});

describe("H-SKIP: defensive skips (malformed entries never crash the batch)", () => {
  it("H-SKIP-1: a thread with no id is skipped entirely (no reliable customer identity, no direction possible)", () => {
    const value = historyValue([
      { messages: [{ id: "wamid.orphan.1", from: CUSTOMER_WA_ID, timestamp: "1700000000", type: "text", text: { body: "بلا هوية" } }] },
    ]);

    expect(extractHistoryMessages(value)).toEqual([]);
  });

  it("H-SKIP-2: a message with no id is skipped, but sibling messages in the same thread are kept", () => {
    const value = historyValue([
      {
        id: CUSTOMER_WA_ID,
        messages: [
          { from: CUSTOMER_WA_ID, timestamp: "1700000000", type: "text", text: { body: "بلا معرّف" } },
          { id: "wamid.kept.1", from: CUSTOMER_WA_ID, timestamp: "1700000001", type: "text", text: { body: "له معرّف" } },
        ],
      },
    ]);

    const rows = extractHistoryMessages(value);
    expect(rows).toHaveLength(1);
    expect(rows[0].externalMessageId).toBe("wamid.kept.1");
  });

  it("H-SKIP-3: threads/messages that are not arrays (malformed shape) are tolerated, not thrown", () => {
    const value = historyValue([{ id: CUSTOMER_WA_ID, messages: "not-an-array" as unknown as unknown[] }]);
    expect(() => extractHistoryMessages(value)).not.toThrow();
    expect(extractHistoryMessages(value)).toEqual([]);
  });
});

describe("H-DEDUP: external_message_id is the dedup-key component owned by this layer", () => {
  it("H-DEDUP-1: externalMessageId is captured verbatim for use in the (workspace_id, external_message_id) unique index", () => {
    const value = historyValue([
      { id: CUSTOMER_WA_ID, messages: [{ id: "wamid.dedup.1", from: CUSTOMER_WA_ID, timestamp: "1700000000", type: "text", text: { body: "سؤال" } }] },
    ]);

    const [row] = extractHistoryMessages(value);
    expect(row.externalMessageId).toBe("wamid.dedup.1");
  });

  it("H-DEDUP-2: redelivered chunks naturally produce the same external_message_id twice — extraction stays faithful, DB-level ON CONFLICT DO NOTHING owns the actual dedup", () => {
    const value = historyValue([
      { id: CUSTOMER_WA_ID, messages: [{ id: "wamid.redelivered", from: CUSTOMER_WA_ID, timestamp: "1700000000", type: "text", text: { body: "سؤال" } }] },
    ]);

    const firstDelivery = extractHistoryMessages(value);
    const secondDelivery = extractHistoryMessages(value); // Meta redelivers the identical chunk
    expect(firstDelivery[0].externalMessageId).toBe(secondDelivery[0].externalMessageId);
  });
});
