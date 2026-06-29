import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentListResponse, PaymentReadItem } from "../modules/commerce/payments-commerce.routes";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  session: {
    userId: "11111111-1111-4111-8111-111111111111",
    activeWorkspaceId: "22222222-2222-4222-8222-222222222222",
    activeMembershipId: "33333333-3333-4333-8333-333333333333",
    permissions: ["payments:read"],
    roleSlugs: ["owner"],
    name: "Test Actor",
    email: "actor@test.example",
  },
}));

const WS_A = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";
const CONTACT_A_ID = "55555555-5555-4555-8555-555555555555";
const PAYMENT_ID = "66666666-6666-4666-8666-666666666666";

vi.mock("@workspace/db", () => ({ pool: { query: mocks.poolQuery } }));

vi.mock("../middlewares/requireSession", () => ({
  requireSession: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.sessionUser = mocks.session;
    req.id = "contract-req-id";
    next();
  },
}));

vi.mock("../middlewares/requirePermission", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/audit", () => ({ createAuditLog: vi.fn(), auditFromRequest: vi.fn() }));
vi.mock("../lib/events", () => ({ publishDomainEvent: vi.fn() }));

import paymentsRouter from "../modules/commerce/payments-commerce.routes";

const mockCounts = { total: "1", totalConfirmed: "0", totalPending: "250.00" };

const mockPayment: PaymentReadItem = {
  id: PAYMENT_ID,
  orderId: ORDER_ID,
  contactId: CONTACT_A_ID,
  amount: "250.00",
  currency: "YER",
  method: "Cash",
  status: "pending",
  canonicalStatus: "Pending",
  reference: "REF-001",
  externalReference: "EXT-001",
  receiptUrl: null,
  notes: null,
  paidAt: null,
  confirmedAt: null,
  rejectedAt: null,
  rejectionReason: null,
  createdAt: new Date("2026-06-28T10:00:00.000Z"),
  baseAmountYer: "250.00",
  methodSnapshot: { source: "manual" },
  exchangeRateSnapshot: { fromCurrency: "USD", toCurrency: "YER", rate: "535" },
  orderNumber: "ORD-2026-0001",
  orderTotal: "250.00",
  orderPaid: "0.00",
  orderPaymentStatus: "Unpaid",
  contactName: "Alice",
};

async function getPayments(query: Record<string, string> = {}) {
  const app = express();
  app.use(express.json());
  app.use("/payments", paymentsRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const qs = new URLSearchParams(query).toString();
  const url = `http://127.0.0.1:${port}/payments${qs ? `?${qs}` : ""}`;
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "payment-read-contract-test" },
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

beforeEach(() => {
  mocks.poolQuery.mockReset();
  mocks.poolQuery
    .mockResolvedValueOnce({ rows: [mockCounts], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [mockPayment], rowCount: 1 });
});

afterEach(() => { vi.clearAllMocks(); });

describe("GET /payments — read contract", () => {
  it("returns 200 with full PaymentListResponse envelope", async () => {
    const res = await getPayments();
    expect(res.status).toBe(200);
    const body = res.body as PaymentListResponse;
    expect(Array.isArray(body.payments)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(typeof body.totalConfirmed).toBe("number");
    expect(typeof body.totalPending).toBe("number");
    expect(typeof body.page).toBe("number");
    expect(typeof body.limit).toBe("number");
  });

  it("response body has no extraneous keys beyond the envelope", async () => {
    const res = await getPayments();
    expect(Object.keys(res.body).sort()).toEqual(
      ["limit", "page", "payments", "total", "totalConfirmed", "totalPending"].sort(),
    );
  });

  it("returns payment counts and filtered amount totals from the counts query", async () => {
    const res = await getPayments();
    const body = res.body as PaymentListResponse;
    expect(body.total).toBe(1);
    expect(body.totalConfirmed).toBe(0);
    expect(body.totalPending).toBe(250);
  });

  it("page and limit echo the applied values (defaults 1 / 30)", async () => {
    const res = await getPayments();
    const body = res.body as PaymentListResponse;
    expect(body.page).toBe(1);
    expect(body.limit).toBe(30);
  });

  it("returns 200 with empty payments array and zero counts when DB finds nothing", async () => {
    mocks.poolQuery.mockReset();
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [{ total: "0", totalConfirmed: "0", totalPending: "0" }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await getPayments();
    expect(res.status).toBe(200);
    const body = res.body as PaymentListResponse;
    expect(body.payments).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.totalConfirmed).toBe(0);
    expect(body.totalPending).toBe(0);
  });

  it("payment DTO contains all required fields", async () => {
    const res = await getPayments();
    const p = (res.body as PaymentListResponse).payments[0]!;
    expect(p.id).toBe(PAYMENT_ID);
    expect(p.orderId).toBe(ORDER_ID);
    expect(p.contactId).toBe(CONTACT_A_ID);
    expect(p.amount).toBe("250.00");
    expect(p.currency).toBe("YER");
    expect(p.method).toBe("Cash");
    expect(p.status).toBe("pending");
    expect(p.canonicalStatus).toBe("Pending");
    expect(p.reference).toBe("REF-001");
    expect(p.baseAmountYer).toBe("250.00");
    expect(p.methodSnapshot).toEqual({ source: "manual" });
    expect(p.exchangeRateSnapshot).toEqual({ fromCurrency: "USD", toCurrency: "YER", rate: "535" });
    expect(p.contactName).toBe("Alice");
    expect(p.orderNumber).toBe("ORD-2026-0001");
  });

  it("workspace isolation: $1 always comes from session, never from query string", async () => {
    await getPayments({ workspaceId: "ffffffff-ffff-4fff-8fff-ffffffffffff" });
    const [, countsParams] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    const [, listParams] = mocks.poolQuery.mock.calls[1] as [string, unknown[]];
    expect(countsParams[0]).toBe(WS_A);
    expect(listParams[0]).toBe(WS_A);
  });

  it("contactId is passed as $2 to both queries", async () => {
    await getPayments({ contactId: CONTACT_A_ID });
    const [, countsParams] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    const [, listParams] = mocks.poolQuery.mock.calls[1] as [string, unknown[]];
    expect(countsParams[1]).toBe(CONTACT_A_ID);
    expect(listParams[1]).toBe(CONTACT_A_ID);
  });

  it("orderId is passed as $3 when supplied as a valid UUID", async () => {
    await getPayments({ orderId: ORDER_ID });
    const [, countsParams] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    expect(countsParams[2]).toBe(ORDER_ID);
  });

  it("normalizes canonical Pending to the pending compatibility group", async () => {
    await getPayments({ status: "Pending" });
    const [countsSql, countsParams] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    const [listSql, listParams] = mocks.poolQuery.mock.calls[1] as [string, unknown[]];
    expect(countsParams[3]).toBe("pending");
    expect(listParams[3]).toBe("pending");
    expect(countsSql).toContain("WHEN 'Pending'           THEN 'pending'");
    expect(listSql).toContain("WHEN 'Pending'           THEN 'pending'");
  });

  it("normalizes canonical Paid to the confirmed compatibility group", async () => {
    await getPayments({ status: "Paid" });
    const [, countsParams] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    const [, listParams] = mocks.poolQuery.mock.calls[1] as [string, unknown[]];
    expect(countsParams[3]).toBe("confirmed");
    expect(listParams[3]).toBe("confirmed");
  });

  it("method is passed as $5 to both queries", async () => {
    await getPayments({ method: "BankTransfer" });
    const [, countsParams] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    const [, listParams] = mocks.poolQuery.mock.calls[1] as [string, unknown[]];
    expect(countsParams[4]).toBe("BankTransfer");
    expect(listParams[4]).toBe("BankTransfer");
  });

  it("currency is passed as $6 to both queries", async () => {
    await getPayments({ currency: "SAR" });
    const [, countsParams] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    const [, listParams] = mocks.poolQuery.mock.calls[1] as [string, unknown[]];
    expect(countsParams[5]).toBe("SAR");
    expect(listParams[5]).toBe("SAR");
  });

  it("dateFrom is passed as $7 to both queries", async () => {
    const dateFrom = "2026-06-01T00:00:00Z";
    await getPayments({ dateFrom });
    const [, countsParams] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    const [, listParams] = mocks.poolQuery.mock.calls[1] as [string, unknown[]];
    expect(countsParams[6]).toBe(dateFrom);
    expect(listParams[6]).toBe(dateFrom);
  });

  it("dateTo is passed as $8 to both queries", async () => {
    const dateTo = "2026-06-30T23:59:59Z";
    await getPayments({ dateTo });
    const [, countsParams] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    const [, listParams] = mocks.poolQuery.mock.calls[1] as [string, unknown[]];
    expect(countsParams[7]).toBe(dateTo);
    expect(listParams[7]).toBe(dateTo);
  });

  it("defaults limit to 30 (passed as $9 in listing query)", async () => {
    await getPayments();
    const [, listParams] = mocks.poolQuery.mock.calls[1] as [string, unknown[]];
    expect(listParams[8]).toBe(30);
  });

  it("explicit limit=50 is passed as $9 in listing query", async () => {
    await getPayments({ limit: "50" });
    const [, listParams] = mocks.poolQuery.mock.calls[1] as [string, unknown[]];
    expect(listParams[8]).toBe(50);
  });

  it("page=2 produces offset=30 passed as $10 in listing query", async () => {
    await getPayments({ page: "2" });
    const [, listParams] = mocks.poolQuery.mock.calls[1] as [string, unknown[]];
    expect(listParams[9]).toBe(30);
  });

  it("page and limit in response echo the applied values", async () => {
    const res = await getPayments({ page: "3", limit: "10" });
    const body = res.body as PaymentListResponse;
    expect(body.page).toBe(3);
    expect(body.limit).toBe(10);
  });

  it("unfiltered params default to null ($2–$8 are all null when not supplied)", async () => {
    await getPayments();
    const [, countsParams] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    for (let i = 1; i <= 7; i++) {
      expect(countsParams[i], `param $${i + 1} should be null`).toBeNull();
    }
  });

  it("returns 400 for non-UUID contactId and never calls pool.query", async () => {
    const res = await getPayments({ contactId: "not-a-uuid" });
    expect(res.status).toBe(400);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect((res.body as { error: string }).error).toMatch(/UUID/i);
  });

  it("returns 400 for non-UUID orderId and never calls pool.query", async () => {
    const res = await getPayments({ orderId: "not-a-uuid" });
    expect(res.status).toBe(400);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect((res.body as { error: string }).error).toMatch(/UUID/i);
  });

  it("returns 400 for invalid dateFrom and never calls pool.query", async () => {
    const res = await getPayments({ dateFrom: "not-a-date" });
    expect(res.status).toBe(400);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid dateTo and never calls pool.query", async () => {
    const res = await getPayments({ dateTo: "2026-06-30" });
    expect(res.status).toBe(400);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it("returns 400 for unsupported status and never calls pool.query", async () => {
    const res = await getPayments({ status: "unknown" });
    expect(res.status).toBe(400);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it("returns 400 for page=0 and never calls pool.query", async () => {
    const res = await getPayments({ page: "0" });
    expect(res.status).toBe(400);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect((res.body as { error: string }).error).toMatch(/page/i);
  });

  it("returns 400 for limit=0 and never calls pool.query", async () => {
    const res = await getPayments({ limit: "0" });
    expect(res.status).toBe(400);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it("returns 400 for limit=101 and never calls pool.query", async () => {
    const res = await getPayments({ limit: "101" });
    expect(res.status).toBe(400);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it("status mapping: DB 'Pending' → response status 'pending', canonicalStatus 'Pending'", async () => {
    mocks.poolQuery.mockReset();
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [mockCounts] })
      .mockResolvedValueOnce({ rows: [{ ...mockPayment, status: "pending", canonicalStatus: "Pending" }] });
    const res = await getPayments();
    const p = (res.body as PaymentListResponse).payments[0]!;
    expect(p.status).toBe("pending");
    expect(p.canonicalStatus).toBe("Pending");
  });

  it("status mapping: DB 'Paid' → response status 'confirmed', canonicalStatus 'Paid'", async () => {
    mocks.poolQuery.mockReset();
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [{ total: "1", totalConfirmed: "250.00", totalPending: "0" }] })
      .mockResolvedValueOnce({ rows: [{ ...mockPayment, status: "confirmed", canonicalStatus: "Paid" }] });
    const res = await getPayments();
    const p = (res.body as PaymentListResponse).payments[0]!;
    expect(p.status).toBe("confirmed");
    expect(p.canonicalStatus).toBe("Paid");
  });
});
