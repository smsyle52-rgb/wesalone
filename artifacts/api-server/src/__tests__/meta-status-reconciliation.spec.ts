/**
 * meta-status-reconciliation.spec.ts — W4-T1 delivery-receipt reconciliation
 *
 * Meta's WhatsApp status webhook (entry[].changes[].value.statuses[]) must update
 * messages.delivery_status through the LIVE handler (meta.routes.ts handleMetaPayload),
 * scoped to the workspace resolved from the phone_number_id — never a global update.
 *
 * Unit-level: mocked DB, real DATABASE_URL never needed (env vars stubbed below).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import express, { type Express } from "express";
import { makeMetaSignature } from "../lib/meta-signature";

// vi.hoisted runs before the hoisted `import` statements evaluate env.ts's
// requireEnv() checks (plain top-of-file process.env assignments would not).
vi.hoisted(() => {
  process.env.META_APP_SECRET = "test_meta_status_secret";
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "test_session_secret_at_least_32_chars_long";
  process.env.PORT ??= "8080";
});

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000010";
const PHONE_NUMBER_ID = "phone_num_id_001";

const dbState = vi.hoisted(() => ({
  channelRows: [] as any[],
  messageUpdateRows: [] as any[],
  updateSetArg: undefined as Record<string, unknown> | undefined,
  updateCalled: false,
}));

vi.mock("@workspace/db", () => {
  const selectChain: any = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(dbState.channelRows),
  };
  const updateChain: any = {
    set: (arg: Record<string, unknown>) => {
      dbState.updateSetArg = arg;
      return updateChain;
    },
    where: () => updateChain,
    returning: () => Promise.resolve(dbState.messageUpdateRows),
  };
  return {
    db: {
      select: () => selectChain,
      update: (..._args: unknown[]) => {
        dbState.updateCalled = true;
        return updateChain;
      },
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    },
    channelAccountsTable: { workspaceId: "workspaceId", channelType: "channelType", status: "status", providerConfig: "providerConfig", id: "id" },
    messagesTable: { workspaceId: "workspaceId", providerMessageId: "providerMessageId" },
    contactsTable: {},
    conversationsTable: {},
    domainEventsTable: {},
    outboxEventsTable: {},
  };
});

import metaRouter from "../modules/webhooks/meta.routes";

function buildApp(): Express {
  const app = express();
  app.use("/webhooks", metaRouter);
  return app;
}

async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function statusPayload(status: string, extra: Record<string, unknown> = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "123456789",
      changes: [{
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          statuses: [{ id: "wamid.outbound.1", status, recipient_id: "966501111111", ...extra }],
        },
        field: "messages",
      }],
    }],
  };
}

async function postWebhook(baseUrl: string, body: unknown) {
  const raw = Buffer.from(JSON.stringify(body));
  const signature = makeMetaSignature(raw, "test_meta_status_secret");
  return fetch(`${baseUrl}/webhooks/meta`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hub-signature-256": signature },
    body: raw,
  });
}

describe("W4-T1: Meta status webhook reconciles messages.delivery_status", () => {
  const servers: Server[] = [];

  beforeEach(() => {
    dbState.channelRows = [];
    dbState.messageUpdateRows = [];
    dbState.updateSetArg = undefined;
    dbState.updateCalled = false;
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
  });

  it("updates delivery_status when the channel and message both resolve", async () => {
    dbState.channelRows = [{ id: "channel-1", workspaceId: WORKSPACE_ID, channelType: "whatsapp", providerConfig: {} }];
    dbState.messageUpdateRows = [{ id: "message-1" }];

    const { server, baseUrl } = await listen(buildApp());
    servers.push(server);

    const res = await postWebhook(baseUrl, statusPayload("delivered"));

    expect(res.status).toBe(200);
    expect(dbState.updateCalled).toBe(true);
    expect(dbState.updateSetArg).toEqual({ deliveryStatus: "delivered" });
  });

  it("does not touch messages when no active channel matches the phone_number_id (unknown/foreign number)", async () => {
    dbState.channelRows = [];

    const { server, baseUrl } = await listen(buildApp());
    servers.push(server);

    const res = await postWebhook(baseUrl, statusPayload("read"));

    expect(res.status).toBe(200);
    expect(dbState.updateCalled).toBe(false);
  });

  it("passes through Meta's status value as-is (sent/delivered/read/failed)", async () => {
    dbState.channelRows = [{ id: "channel-1", workspaceId: WORKSPACE_ID, channelType: "whatsapp", providerConfig: {} }];
    dbState.messageUpdateRows = [{ id: "message-1" }];

    const { server, baseUrl } = await listen(buildApp());
    servers.push(server);

    await postWebhook(baseUrl, statusPayload("failed", { errors: [{ code: 131026, title: "Message undeliverable" }] }));

    expect(dbState.updateSetArg).toEqual({ deliveryStatus: "failed" });
  });
});
