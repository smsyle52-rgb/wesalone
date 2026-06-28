vi.unmock("@workspace/db");

import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PaymentListResponse } from "../modules/commerce/payments-commerce.routes";

// ── mutable session ──────────────────────────────────────────────────────────

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  activeWorkspaceId: "",          // set per request by fetchPayments()
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
vi.mock("../lib/audit",  () => ({ createAuditLog: vi.fn(), auditFromRequest: vi.fn() }));
vi.mock("../lib/events", () => ({ publishDomainEvent: vi.fn() }));

// ── fixture IDs ──────────────────────────────────────────────────────────────

const WS_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const WS_B = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const CONTACT_A = "caca0101-ca01-4c01-8c01-c0c0c0c0c0c1";
const CONTACT_B = "cbcb0202-cb02-4c02-8c02-c0c0c0c0c0c2";
const ORDER_1   = "0d0d0101-0d01-4d01-8d01-d0d0d0d0d0d1";

const PMT_A_PENDING      = "f1a1a1a1-f1a1-4a1a-8a1a-a1a1a1a1a1a1"; // Pending  · Cash    · YER · 2026-06-22
const PMT_A_PAID         = "f2a2a2a2-f2a2-4a2a-8a2a-a2a2a2a2a2a2"; // Paid     · BankXfer· SAR · 2026-06-23
const PMT_A_PENDING_LC   = "f3a3a3a3-f3a3-4a3a-8a3a-a3a3a3a3a3a3"; // pending  · Cash    · YER · 2026-06-24
const PMT_A_CONFIRMED_LC = "f4a4a4a4-f4a4-4a4a-8a4a-a4a4a4a4a4a4"; // confirmed· Cash    · YER · 2026-06-25
const PMT_A_FAILED       = "f5a5a5a5-f5a5-4a5a-8a5a-a5a5a5a5a5a5"; // Failed   · Cash    · YER · 2026-06-26T10
const PMT_A_REJECTED_LC  = "f6a6a6a6-f6a6-4a6a-8a6a-a6a6a6a6a6a6"; // rejected · Cash    · YER · 2026-06-26T11
const PMT_A_REFUNDED     = "f7a7a7a7-f7a7-4a7a-8a7a-a7a7a7a7a7a7"; // Refunded · Cash    · YER · 2026-06-26T12
const PMT_A_PARTIAL_REF  = "f8a8a8a8-f8a8-4a8a-8a8a-a8a8a8a8a8a8"; // PartiallyRefunded · Cash · YER · 2026-06-26T13
const PMT_A_WITH_ORDER   = "f9a9a9a9-f9a9-4a9a-8a9a-a9a9a9a9a9a9"; // Pending  · Wallet  · YER · orderId=ORDER_1 · 2026-06-27
const PMT_A_EXT_REF_ONLY = "faeaeaea-faea-4aea-8aea-aeaeaeaeaeae"; // Pending  · Cash    · YER · ref=null · extRef=EXT-ONLY · 2026-06-21
const PMT_CONTACT_B      = "fbcbcbcb-fbcb-4bcb-8bcb-cbcbcbcbcbc1"; // Pending  · Cash    · YER · contact=CONTACT_B · 2026-06-25T15
const PMT_WS_B           = "fc1b1b1b-fc1b-4b1b-8b1b-b1b1b1b1b1b1"; // Pending  · Cash    · YER · workspace=WS_B

const ALL_WS_IDS  = [WS_A, WS_B];
const ALL_PMT_IDS = [
  PMT_A_PENDING, PMT_A_PAID, PMT_A_PENDING_LC, PMT_A_CONFIRMED_LC,
  PMT_A_FAILED, PMT_A_REJECTED_LC, PMT_A_REFUNDED, PMT_A_PARTIAL_REF,
  PMT_A_WITH_ORDER, PMT_A_EXT_REF_ONLY, PMT_CONTACT_B, PMT_WS_B,
];

// ── shared state ─────────────────────────────────────────────────────────────

type DbPool = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  end: () => Promise<void>;
};
let dbPool: DbPool;
let serverPort: number;
let serverClose: (() => Promise<void>) | undefined;

// ── helper ───────────────────────────────────────────────────────────────────

async function fetchPayments(wsId: string, query: Record<string, string> = {}) {
  session.activeWorkspaceId = wsId;
  const qs = new URLSearchParams(query).toString();
  const url = `http://127.0.0.1:${serverPort}/payments${qs ? `?${qs}` : ""}`;
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json() as PaymentListResponse,
  };
}

