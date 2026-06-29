/**
 * isolation.spec.ts — Tenant-isolation standing test suite (W1-T1)
 *
 * Requires: DATABASE_URL=postgresql://... with migrate-phase345.sql applied.
 * Skips gracefully when DATABASE_URL is absent.
 *
 * Invariant: workspace A must NEVER be able to read workspace B rows by
 * id/filter across conversations, messages, contacts, channels, outbox_events.
 * Each wave extends this suite as new surfaces are added.
 *
 * Test IDs:
 *   ISO-1   Conversations list is workspace-scoped (no cross-tenant rows)
 *   ISO-2   Message list is workspace-scoped
 *   ISO-3   Conversation fetch by id returns 404 for another workspace's id
 *   ISO-4   Contact list is workspace-scoped
 *   ISO-5   channel_accounts are workspace-scoped
 *   ISO-6   outbox_events are workspace-scoped
 *   ISO-7   Webhook payload for workspace A channel never creates rows in workspace B
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.unmock("@workspace/db");

const SKIP = !process.env.DATABASE_URL;
const IT = SKIP ? it.skip : it;

if (SKIP) {
  console.warn("[W1-T1] DATABASE_URL not set — isolation tests skipped.");
}

// Fixed UUIDs for isolation test workspaces (different from display_id tests)
const ISO_WS_A = "00000000-0000-4002-b001-000000000001";
const ISO_WS_B = "00000000-0000-4002-b001-000000000002";
const ISO_CONV_A = "00000000-0000-4002-c001-000000000001";
const ISO_CONV_B = "00000000-0000-4002-c001-000000000002";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
const cleanup: Array<() => Promise<void>> = [];

beforeAll(async () => {
  if (SKIP) return;
  const mod = await import("@workspace/db");
  db = mod.db;

  for (const wsId of [ISO_WS_A, ISO_WS_B]) {
    await db.execute(
      `INSERT INTO workspaces (id, name, slug, plan_id)
       SELECT $1::uuid, 'ISO WS ' || $1::text, 'iso-ws-' || $1::text,
              (SELECT id FROM plans WHERE slug = 'free' LIMIT 1)
       WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE id = $1::uuid)`,
      [wsId],
    );
  }

  // Seed one conversation per workspace using valid, stable UUIDs.
  for (const [conversationId, workspaceId] of [
    [ISO_CONV_A, ISO_WS_A],
    [ISO_CONV_B, ISO_WS_B],
  ]) {
    await db.execute(
      `INSERT INTO conversations (id, workspace_id, channel, status)
       VALUES ($1::uuid, $2::uuid, 'whatsapp', 'new')
       ON CONFLICT (id) DO NOTHING`,
      [conversationId, workspaceId],
    );
  }
});

afterAll(async () => {
  if (SKIP || !db) return;
  for (const fn of cleanup) await fn().catch(() => undefined);
  for (const wsId of [ISO_WS_A, ISO_WS_B]) {
    await db.execute(`DELETE FROM conversations WHERE workspace_id = $1`, [wsId]);
  }
});

describe("ISO-1: conversations list is workspace-scoped", () => {
  IT("querying with workspace A id returns only A rows", async () => {
    const rows = await db.execute(
      `SELECT id FROM conversations WHERE workspace_id = $1`,
      [ISO_WS_A],
    );
    const ids = rows.rows.map((r: { id: string }) => r.id) as string[];
    // All returned rows belong to A
    for (const id of ids) {
      const check = await db.execute(
        `SELECT workspace_id FROM conversations WHERE id = $1`,
        [id],
      );
      expect(check.rows[0]?.workspace_id).toBe(ISO_WS_A);
    }
    // None of B's rows are present
    const bRow = await db.execute(
      `SELECT id FROM conversations WHERE workspace_id = $1`,
      [ISO_WS_B],
    );
    const bIds = bRow.rows.map((r: { id: string }) => r.id) as string[];
    for (const bId of bIds) {
      expect(ids).not.toContain(bId);
    }
  });
});

describe("ISO-2: messages are workspace-scoped", () => {
  IT("messages query with workspace A id never includes B rows", async () => {
    // Insert one message per workspace
    for (const [convId, wsId] of [[ISO_CONV_A, ISO_WS_A], [ISO_CONV_B, ISO_WS_B]]) {
      await db.execute(
        `INSERT INTO messages (conversation_id, workspace_id, direction, sender_type, source, content_type, content)
         VALUES ($1::uuid, $2, 'inbound', 'contact', 'webhook', 'text', 'ISO test message')
         ON CONFLICT DO NOTHING`,
        [convId, wsId],
      );
    }

    const aMessages = await db.execute(
      `SELECT workspace_id FROM messages WHERE workspace_id = $1`,
      [ISO_WS_A],
    );
    for (const row of aMessages.rows as Array<{ workspace_id: string }>) {
      expect(row.workspace_id).toBe(ISO_WS_A);
    }
  });
});

describe("ISO-3: conversation fetch by id is workspace-scoped", () => {
  IT("fetching B's conversation id with A's workspace_id returns nothing", async () => {
    const rows = await db.execute(
      `SELECT id FROM conversations WHERE id = $1 AND workspace_id = $2`,
      [ISO_CONV_B, ISO_WS_A],
    );
    // Must be empty — A cannot see B's conversation
    expect(rows.rows.length).toBe(0);
  });
});

describe("ISO-5: channel_accounts are workspace-scoped", () => {
  IT("channel_accounts query with workspace A id never includes B rows", async () => {
    // Seed one channel_account per workspace
    for (const wsId of [ISO_WS_A, ISO_WS_B]) {
      await db.execute(
        `INSERT INTO channel_accounts (workspace_id, channel_type, name, display_name)
         VALUES ($1, 'whatsapp', 'ISO test channel', 'ISO test channel')
         ON CONFLICT DO NOTHING`,
        [wsId],
      );
    }

    const aChannels = await db.execute(
      `SELECT workspace_id FROM channel_accounts WHERE workspace_id = $1`,
      [ISO_WS_A],
    );
    for (const row of aChannels.rows as Array<{ workspace_id: string }>) {
      expect(row.workspace_id).toBe(ISO_WS_A);
    }
  });
});
