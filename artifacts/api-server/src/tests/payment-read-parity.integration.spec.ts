vi.unmock("@workspace/db");

import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PaymentListResponse } from "../modules/commerce/payments-commerce.routes";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  activeWorkspaceId: "",
  activeMembershipId: "00000000-0000-4000-8000-000000000002",
  permissions: ["payments:read"],
  roleSlugs: ["owner"],
  name: "Integration Actor",
  email: "actor@integration.test",
};

vi.mock("../middlewares/requireSession", () => ({
  requireSession: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.sessionUser = { ...session };
    req.id = "parity-int-req";
    next();
  },
}));
vi.mock("../middlewares/requirePermission", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/audit", () => ({ createAuditLog: vi.fn(), auditFromRequest: vi.fn() }));
vi.mock("../lib/events", () => ({ publishDomainEvent: vi.fn() }));

const WS_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const WS_B = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const CONTACT_A = "caca0101-ca01-4c01-8c01-c0c0c0c0c0c1";
const CONTACT_B = "cbcb0202-cb02-4c02-8c02-c0c0c0c0c0c2";
const ORDER_1 = "0d0d0101-0d01-4d01-8d01-d0d0d0d0d0d1";

const PMT_A_PENDING = "f1a1a1a1-f1a1-4a1a-8a1a-a1a1a1a1a1a1";
const PMT_A_PAID = "f2a2a2a2-f2a2-4a2a-8a2a-a2a2a2a2a2a2";
const PMT_A_PENDING_LC = "f3a3a3a3-f3a3-4a3a-8a3a-a3a3a3a3a3a3";
const PMT_A_CONFIRMED_LC = "f4a4a4a4-f4a4-4a4a-8a4a-a4a4a4a4a4a4";
const PMT_A_FAILED = "f5a5a5a5-f5a5-4a5a-8a5a-a5a5a5a5a5a5";
const PMT_A_REJECTED_LC = "f6a6a6a6-f6a6-4a6a-8a6a-a6a6a6a6a6a6";
const PMT_A_REFUNDED = "f7a7a7a7-f7a7-4a7a-8a7a-a7a7a7a7a7a7";
const PMT_A_PARTIAL_REF = "f8a8a8a8-f8a8-4a8a-8a8a-a8a8a8a8a8a8";
const PMT_A_WITH_ORDER = "f9a9a9a9-f9a9-4a9a-8a9a-a9a9a9a9a9a9";
const PMT_A_EXT_REF_ONLY = "faeaeaea-faea-4aea-8aea-aeaeaeaeaeae";
const PMT_CONTACT_B = "fbcbcbcb-fbcb-4bcb-8bcb-cbcbcbcbcbc1";
const PMT_WS_B = "fc1b1b1b-fc1b-4b1b-8b1b-b1b1b1b1b1b1";
const ALL_WS_IDS = [WS_A, WS_B];

const EXCHANGE_SNAPSHOT = { fromCurrency: "USD", toCurrency: "YER", rate: "535" };

type DbPool = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  end: () => Promise<void>;
};

let dbPool: DbPool;
let serverPort: number;
let serverClose: (() => Promise<void>) | undefined;

async function fetchPayments(wsId: string, query: Record<string, string> = {}) {
  session.activeWorkspaceId = wsId;
  const qs = new URLSearchParams(query).toString();
  const response = await fetch(`http://127.0.0.1:${serverPort}/payments${qs ? `?${qs}` : ""}`);
  return {
    status: response.status,
    body: await response.json() as PaymentListResponse,
  };
}

function ids(response: PaymentListResponse) {
  return response.payments.map((payment) => payment.id);
}