// ── suite ────────────────────────────────────────────────────────────────────

describe("GET /payments — workspace isolation + DTO parity (real PostgreSQL)", () => {
  beforeAll(async () => {
    // Test #16 requirement: fail (not skip) if DATABASE_URL is missing
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required for payment-read-parity integration tests — set it in the environment",
      );
    }

    const { pool } = await import("@workspace/db");
    dbPool = pool as unknown as DbPool;

    // ── workspaces ──────────────────────────────────────────────────────────
    await dbPool.query(
      `INSERT INTO workspaces (id, name, slug)
       VALUES ($1,'CI Parity WS A','ci-parity-ws-a-a1a1'),
              ($2,'CI Parity WS B','ci-parity-ws-b-b1b1')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [WS_A, WS_B],
    );

    // ── contacts (WS_A only; slug unique per workspace+channel handled separately) ─
    await dbPool.query(
      `INSERT INTO contacts (id, workspace_id, name)
       VALUES ($1,$2,'Contact Alpha'),
              ($3,$2,'Contact Beta')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [CONTACT_A, WS_A, CONTACT_B],
    );

    // ── orders ──────────────────────────────────────────────────────────────
    await dbPool.query(
      `INSERT INTO orders (id, workspace_id, order_number, contact_id, total_amount, currency)
       VALUES ($1,$2,'TEST-ORDER-001',$3,'500.00','YER')
       ON CONFLICT (id) DO NOTHING`,
      [ORDER_1, WS_A, CONTACT_A],
    );

    // ── payments ─────────────────────────────────────────────────────────────
    type PmtRow = [string, string, string | null, string, string, string, string, string | null, string | null, object | null, string | null];
    const pmtRows: PmtRow[] = [
      // id,              wsId, contactId,  amount,   currency, method,          status,               reference,  extRef,      methodSnapshot,         baseAmtYer
      [PMT_A_PENDING,      WS_A, CONTACT_A, "100.00", "YER",    "Cash",          "Pending",            "REF-001",  "EXT-001",   null,                   null],
      [PMT_A_PAID,         WS_A, CONTACT_A, "200.00", "SAR",    "BankTransfer",  "Paid",               null,       "EXT-ONLY",  null,                   null],
      [PMT_A_PENDING_LC,   WS_A, CONTACT_A, "50.00",  "YER",    "Cash",          "pending",            null,       null,        null,                   null],
      [PMT_A_CONFIRMED_LC, WS_A, CONTACT_A, "75.00",  "YER",    "Cash",          "confirmed",          null,       null,        null,                   null],
      [PMT_A_FAILED,       WS_A, CONTACT_A, "25.00",  "YER",    "Cash",          "Failed",             null,       null,        null,                   null],
      [PMT_A_REJECTED_LC,  WS_A, CONTACT_A, "30.00",  "YER",    "Cash",          "rejected",           null,       null,        null,                   null],
      [PMT_A_REFUNDED,     WS_A, CONTACT_A, "40.00",  "YER",    "Cash",          "Refunded",           null,       null,        null,                   null],
      [PMT_A_PARTIAL_REF,  WS_A, CONTACT_A, "60.00",  "YER",    "Cash",          "PartiallyRefunded",  null,       null,        null,                   null],
      [PMT_A_WITH_ORDER,   WS_A, CONTACT_A, "300.00", "YER",    "Wallet",        "Pending",            null,       null,        { type: "wallet" },    "300.00"],
      [PMT_A_EXT_REF_ONLY, WS_A, CONTACT_A, "15.00",  "YER",    "Cash",          "Pending",            null,       "EXT-ONLY",  null,                   null],
      [PMT_CONTACT_B,      WS_A, CONTACT_B, "500.00", "YER",    "Cash",          "Pending",            null,       null,        null,                   null],
      [PMT_WS_B,           WS_B, null,      "999.00", "YER",    "Cash",          "Pending",            null,       null,        null,                   null],
    ];

    const createdAts: Record<string, string> = {
      [PMT_A_EXT_REF_ONLY]: "2026-06-21T10:00:00Z",
      [PMT_A_PENDING]:       "2026-06-22T10:00:00Z",
      [PMT_A_PAID]:          "2026-06-23T10:00:00Z",
      [PMT_A_PENDING_LC]:    "2026-06-24T10:00:00Z",
      [PMT_A_CONFIRMED_LC]:  "2026-06-25T10:00:00Z",
      [PMT_CONTACT_B]:       "2026-06-25T15:00:00Z",
      [PMT_WS_B]:            "2026-06-25T15:00:00Z",
      [PMT_A_FAILED]:        "2026-06-26T10:00:00Z",
      [PMT_A_REJECTED_LC]:   "2026-06-26T11:00:00Z",
      [PMT_A_REFUNDED]:      "2026-06-26T12:00:00Z",
      [PMT_A_PARTIAL_REF]:   "2026-06-26T13:00:00Z",
      [PMT_A_WITH_ORDER]:    "2026-06-27T10:00:00Z",
    };

    for (const [id, wsId, contactId, amount, currency, method, status, ref, extRef, snap, baseAmt] of pmtRows) {
      const orderId = id === PMT_A_WITH_ORDER ? ORDER_1 : null;
      const at = createdAts[id] ?? new Date().toISOString();
      await dbPool.query(
        `INSERT INTO payments
           (id, workspace_id, contact_id, order_id, amount, currency, method, status,
            reference, external_reference, method_snapshot, base_amount_yer, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$13::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [id, wsId, contactId, orderId, amount, currency, method, status,
          ref, extRef, snap ? JSON.stringify(snap) : null, baseAmt, at],
      );
    }

    // ── Express server ────────────────────────────────────────────────────────
    const { default: paymentsRouter } = await import("../modules/commerce/payments-commerce.routes");
    const app = express();
    app.use(express.json());
    app.use("/payments", paymentsRouter);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    serverPort = (server.address() as AddressInfo).port;
    serverClose = () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
  });

  afterAll(async () => {
    await serverClose?.();
    if (dbPool) {
      await dbPool.query(
        `DELETE FROM workspaces WHERE id = ANY($1::uuid[])`,
        [ALL_WS_IDS],
      );
      await dbPool.end();
    }
  });

  // ── 1 ── Contact A cannot see Contact B's payments (same workspace) ─────────

  it("1 — contact A filter excludes contact B payments in same workspace", async () => {
    const res = await fetchPayments(WS_A, { contactId: CONTACT_A });
    expect(res.status).toBe(200);
    const ids = res.body.payments.map((p) => p.id);
    expect(ids).not.toContain(PMT_CONTACT_B);
    expect(ids).not.toContain(PMT_WS_B);
    for (const p of res.body.payments) {
      expect(p.contactId).toBe(CONTACT_A);
    }
  });

  // ── 2 ── Totals for Contact A exclude Contact B ──────────────────────────────

  it("2 — totalPending/totalConfirmed for contactId=A exclude contact B's payments", async () => {
    const resA = await fetchPayments(WS_A, { contactId: CONTACT_A });
    const resAll = await fetchPayments(WS_A);
    // CONTACT_B has 1 Pending payment → totalPending(all) > totalPending(A)
    expect(resA.body.totalPending).toBeLessThan(resAll.body.totalPending);
    // Specifically: totalPending(all) - totalPending(A) = exactly 1 (CONTACT_B's Pending)
    expect(resAll.body.totalPending - resA.body.totalPending).toBe(1);
    // CONTACT_A has 2 confirmed-family payments (Paid + confirmed)
    expect(resA.body.totalConfirmed).toBe(2);
  });

  // ── 3 ── Workspace A cannot see Workspace B payments ─────────────────────────

  it("3 — workspace A session cannot see workspace B payments", async () => {
    const resA = await fetchPayments(WS_A);
    const resB = await fetchPayments(WS_B);
    const idsA = resA.body.payments.map((p) => p.id);
    const idsB = resB.body.payments.map((p) => p.id);
    expect(idsA).not.toContain(PMT_WS_B);
    expect(idsB).not.toContain(PMT_A_PENDING);
    expect(idsB).toContain(PMT_WS_B);
  });

  // ── 4 ── orderId returns only that order's payments ───────────────────────────

  it("4 — orderId filter returns only PMT_A_WITH_ORDER", async () => {
    const res = await fetchPayments(WS_A, { orderId: ORDER_1 });
    expect(res.status).toBe(200);
    const ids = res.body.payments.map((p) => p.id);
    expect(ids).toEqual([PMT_A_WITH_ORDER]);
  });

  // ── 5 ── contactId AND orderId together apply as AND ──────────────────────────

  it("5 — contactId + orderId together apply as AND filter", async () => {
    const resMatch = await fetchPayments(WS_A, { contactId: CONTACT_A, orderId: ORDER_1 });
    expect(resMatch.body.payments.map((p) => p.id)).toEqual([PMT_A_WITH_ORDER]);

    // CONTACT_B + ORDER_1 → no payment (CONTACT_B has no payment for ORDER_1)
    const resMiss = await fetchPayments(WS_A, { contactId: CONTACT_B, orderId: ORDER_1 });
    expect(resMiss.body.payments).toEqual([]);
    expect(resMiss.body.total).toBe(0);
  });

  // ── 6 ── method filter ────────────────────────────────────────────────────────

  it("6 — method=BankTransfer returns only BankTransfer payments", async () => {
    const res = await fetchPayments(WS_A, { method: "BankTransfer" });
    expect(res.status).toBe(200);
    const ids = res.body.payments.map((p) => p.id);
    expect(ids).toContain(PMT_A_PAID);
    for (const p of res.body.payments) {
      expect(p.method).toBe("BankTransfer");
    }
  });

  // ── 7 ── currency filter ──────────────────────────────────────────────────────

  it("7 — currency=SAR returns only SAR payments", async () => {
    const res = await fetchPayments(WS_A, { currency: "SAR" });
    expect(res.status).toBe(200);
    const ids = res.body.payments.map((p) => p.id);
    expect(ids).toContain(PMT_A_PAID);
    for (const p of res.body.payments) {
      expect(p.currency).toBe("SAR");
    }
  });

  // ── 8 ── dateFrom + dateTo filter ─────────────────────────────────────────────

  it("8 — dateFrom/dateTo returns only payments within the range", async () => {
    const res = await fetchPayments(WS_A, {
      contactId: CONTACT_A,
      dateFrom: "2026-06-24T00:00:00Z",
      dateTo:   "2026-06-25T23:59:59Z",
    });
    expect(res.status).toBe(200);
    const ids = res.body.payments.map((p) => p.id);
    expect(ids).toContain(PMT_A_PENDING_LC);    // 2026-06-24
    expect(ids).toContain(PMT_A_CONFIRMED_LC);  // 2026-06-25
    expect(ids).not.toContain(PMT_A_PENDING);   // 2026-06-22 (too old)
    expect(ids).not.toContain(PMT_A_FAILED);    // 2026-06-26 (too new)
  });

  // ── 9 ── pagination: page=2 returns next rows, no overlap with page=1 ─────────

  it("9 — page=2 returns next rows with no overlap vs page=1", async () => {
    const filter = { contactId: CONTACT_A, method: "Cash", currency: "YER", limit: "2" };
    const page1 = await fetchPayments(WS_A, { ...filter, page: "1" });
    const page2 = await fetchPayments(WS_A, { ...filter, page: "2" });

    expect(page1.body.payments).toHaveLength(2);
    expect(page2.body.payments).toHaveLength(2);

    const idsP1 = new Set(page1.body.payments.map((p) => p.id));
    const idsP2 = page2.body.payments.map((p) => p.id);
    for (const id of idsP2) {
      expect(idsP1.has(id), `ID ${id} appears on both page 1 and page 2`).toBe(false);
    }

    // page 1 should contain the two newest Cash/YER/CONTACT_A payments
    expect(idsP1.has(PMT_A_PARTIAL_REF)).toBe(true);
    expect(idsP1.has(PMT_A_REFUNDED)).toBe(true);
    // page 2 should contain the next two
    expect(idsP2).toContain(PMT_A_REJECTED_LC);
    expect(idsP2).toContain(PMT_A_FAILED);
  });

  // ── 10 ── legacy "pending" + canonical "Pending" both map to "pending" ─────────

  it("10 — DB 'Pending' and DB 'pending' both map to status: 'pending' in response", async () => {
    const res = await fetchPayments(WS_A, { contactId: CONTACT_A });
    const byId = Object.fromEntries(res.body.payments.map((p) => [p.id, p]));

    const canonical = byId[PMT_A_PENDING];
    expect(canonical?.canonicalStatus).toBe("Pending");
    expect(canonical?.status).toBe("pending");

    const legacy = byId[PMT_A_PENDING_LC];
    expect(legacy?.canonicalStatus).toBe("pending");
    expect(legacy?.status).toBe("pending");
  });

  // ── 11 ── legacy "confirmed" + canonical "Paid" both map to "confirmed" ────────

  it("11 — DB 'Paid' and DB 'confirmed' both map to status: 'confirmed' in response", async () => {
    const res = await fetchPayments(WS_A, { contactId: CONTACT_A });
    const byId = Object.fromEntries(res.body.payments.map((p) => [p.id, p]));

    const canonical = byId[PMT_A_PAID];
    expect(canonical?.canonicalStatus).toBe("Paid");
    expect(canonical?.status).toBe("confirmed");

    const legacy = byId[PMT_A_CONFIRMED_LC];
    expect(legacy?.canonicalStatus).toBe("confirmed");
    expect(legacy?.status).toBe("confirmed");
  });

  // ── 12 ── rejected / Failed / Refunded / PartiallyRefunded mapping ────────────

  it("12 — rejected/Failed/Refunded/PartiallyRefunded status mappings are correct", async () => {
    const res = await fetchPayments(WS_A, { contactId: CONTACT_A });
    const byId = Object.fromEntries(res.body.payments.map((p) => [p.id, p]));

    expect(byId[PMT_A_FAILED]?.canonicalStatus).toBe("Failed");
    expect(byId[PMT_A_FAILED]?.status).toBe("rejected");

    expect(byId[PMT_A_REJECTED_LC]?.canonicalStatus).toBe("rejected");
    expect(byId[PMT_A_REJECTED_LC]?.status).toBe("rejected");

    expect(byId[PMT_A_REFUNDED]?.canonicalStatus).toBe("Refunded");
    expect(byId[PMT_A_REFUNDED]?.status).toBe("refunded");

    expect(byId[PMT_A_PARTIAL_REF]?.canonicalStatus).toBe("PartiallyRefunded");
    expect(byId[PMT_A_PARTIAL_REF]?.status).toBe("partially_refunded");
  });

  // ── 13 ── reference = COALESCE(p.reference, p.external_reference) ─────────────

  it("13 — reference field is COALESCE(p.reference, p.external_reference)", async () => {
    const res = await fetchPayments(WS_A, { contactId: CONTACT_A });
    const byId = Object.fromEntries(res.body.payments.map((p) => [p.id, p]));

    // PMT_A_PENDING: reference="REF-001", external_reference="EXT-001" → COALESCE = "REF-001"
    expect(byId[PMT_A_PENDING]?.reference).toBe("REF-001");
    expect(byId[PMT_A_PENDING]?.externalReference).toBe("EXT-001");

    // PMT_A_EXT_REF_ONLY: reference=null, external_reference="EXT-ONLY" → COALESCE = "EXT-ONLY"
    expect(byId[PMT_A_EXT_REF_ONLY]?.reference).toBe("EXT-ONLY");
    expect(byId[PMT_A_EXT_REF_ONLY]?.externalReference).toBe("EXT-ONLY");

    // PMT_A_PAID: both null → COALESCE = null (but extRef is "EXT-ONLY" here)
    // Wait: PMT_A_PAID has ref=null, extRef="EXT-ONLY" → reference="EXT-ONLY"
    expect(byId[PMT_A_PAID]?.reference).toBe("EXT-ONLY");
  });

  // ── 14 ── methodSnapshot / contactName / orderNumber / baseAmountYer ──────────

  it("14 — methodSnapshot, contactName, orderNumber, baseAmountYer are present in DTO", async () => {
    const res = await fetchPayments(WS_A, { orderId: ORDER_1 });
    expect(res.status).toBe(200);
    const p = res.body.payments.find((x) => x.id === PMT_A_WITH_ORDER);
    expect(p).toBeDefined();
    expect(p!.methodSnapshot).toEqual({ type: "wallet" });
    expect(p!.contactName).toBe("Contact Alpha");
    expect(p!.orderNumber).toBe("TEST-ORDER-001");
    expect(p!.baseAmountYer).toBe("300.00");
  });

  // ── 15 ── non-existent contact/workspace → empty envelope with zeros ──────────

  it("15 — contact with no payments returns empty envelope with all zeros", async () => {
    const res = await fetchPayments(WS_A, {
      contactId: "00000000-0000-4000-8000-000000000099",
    });
    expect(res.status).toBe(200);
    expect(res.body.payments).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.totalConfirmed).toBe(0);
    expect(res.body.totalPending).toBe(0);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(30);
  });

  // ── 16 ── DATABASE_URL requirement (documented; enforced in beforeAll above) ───

  it("16 — DATABASE_URL was set (beforeAll would have thrown otherwise)", () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
  });
});
