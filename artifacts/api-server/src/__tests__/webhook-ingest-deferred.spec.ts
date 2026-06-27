/**
 * webhook-ingest-deferred.spec.ts — W2-T1 tests
 *
 * D-DEDUP-*  idempotency key determinism (pure unit, no DB)
 * D-GUARD-*  HMAC signature guard prevents persist on bad sig
 * D-INT-*    integration tests (skip without DATABASE_URL)
 */

import { describe, expect, it } from "vitest";
import { computeWebhookIdempotencyKey } from "../modules/integrations/webhookIngest.service";
import { verifyMetaHmac, makeMetaSignature } from "../lib/meta-signature";

// ── D-DEDUP: idempotency key determinism ─────────────────────────────────────

describe("D-DEDUP: computeWebhookIdempotencyKey", () => {
  const WA_PAYLOAD = {
    object: "whatsapp_business_account",
    entry: [{ id: "entry_001", changes: [{ value: { messages: [{ id: "wamid.xyz" }] } }] }],
  };

  it("D-DEDUP-1: same payload → same idempotency key (dedup basis)", () => {
    const r1 = computeWebhookIdempotencyKey("meta", WA_PAYLOAD);
    const r2 = computeWebhookIdempotencyKey("meta", WA_PAYLOAD);
    expect(r1.idempotencyKey).toBe(r2.idempotencyKey);
  });

  it("D-DEDUP-2: payload with top-level id uses it as the key directly", () => {
    const p = { id: "evt_direct_id", object: "whatsapp_business_account" };
    const { idempotencyKey, externalEventId } = computeWebhookIdempotencyKey("meta", p);
    expect(idempotencyKey).toBe("evt_direct_id");
    expect(externalEventId).toBe("evt_direct_id");
  });

  it("D-DEDUP-3: payload without id falls back to hash of content", () => {
    const p = { object: "whatsapp_business_account", entry: [{ no_id: true }] };
    const { idempotencyKey } = computeWebhookIdempotencyKey("meta", p);
    expect(typeof idempotencyKey).toBe("string");
    expect(idempotencyKey.length).toBeGreaterThan(8);
  });

  it("D-DEDUP-4: different payloads → different keys", () => {
    const p1 = { object: "whatsapp_business_account", entry: [{ id: "entry_A" }] };
    const p2 = { object: "whatsapp_business_account", entry: [{ id: "entry_B" }] };
    const r1 = computeWebhookIdempotencyKey("meta", p1);
    const r2 = computeWebhookIdempotencyKey("meta", p2);
    expect(r1.idempotencyKey).not.toBe(r2.idempotencyKey);
  });

  it("D-DEDUP-5: provider is included in hash (meta vs instagram keys differ for same entry)", () => {
    const p = { object: "test", entry: [{ id: "shared_entry" }] };
    // Both have externalEventId = "shared_entry", so key IS the same (extracted, not hashed)
    // Use a payload without a top-level id to exercise the hash path
    const noId = { object: "test", randomData: Math.random() };
    const rMeta = computeWebhookIdempotencyKey("meta", noId);
    const rInsta = computeWebhookIdempotencyKey("instagram", noId);
    // Same payload body but different provider → different hash
    expect(rMeta.idempotencyKey).not.toBe(rInsta.idempotencyKey);
  });
});

// ── D-GUARD: HMAC guard blocks persist on bad signature ───────────────────────
// The guard is: if !verifyMetaHmac() → return 200 without calling ingestWebhookEvent.
// These tests verify verifyMetaHmac is correctly strict so the guard is trustworthy.

describe("D-GUARD: HMAC signature guard", () => {
  const SECRET = "w2t1_test_secret_xYz";
  const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');

  it("D-GUARD-1: valid signature passes the guard", () => {
    const sig = makeMetaSignature(body, SECRET);
    expect(verifyMetaHmac(body, sig, SECRET)).toBe(true);
  });

  it("D-GUARD-2: tampered body fails the guard → persist skipped", () => {
    const sig = makeMetaSignature(body, SECRET);
    const tampered = Buffer.from('{"object":"hacked"}');
    expect(verifyMetaHmac(tampered, sig, SECRET)).toBe(false);
  });

  it("D-GUARD-3: missing signature header fails the guard → persist skipped", () => {
    expect(verifyMetaHmac(body, undefined, SECRET)).toBe(false);
  });

  it("D-GUARD-4: empty secret fails the guard regardless of signature", () => {
    const sig = makeMetaSignature(body, SECRET);
    expect(verifyMetaHmac(body, sig, "")).toBe(false);
  });

  it("D-GUARD-5: wrong secret fails the guard → persist skipped", () => {
    const sig = makeMetaSignature(body, "wrong_secret");
    expect(verifyMetaHmac(body, sig, SECRET)).toBe(false);
  });
});

// ── D-INT: integration tests (require DATABASE_URL) ───────────────────────────

const SKIP = !process.env.DATABASE_URL;
const IT = SKIP ? it.skip : it;

if (SKIP) {
  console.warn("[W2-T1] DATABASE_URL not set — deferred ingest integration tests skipped.");
}

describe("D-INT: deferred ingest integration", () => {
  IT("D-INT-1: ingestWebhookEvent dedup → second call returns duplicate:true", async () => {
    const { ingestWebhookEvent } = await import("../modules/integrations/webhookIngest.service");
    const payload = {
      object: "whatsapp_business_account",
      entry: [{ id: `dedup-test-${Date.now()}` }],
    };
    const params = { provider: "meta" as const, headers: {}, payload };

    const r1 = await ingestWebhookEvent(params);
    expect(r1.accepted).toBe(true);
    expect(r1.duplicate).toBe(false);

    const r2 = await ingestWebhookEvent(params);
    expect(r2.accepted).toBe(true);
    expect(r2.duplicate).toBe(true);
  });

  IT("D-INT-2: ingestWebhookEvent stores correlation_id when provided", async () => {
    const { ingestWebhookEvent } = await import("../modules/integrations/webhookIngest.service");
    const { randomUUID } = await import("node:crypto");
    const { db, webhookEventsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    const correlationId = randomUUID();
    const payload = {
      object: "whatsapp_business_account",
      entry: [{ id: `corr-test-${Date.now()}` }],
    };

    const result = await ingestWebhookEvent({
      provider: "meta",
      headers: {},
      payload,
      correlationId,
    });

    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(false);

    const [row] = await db
      .select({ correlationId: webhookEventsTable.correlationId })
      .from(webhookEventsTable)
      .where(eq(webhookEventsTable.id, (result as any).event!.id))
      .limit(1);

    expect(row?.correlationId).toBe(correlationId);
  });
});