describe("GET /payments — workspace isolation + DTO parity (real PostgreSQL)", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for payment-read-parity integration tests");
    }

    const { pool } = await import("@workspace/db");
    dbPool = pool as unknown as DbPool;

    await dbPool.query("DELETE FROM workspaces WHERE id = ANY($1::uuid[])", [ALL_WS_IDS]);
    await dbPool.query(
      `INSERT INTO workspaces (id, name, slug)
       VALUES ($1,'CI Parity WS A','ci-parity-ws-a-a1a1'),
              ($2,'CI Parity WS B','ci-parity-ws-b-b1b1')`,
      [WS_A, WS_B],
    );
    await dbPool.query(
      `INSERT INTO contacts (id, workspace_id, name)
       VALUES ($1,$2,'Contact Alpha'), ($3,$2,'Contact Beta')`,
      [CONTACT_A, WS_A, CONTACT_B],
    );
    await dbPool.query(
      `INSERT INTO orders (id, workspace_id, order_number, contact_id, total_amount, currency)
       VALUES ($1,$2,'TEST-ORDER-001',$3,'500.00','YER')`,
      [ORDER_1, WS_A, CONTACT_A],
    );

    type PmtRow = [
      string, string, string | null, string | null, string, string, string, string,
      string | null, string | null, object | null, string | null, object | null, string,
    ];
    const rows: PmtRow[] = [
      [PMT_A_PENDING, WS_A, CONTACT_A, null, "100.00", "YER", "Cash", "Pending", "REF-001", "EXT-001", null, null, null, "2026-06-22T10:00:00Z"],
      [PMT_A_PAID, WS_A, CONTACT_A, null, "200.00", "SAR", "BankTransfer", "Paid", null, "EXT-ONLY", null, null, null, "2026-06-23T10:00:00Z"],
      [PMT_A_PENDING_LC, WS_A, CONTACT_A, null, "50.00", "YER", "Cash", "pending", null, null, null, null, null, "2026-06-24T10:00:00Z"],
      [PMT_A_CONFIRMED_LC, WS_A, CONTACT_A, null, "75.00", "YER", "Cash", "confirmed", null, null, null, null, null, "2026-06-25T10:00:00Z"],
      [PMT_A_FAILED, WS_A, CONTACT_A, null, "25.00", "YER", "Cash", "Failed", null, null, null, null, null, "2026-06-26T10:00:00Z"],
      [PMT_A_REJECTED_LC, WS_A, CONTACT_A, null, "30.00", "YER", "Cash", "rejected", null, null, null, null, null, "2026-06-26T11:00:00Z"],
      [PMT_A_REFUNDED, WS_A, CONTACT_A, null, "40.00", "YER", "Cash", "Refunded", null, null, null, null, null, "2026-06-26T12:00:00Z"],
      [PMT_A_PARTIAL_REF, WS_A, CONTACT_A, null, "60.00", "YER", "Cash", "PartiallyRefunded", null, null, null, null, null, "2026-06-26T13:00:00Z"],
      [PMT_A_WITH_ORDER, WS_A, CONTACT_A, ORDER_1, "300.00", "YER", "Wallet", "Pending", null, null, { type: "wallet" }, "300.00", EXCHANGE_SNAPSHOT, "2026-06-27T10:00:00Z"],
      [PMT_A_EXT_REF_ONLY, WS_A, CONTACT_A, null, "15.00", "YER", "Cash", "Pending", null, "EXT-ONLY", null, null, null, "2026-06-21T10:00:00Z"],
      [PMT_CONTACT_B, WS_A, CONTACT_B, null, "500.00", "YER", "Cash", "Pending", null, null, null, null, null, "2026-06-25T15:00:00Z"],
      [PMT_WS_B, WS_B, null, null, "999.00", "YER", "Cash", "Pending", null, null, null, null, null, "2026-06-25T15:00:00Z"],
    ];

    for (const [id, wsId, contactId, orderId, amount, currency, method, status, reference, externalReference, methodSnapshot, baseAmountYer, exchangeRateSnapshot, createdAt] of rows) {
      await dbPool.query(
        `INSERT INTO payments
         (id, workspace_id, contact_id, order_id, amount, currency, method, status,
          reference, external_reference, method_snapshot, base_amount_yer,
          exchange_rate_snapshot, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14::timestamptz,$14::timestamptz)`,
        [
          id, wsId, contactId, orderId, amount, currency, method, status,
          reference, externalReference,
          methodSnapshot ? JSON.stringify(methodSnapshot) : null,
          baseAmountYer,
          exchangeRateSnapshot ? JSON.stringify(exchangeRateSnapshot) : null,
          createdAt,
        ],
      );
    }

    const { default: paymentsRouter } = await import("../modules/commerce/payments-commerce.routes");
    const app = express();
    app.use(express.json());
    app.use("/payments", paymentsRouter);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    serverPort = (server.address() as AddressInfo).port;
    serverClose = () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  });

  afterAll(async () => {
    await serverClose?.();
    if (dbPool) {
      await dbPool.query("DELETE FROM workspaces WHERE id = ANY($1::uuid[])", [ALL_WS_IDS]);
      await dbPool.end();
    }
  });

  it("isolates Contact A from Contact B inside the same workspace", async () => {
    const response = await fetchPayments(WS_A, { contactId: CONTACT_A });
    expect(response.status).toBe(200);
    expect(ids(response.body)).not.toContain(PMT_CONTACT_B);
    expect(ids(response.body)).not.toContain(PMT_WS_B);
    expect(response.body.payments.every((payment) => payment.contactId === CONTACT_A)).toBe(true);
  });

  it("filters total count and amount totals to Contact A", async () => {
    const contactA = await fetchPayments(WS_A, { contactId: CONTACT_A });
    const allWorkspace = await fetchPayments(WS_A);
    expect(contactA.body.total).toBe(10);
    expect(contactA.body.totalPending).toBe(465);
    expect(contactA.body.totalConfirmed).toBe(275);
    expect(allWorkspace.body.totalPending).toBe(965);
    expect(allWorkspace.body.totalPending - contactA.body.totalPending).toBe(500);
  });

  it("does not leak payments between workspaces", async () => {
    const a = await fetchPayments(WS_A);
    const b = await fetchPayments(WS_B);
    expect(ids(a.body)).not.toContain(PMT_WS_B);
    expect(ids(b.body)).toEqual([PMT_WS_B]);
    expect(b.body.totalPending).toBe(999);
  });

  it("filters by orderId", async () => {
    const response = await fetchPayments(WS_A, { orderId: ORDER_1 });
    expect(ids(response.body)).toEqual([PMT_A_WITH_ORDER]);
    expect(response.body.total).toBe(1);
    expect(response.body.totalPending).toBe(300);
  });

  it("applies contactId and orderId using AND", async () => {
    const match = await fetchPayments(WS_A, { contactId: CONTACT_A, orderId: ORDER_1 });
    const miss = await fetchPayments(WS_A, { contactId: CONTACT_B, orderId: ORDER_1 });
    expect(ids(match.body)).toEqual([PMT_A_WITH_ORDER]);
    expect(miss.body.payments).toEqual([]);
    expect(miss.body.total).toBe(0);
    expect(miss.body.totalPending).toBe(0);
  });

  it("status=pending returns legacy pending and canonical Pending", async () => {
    const response = await fetchPayments(WS_A, { contactId: CONTACT_A, status: "pending" });
    expect(new Set(ids(response.body))).toEqual(new Set([
      PMT_A_PENDING, PMT_A_PENDING_LC, PMT_A_WITH_ORDER, PMT_A_EXT_REF_ONLY,
    ]));
    expect(response.body.total).toBe(4);
    expect(response.body.payments.every((payment) => payment.status === "pending")).toBe(true);
  });

  it("canonical status=Pending uses the same pending group", async () => {
    const lower = await fetchPayments(WS_A, { contactId: CONTACT_A, status: "pending" });
    const canonical = await fetchPayments(WS_A, { contactId: CONTACT_A, status: "Pending" });
    expect(ids(canonical.body)).toEqual(ids(lower.body));
    expect(canonical.body.total).toBe(lower.body.total);
  });

  it("status=confirmed returns legacy confirmed and canonical Paid", async () => {
    const response = await fetchPayments(WS_A, { contactId: CONTACT_A, status: "confirmed" });
    expect(new Set(ids(response.body))).toEqual(new Set([PMT_A_PAID, PMT_A_CONFIRMED_LC]));
    expect(response.body.total).toBe(2);
    expect(response.body.payments.every((payment) => payment.status === "confirmed")).toBe(true);
  });

  it("canonical status=Paid uses the same confirmed group", async () => {
    const lower = await fetchPayments(WS_A, { contactId: CONTACT_A, status: "confirmed" });
    const canonical = await fetchPayments(WS_A, { contactId: CONTACT_A, status: "Paid" });
    expect(ids(canonical.body)).toEqual(ids(lower.body));
  });

  it("status=rejected returns legacy rejected and canonical Failed", async () => {
    const response = await fetchPayments(WS_A, { contactId: CONTACT_A, status: "rejected" });
    expect(new Set(ids(response.body))).toEqual(new Set([PMT_A_FAILED, PMT_A_REJECTED_LC]));
  });

  it("refund status groups return their canonical rows", async () => {
    const refunded = await fetchPayments(WS_A, { contactId: CONTACT_A, status: "refunded" });
    const partial = await fetchPayments(WS_A, { contactId: CONTACT_A, status: "partially_refunded" });
    expect(ids(refunded.body)).toEqual([PMT_A_REFUNDED]);
    expect(ids(partial.body)).toEqual([PMT_A_PARTIAL_REF]);
  });

  it("returns methodSnapshot, exchangeRateSnapshot, reference, contactName and orderNumber", async () => {
    const orderResponse = await fetchPayments(WS_A, { orderId: ORDER_1 });
    const payment = orderResponse.body.payments[0]!;
    expect(payment.methodSnapshot).toEqual({ type: "wallet" });
    expect(payment.exchangeRateSnapshot).toEqual(EXCHANGE_SNAPSHOT);
    expect(payment.contactName).toBe("Contact Alpha");
    expect(payment.orderNumber).toBe("TEST-ORDER-001");
    expect(payment.baseAmountYer).toBe("300.00");

    const references = await fetchPayments(WS_A, { contactId: CONTACT_A });
    const byId = Object.fromEntries(references.body.payments.map((item) => [item.id, item]));
    expect(byId[PMT_A_PENDING]?.reference).toBe("REF-001");
    expect(byId[PMT_A_PENDING]?.externalReference).toBe("EXT-001");
    expect(byId[PMT_A_EXT_REF_ONLY]?.reference).toBe("EXT-ONLY");
  });

  it("applies pagination offset and limit without overlap", async () => {
    const filters = { contactId: CONTACT_A, method: "Cash", currency: "YER", limit: "2" };
    const page1 = await fetchPayments(WS_A, { ...filters, page: "1" });
    const page2 = await fetchPayments(WS_A, { ...filters, page: "2" });
    expect(page1.body.payments).toHaveLength(2);
    expect(page2.body.payments).toHaveLength(2);
    expect(ids(page1.body).some((id) => ids(page2.body).includes(id))).toBe(false);
    expect(page1.body.total).toBe(page2.body.total);
    expect(page1.body.totalConfirmed).toBe(page2.body.totalConfirmed);
    expect(page1.body.totalPending).toBe(page2.body.totalPending);
    expect(page1.body.page).toBe(1);
    expect(page2.body.page).toBe(2);
  });

  it("applies dateFrom and dateTo", async () => {
    const response = await fetchPayments(WS_A, {
      contactId: CONTACT_A,
      dateFrom: "2026-06-24T00:00:00Z",
      dateTo: "2026-06-25T23:59:59Z",
    });
    expect(new Set(ids(response.body))).toEqual(new Set([PMT_A_PENDING_LC, PMT_A_CONFIRMED_LC]));
    expect(response.body.totalPending).toBe(50);
    expect(response.body.totalConfirmed).toBe(75);
  });

  it("applies method and currency filters to rows and totals", async () => {
    const response = await fetchPayments(WS_A, { contactId: CONTACT_A, method: "BankTransfer", currency: "SAR" });
    expect(ids(response.body)).toEqual([PMT_A_PAID]);
    expect(response.body.total).toBe(1);
    expect(response.body.totalConfirmed).toBe(200);
    expect(response.body.totalPending).toBe(0);
  });

  it.each([
    { contactId: "not-a-uuid" },
    { orderId: "not-a-uuid" },
    { status: "unknown" },
    { dateFrom: "not-a-date" },
    { dateTo: "2026-06-30" },
    { page: "0" },
    { limit: "0" },
    { limit: "101" },
  ])("returns 400 for invalid query %#", async (query) => {
    const response = await fetchPayments(WS_A, query);
    expect(response.status).toBe(400);
  });

  it("DATABASE_URL is present so PostgreSQL tests are not skipped", () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
  });
});
