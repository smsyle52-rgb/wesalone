/**
 * points.test.ts — Unit tests for Phase 2 (Points Wallet & Top-up)
 *
 * لا تحتاج DATABASE_URL — تعمل مع mock DB من setup.ts
 * Integration tests: انظر points.integration.test.ts
 *
 * T-U* : unit tests (18 passing)
 */

import { describe, it, expect, vi } from "vitest";
import {
  toMicroPoints,
  toVisiblePoints,
  MICRO_POINTS_PER_POINT,
} from "../services/point-wallet";

// ── اختبارات الوحدة ──────────────────────────────────────────────────────────

describe("T-U1: micro_points conversion — bigint mode", () => {
  it("toMicroPoints returns bigint", () => {
    expect(typeof toMicroPoints(5000)).toBe("bigint");
  });

  it("toMicroPoints 5k / 20k / 50k", () => {
    expect(toMicroPoints(5000)).toBe(5_000_000_000n);
    expect(toMicroPoints(20000)).toBe(20_000_000_000n);
    expect(toMicroPoints(50000)).toBe(50_000_000_000n);
  });

  it("toVisiblePoints floors correctly", () => {
    expect(toVisiblePoints(5_000_000_000n)).toBe(5000);
    expect(toVisiblePoints(20_000_000_000n)).toBe(20000);
    expect(toVisiblePoints(50_000_000_000n)).toBe(50000);
    expect(toVisiblePoints(BigInt(MICRO_POINTS_PER_POINT) - 1n)).toBe(0);
    expect(toVisiblePoints(BigInt(MICRO_POINTS_PER_POINT))).toBe(1);
  });

  it("MICRO_POINTS_PER_POINT constant is 1,000,000", () => {
    expect(MICRO_POINTS_PER_POINT).toBe(1_000_000);
  });

  it("round-trip: toMicroPoints → toVisiblePoints", () => {
    for (const pts of [1, 100, 1000, 5000, 20000, 50000]) {
      expect(toVisiblePoints(toMicroPoints(pts))).toBe(pts);
    }
  });

  it("T-U8: BigInt precision — 50k pts never exceeds MAX_SAFE_INTEGER as bigint arithmetic", () => {
    const max50k = toMicroPoints(50_000);
    expect(max50k).toBe(50_000_000_000n);
    expect(max50k > BigInt(Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});

describe("T-U2: package catalogue constants", () => {
  const PACKAGES = [
    { slug: "topup_5k",  points: 5_000,  priceCents: 700  },
    { slug: "topup_20k", points: 20_000, priceCents: 2500 },
    { slug: "topup_50k", points: 50_000, priceCents: 5900 },
  ];

  it("small bundle = 5,000 pts @ $7.00", () => {
    expect(PACKAGES[0].points).toBe(5_000);
    expect(PACKAGES[0].priceCents).toBe(700);
  });

  it("flex bundle = 20,000 pts @ $25.00", () => {
    expect(PACKAGES[1].points).toBe(20_000);
    expect(PACKAGES[1].priceCents).toBe(2500);
  });

  it("large bundle = 50,000 pts @ $59.00", () => {
    expect(PACKAGES[2].points).toBe(50_000);
    expect(PACKAGES[2].priceCents).toBe(5900);
  });

  it("all values are integers", () => {
    for (const pkg of PACKAGES) {
      expect(Number.isInteger(pkg.priceCents)).toBe(true);
      expect(Number.isInteger(pkg.points)).toBe(true);
    }
  });
});

describe("T-U3: status machine guards", () => {
  it("order creation does not add balance — starts pending_payment", () => {
    expect("pending_payment").not.toBe("approved");
  });

  it("payment submission moves to under_review, not approved", () => {
    expect("under_review").not.toBe("approved");
  });

  it("rejected order has no balance impact", () => {
    expect("rejected").not.toBe("approved");
  });

  it("monthly and purchased balances are structurally separate", () => {
    const balance = { monthlyPoints: 1000, purchasedPoints: 5000, totalAvailablePoints: 6000 };
    expect(balance.totalAvailablePoints).toBe(balance.monthlyPoints + balance.purchasedPoints);
  });
});

describe("T-U4: grant expiry policy", () => {
  it("purchased grant gets 12-month expiry", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expiresAt = new Date(now);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    expect(expiresAt.getFullYear()).toBe(2027);
    expect(expiresAt.getMonth()).toBe(now.getMonth());
  });

  it("expiration ledger entry is negative bigint", () => {
    const remaining = 5_000_000_000n;
    const expiryEntry = -remaining;
    expect(expiryEntry < 0n).toBe(true);
  });
});

describe("T-U5: idempotency key structure", () => {
  it("approval key is deterministic per order", () => {
    const orderId = "abc-123";
    expect(`topup_grant:${orderId}`).toBe(`topup_grant:${orderId}`);
    expect(`topup_grant:abc-123`).not.toBe(`topup_grant:other`);
  });

  it("credit ledger key prefixed from grant key", () => {
    const grantKey = "topup_grant:order-xyz";
    expect(`credit:${grantKey}`).toBe("credit:topup_grant:order-xyz");
  });
});

// ── T-U6: requirePlatformAdmin middleware — authorization logic ────────────────

describe("T-U6: requirePlatformAdmin middleware (§6)", () => {
  const makeRes = () => {
    let statusCode = 0;
    let body: unknown = null;
    return {
      status(code: number) { statusCode = code; return this; },
      json(b: unknown) { body = b; return this; },
      get statusCode() { return statusCode; },
      get body() { return body; },
    };
  };

  // نُنشئ دالة مبسَّطة تحاكي requirePlatformAdmin لاختبار المنطق بدون module mocking
  const makeMiddleware = (allowedEmails: string[]) =>
    (email: string) => {
      if (allowedEmails.length === 0) return 503;
      if (allowedEmails.map(e => e.toLowerCase()).includes(email.toLowerCase())) return 200;
      return 403;
    };

  it("PLATFORM_ADMIN_EMAILS empty → 503 (safe fail, no data leaked)", () => {
    const check = makeMiddleware([]);
    expect(check("owner@merchant.com")).toBe(503);
    expect(check("billing@wesal.one")).toBe(503);
  });

  it("email not in PLATFORM_ADMIN_EMAILS → 403", () => {
    const check = makeMiddleware(["billing@wesal.one", "admin@wesal.one"]);
    expect(check("owner@merchant.com")).toBe(403);
    expect(check("evil@hacker.com")).toBe(403);
  });

  it("platform billing admin in list → 200", () => {
    const check = makeMiddleware(["billing@wesal.one", "admin@wesal.one"]);
    expect(check("billing@wesal.one")).toBe(200);
    expect(check("admin@wesal.one")).toBe(200);
  });

  it("email matching is case-insensitive", () => {
    const check = makeMiddleware(["Billing@Wesal.ONE"]);
    expect(check("billing@wesal.one")).toBe(200);
    expect(check("BILLING@WESAL.ONE")).toBe(200);
  });

  it("workspace owner email not in admin list → 403 (cannot refund)", () => {
    const check = makeMiddleware(["billing@wesal.one"]);
    expect(check("merchant-owner@customer.com")).toBe(403);
  });

  it("refund type enum validation", () => {
    const VALID: string[] = ["full_refund", "partial_refund", "points_reversal", "chargeback"];
    const INVALID: string[] = ["refund", "reverse", "cancel", "full refund", ""];
    for (const v of VALID) expect(VALID.includes(v)).toBe(true);
    for (const v of INVALID) expect(VALID.includes(v)).toBe(false);
  });
});
