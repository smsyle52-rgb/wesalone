/**
 * contact-erasure.routes.spec.ts — W6-T2 right-to-erasure
 *
 * POST /:id/erase redacts contact PII in place (name/phone/email/city/
 * location/company/customFields, plus identifier/normalizedIdentifier on every
 * linked contact_channels row) without deleting the row — conversations,
 * messages, orders, and audit history that reference this contactId survive.
 * Unit-level: mocked DB, no DATABASE_URL needed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import express, { Router, type Express, type NextFunction, type Request, type Response } from "express";
import type { SessionUser } from "../lib/types";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "test_session_secret_at_least_32_chars_long";
  process.env.PORT ??= "8080";
});

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000010";
const CONTACT_ID = "00000000-0000-4000-8000-000000000030";

const dbState = vi.hoisted(() => ({
  contactRow: null as { id: string; name: string; archivedAt: string | null } | null,
  erasedContact: null as Record<string, unknown> | null,
  contactChannelsUpdateCalled: false,
  auditLogged: [] as Array<Record<string, unknown>>,
}));

vi.mock("@workspace/db", () => {
  const contactsTableMock = { id: "id", workspaceId: "workspaceId" };
  const contactChannelsTableMock = { contactId: "contactId", workspaceId: "workspaceId" };

  const contactSelectChain: any = {
    from: () => contactSelectChain,
    where: () => contactSelectChain,
    limit: () => Promise.resolve(dbState.contactRow ? [dbState.contactRow] : []),
  };
  const contactChannelsUpdateChain: any = {
    set: () => contactChannelsUpdateChain,
    where: () => {
      dbState.contactChannelsUpdateCalled = true;
      return Promise.resolve([]);
    },
  };
  const contactUpdateChain: any = {
    set: (arg: Record<string, unknown>) => {
      dbState.erasedContact = arg;
      return contactUpdateChain;
    },
    where: () => contactUpdateChain,
    returning: () => Promise.resolve([{ id: CONTACT_ID, ...dbState.erasedContact }]),
  };

  return {
    db: {
      select: () => contactSelectChain,
      update: (table: unknown) => (table === contactChannelsTableMock ? contactChannelsUpdateChain : contactUpdateChain),
      insert: () => ({ values: () => Promise.resolve() }),
    },
    contactsTable: contactsTableMock,
    contactChannelsTable: contactChannelsTableMock,
    contactNotesTable: {},
    contactTimelineTable: {},
    conversationsTable: {},
    ticketsTable: {},
    tasksTable: {},
    followupsTable: {},
    opportunitiesTable: {},
    ordersTable: {},
    paymentsTable: {},
    debtsTable: {},
    collectionNotesTable: {},
    broadcastRecipientsTable: {},
    pool: { query: vi.fn(), connect: vi.fn() },
  };
});

vi.mock("../lib/audit", () => ({
  createAuditLog: (entry: Record<string, unknown>) => {
    dbState.auditLogged.push(entry);
    return Promise.resolve();
  },
  auditFromRequest: () => ({}),
}));
vi.mock("../lib/events", () => ({
  publishDomainEvent: vi.fn(),
}));

import contactsRouter from "../modules/contacts/contacts.routes";

function user(): SessionUser {
  return {
    userId: "00000000-0000-4000-8000-000000000100",
    activeWorkspaceId: WORKSPACE_ID,
    activeMembershipId: "00000000-0000-4000-8000-000000000200",
    permissions: ["contacts:read", "contacts:delete"],
    roleSlugs: ["owner"],
    name: "Test User",
    email: "test@example.com",
    emailVerified: true,
  } as SessionUser;
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { user: user() };
    next();
  });
  const api = Router();
  api.use("/contacts", contactsRouter);
  app.use("/api", api);
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

describe("W6-T2: contact right-to-erasure", () => {
  const servers: Server[] = [];

  beforeEach(() => {
    dbState.contactRow = { id: CONTACT_ID, name: "أحمد محمد", archivedAt: null };
    dbState.erasedContact = null;
    dbState.contactChannelsUpdateCalled = false;
    dbState.auditLogged = [];
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
  });

  it("redacts PII fields and archives the contact", async () => {
    const { server, baseUrl } = await listen(buildApp());
    servers.push(server);

    const res = await fetch(`${baseUrl}/api/contacts/${CONTACT_ID}/erase`, { method: "POST" });

    expect(res.status).toBe(200);
    expect(dbState.erasedContact).toMatchObject({
      name: "جهة اتصال محذوفة",
      phone: null,
      email: null,
      city: null,
      locationNote: null,
      company: null,
      customFields: {},
    });
    expect(dbState.erasedContact?.archivedAt).toBeInstanceOf(Date);
  });

  it("redacts linked contact_channels identifiers", async () => {
    const { server, baseUrl } = await listen(buildApp());
    servers.push(server);

    await fetch(`${baseUrl}/api/contacts/${CONTACT_ID}/erase`, { method: "POST" });

    expect(dbState.contactChannelsUpdateCalled).toBe(true);
  });

  it("writes a critical-severity audit log entry, never containing the original name", async () => {
    const { server, baseUrl } = await listen(buildApp());
    servers.push(server);

    await fetch(`${baseUrl}/api/contacts/${CONTACT_ID}/erase`, { method: "POST" });

    expect(dbState.auditLogged).toHaveLength(1);
    expect(dbState.auditLogged[0]).toMatchObject({ severity: "critical", entityType: "contact" });
    expect(JSON.stringify(dbState.auditLogged[0])).not.toContain("أحمد محمد");
  });

  it("404s when the contact does not resolve in the caller's workspace", async () => {
    dbState.contactRow = null;
    const { server, baseUrl } = await listen(buildApp());
    servers.push(server);

    const res = await fetch(`${baseUrl}/api/contacts/${CONTACT_ID}/erase`, { method: "POST" });

    expect(res.status).toBe(404);
    expect(dbState.erasedContact).toBeNull();
  });
});
