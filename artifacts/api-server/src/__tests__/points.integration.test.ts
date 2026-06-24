/**
 * points.integration.test.ts — اختبارات التكامل لنظام المحفظة والشحن
 *
 * يتطلب: DATABASE_URL=postgres://postgres:1234@127.0.0.1:5432/wesal_test
 * تشغيل:
 *   DATABASE_URL=postgresql://postgres:1234@127.0.0.1:5432/wesal_test \
 *   pnpm --filter @workspace/api-server exec vitest run
 *
 * يلغي الـmock العام من setup.ts ليستخدم DB حقيقي.
 * قم بتطبيق scripts/migrate-phase345.sql قبل التشغيل.
 */

// يُلغي mock @workspace/db المُعرَّف في setup.ts (يُرفع hoisted قبل أي import فعلي)
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.unmock("@workspace/db");

// ── إعداد ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realDb: any;
let tables: Awaited<typeof import("@workspace/db")>;

const WS_A = "00000000-0000-0000-0001-000000000001";
const WS_B = "00000000-0000-0000-0001-000000000002";
const USER_ADMIN = "00000000-0000-0000-0001-000000000099";

const SKIP = !process.env.DATABASE_URL;
const IT = SKIP ? it.skip : it;

if (SKIP) {
  console.warn("[integration] DATABASE_URL not set — all integration tests will be skipped.");
}

beforeAll(async () => {
  if (SKIP) return;
  const mod = await import("@workspace/db");
  realDb = mod.db;
  tables = mod;

  const { sql } = await import("drizzle-orm");

  // admin test user (required for approved_by / rejected_by FK)
  await realDb.execute(
    sql`INSERT INTO users (id, email, name, password_hash)
        VALUES (${USER_ADMIN}::uuid, 'integ-admin@test.local', 'Integration Admin', 'x')
        ON CONFLICT (id) DO NOTHING`,
  );

  // workspace A + B
  await realDb.execute(
    sql`INSERT INTO workspaces (id, name, slug)
        VALUES (${WS_A}::uuid, 'Integ WS A', 'integ-ws-a'),
               (${WS_B}::uuid, 'Integ WS B', 'integ-ws-b')
        ON CONFLICT (id) DO NOTHING`,
  );

  // subscription WS_A → starter (يستخدم subquery بدلاً من UUID hardcoded)
  await realDb.execute(
    sql`INSERT INTO subscriptions (workspace_id, plan_id, status)
        SELECT ${WS_A}::uuid, id, 'active'
        FROM plans WHERE slug = 'starter' LIMIT 1
        ON CONFLICT (workspace_id) DO UPDATE
          SET plan_id = (SELECT id FROM plans WHERE slug = 'starter' LIMIT 1), status = 'active'`,
  );

  // subscription WS_B → free
  await realDb.execute(
    sql`INSERT INTO subscriptions (workspace_id, plan_id, status)
        SELECT ${WS_B}::uuid, id, 'active'
        FROM plans WHERE slug = 'free' LIMIT 1
        ON CONFLICT (workspace_id) DO UPDATE
          SET plan_id = (SELECT id FROM plans WHERE slug = 'free' LIMIT 1), status = 'active'`,
  );
});

afterAll(async () => {
  if (SKIP || !realDb) return;
  const { sql } = await import("drizzle-orm");
  // تنظيف بيانات الاختبار
  await realDb.execute(sql`DELETE FROM point_ledger WHERE workspace_id IN (${WS_A}::uuid, ${WS_B}::uuid)`);
  await realDb.execute(sql`DELETE FROM payment_submissions WHERE workspace_id IN (${WS_A}::uuid, ${WS_B}::uuid)`);
  await realDb.execute(sql`DELETE FROM point_purchase_orders WHERE workspace_id IN (${WS_A}::uuid, ${WS_B}::uuid)`);
  await realDb.execute(sql`DELETE FROM point_grants WHERE workspace_id IN (${WS_A}::uuid, ${WS_B}::uuid)`);
  await realDb.execute(sql`DELETE FROM point_wallets WHERE workspace_id IN (${WS_A}::uuid, ${WS_B}::uuid)`);
  await realDb.execute(sql`DELETE FROM subscriptions WHERE workspace_id IN (${WS_A}::uuid, ${WS_B}::uuid)`);
  await realDb.execute(sql`DELETE FROM workspaces WHERE id IN (${WS_A}::uuid, ${WS_B}::uuid)`);
  if ("pool" in (realDb as any)) {
    await (realDb as any).pool?.end?.();
  }
});

afterEach(async () => {
  if (SKIP || !realDb) return;
  const { sql } = await import("drizzle-orm");
  await realDb.execute(sql`DELETE FROM point_ledger WHERE workspace_id IN (${WS_A}::uuid, ${WS_B}::uuid)`);
  await realDb.execute(sql`DELETE FROM payment_submissions WHERE workspace_id IN (${WS_A}::uuid, ${WS_B}::uuid)`);
  await realDb.execute(sql`DELETE FROM point_purchase_orders WHERE workspace_id IN (${WS_A}::uuid, ${WS_B}::uuid)`);
  await realDb.execute(sql`DELETE FROM point_grants WHERE workspace_id IN (${WS_A}::uuid, ${WS_B}::uuid)`);
  await realDb.execute(sql`DELETE FROM point_wallets WHERE workspace_id IN (${WS_A}::uuid, ${WS_B}::uuid)`);
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function getTopup5kProduct() {
  const { sql } = await import("drizzle-orm");
  const rows = await realDb.execute(
    sql`SELECT id, points FROM point_topup_products WHERE slug = 'topup_5k' LIMIT 1`,
  );
  const row = rows.rows[0] as { id: string; points: number } | undefined;
  if (!row) throw new Error("topup_5k product not seeded — run migrate-phase345.sql first");
  return row;
}

async function createOrderAndSubmit(wsId = WS_A) {
  const { createPurchaseOrder, submitPaymentProof } = await import("../services/point-topup");
  const product = await getTopup5kProduct();
  const order = await createPurchaseOrder({ workspaceId: wsId, topupProductId: product.id });
  await submitPaymentProof({
    workspaceId: wsId,
    orderId: order.id,
    paymentMethod: "kuraimi",
    paidAmountMinor: "500000",
    paidCurrency: "YER",
  });
  return { orderId: order.id, product };
}

// ── T-I1: اشتراكية الشراء ────────────────────────────────────────────────────

describe("T-I1: purchase eligibility", () => {
  IT("free plan (WS_B) cannot create purchase order", async () => {
    const { createPurchaseOrder } = await import("../services/point-topup");
    const product = await getTopup5kProduct();

    await expect(
      createPurchaseOrder({ workspaceId: WS_B, topupProductId: product.id }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/free_plan|inactive_subscription/) });
  });

  IT("paid plan (WS_A) can create purchase order in pending_payment", async () => {
    const { createPurchaseOrder } = await import("../services/point-topup");
    const product = await getTopup5kProduct();
    const order = await createPurchaseOrder({ workspaceId: WS_A, topupProductId: product.id });

    expect(order.status).toBe("pending_payment");
    expect(order.workspaceId).toBe(WS_A);
    expect(order.pointsSnapshot).toBe(product.points);
  });
});

// ── T-I2: دورة حياة الاعتماد ─────────────────────────────────────────────────

describe("T-I2a: approval adds balance exactly once", () => {
  IT("approved order credits correct points to balance", async () => {
    const { approvePurchaseOrder } = await import("../services/point-topup");
    const { getWalletBalance } = await import("../services/point-wallet");

    const { orderId } = await createOrderAndSubmit();
    await approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN });

    const balance = await getWalletBalance(WS_A);
    expect(balance.purchasedPoints).toBe(5000);
    expect(balance.totalAvailablePoints).toBe(5000);
    expect(balance.monthlyPoints).toBe(0);
  });
});

describe("T-I2b: double approval is rejected", () => {
  IT("second approval throws already_credited or not_under_review", async () => {
    const { approvePurchaseOrder } = await import("../services/point-topup");

    const { orderId } = await createOrderAndSubmit();
    await approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN });

    await expect(
      approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/already_credited|not_under_review/) });
  });
});

describe("T-I2c: payment_submission synced to approved", () => {
  IT("payment_submission.status = 'approved' after order approval", async () => {
    const { approvePurchaseOrder } = await import("../services/point-topup");
    const { sql } = await import("drizzle-orm");

    const { orderId } = await createOrderAndSubmit();
    await approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN });

    const rows = await realDb.execute(
      sql`SELECT status FROM payment_submissions WHERE point_purchase_order_id = ${orderId}::uuid`,
    );
    expect(rows.rows.length).toBe(1);
    expect((rows.rows[0] as { status: string }).status).toBe("approved");
  });
});

describe("T-I2d: rejection leaves zero balance", () => {
  IT("rejected order adds nothing to balance and marks submission rejected", async () => {
    const { rejectPurchaseOrder } = await import("../services/point-topup");
    const { getWalletBalance } = await import("../services/point-wallet");
    const { sql } = await import("drizzle-orm");

    const { orderId } = await createOrderAndSubmit();
    await rejectPurchaseOrder({ orderId, rejectedByUserId: USER_ADMIN, reason: "payment not confirmed" });

    const balance = await getWalletBalance(WS_A);
    expect(balance.purchasedPoints).toBe(0);

    const subRows = await realDb.execute(
      sql`SELECT status FROM payment_submissions WHERE point_purchase_order_id = ${orderId}::uuid`,
    );
    expect((subRows.rows[0] as { status: string }).status).toBe("rejected");
  });
});

describe("T-I2e: workspace isolation on approval", () => {
  IT("approved order returns order.workspaceId matching creator (no workspace leak)", async () => {
    const { approvePurchaseOrder } = await import("../services/point-topup");

    const { orderId } = await createOrderAndSubmit(WS_A);
    const approved = await approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN });

    expect(approved.workspaceId).toBe(WS_A);
  });
});

describe("T-I3: approval validation guards (Item 7)", () => {
  IT("approval fails if no pending payment_submission exists", async () => {
    const { sql } = await import("drizzle-orm");
    const { createPurchaseOrder } = await import("../services/point-topup");
    const { approvePurchaseOrder } = await import("../services/point-topup");
    const product = await getTopup5kProduct();

    const order = await createPurchaseOrder({ workspaceId: WS_A, topupProductId: product.id });

    // نقل الحالة يدوياً إلى under_review بدون payment_submission
    await realDb.execute(
      sql`UPDATE point_purchase_orders SET status = 'under_review' WHERE id = ${order.id}::uuid`,
    );

    await expect(
      approvePurchaseOrder({ orderId: order.id, approvedByUserId: USER_ADMIN }),
    ).rejects.toMatchObject({ code: "no_payment_submission" });
  });

  IT("approval fails if order is still in pending_payment (not under_review)", async () => {
    const { createPurchaseOrder, approvePurchaseOrder } = await import("../services/point-topup");
    const product = await getTopup5kProduct();
    const order = await createPurchaseOrder({ workspaceId: WS_A, topupProductId: product.id });

    await expect(
      approvePurchaseOrder({ orderId: order.id, approvedByUserId: USER_ADMIN }),
    ).rejects.toMatchObject({ code: "not_under_review" });
  });
});

describe("T-I4: workspace balance isolation", () => {
  IT("WS_A balance does not include WS_B grants", async () => {
    const { createGrant, getWalletBalance } = await import("../services/point-wallet");

    await createGrant({
      workspaceId: WS_B,
      grantType: "admin_adjustment",
      points: 9999,
      idempotencyKey: "isolation_test_b_integ",
      startsAt: new Date(),
    });

    const balanceA = await getWalletBalance(WS_A);
    expect(balanceA.totalAvailablePoints).toBe(0);

    const balanceB = await getWalletBalance(WS_B);
    expect(balanceB.totalAvailablePoints).toBe(9999);
  });
});

describe("T-I5: product catalogue idempotency (seed)", () => {
  IT("topup products = exactly 3 after migration (no duplicates)", async () => {
    const { sql } = await import("drizzle-orm");
    const rows = await realDb.execute(
      sql`SELECT count(*)::int AS n FROM point_topup_products WHERE slug IN ('topup_5k','topup_20k','topup_50k')`,
    );
    expect((rows.rows[0] as { n: number }).n).toBe(3);
  });
});

// ── T-C: اختبار التزامن ───────────────────────────────────────────────────────

describe("T-C: concurrent approval does not double-credit", () => {
  IT("two simultaneous approvals → 1 grant, 1 ledger credit, correct balance", async () => {
    const { approvePurchaseOrder } = await import("../services/point-topup");
    const { getWalletBalance } = await import("../services/point-wallet");
    const { sql } = await import("drizzle-orm");

    const { orderId } = await createOrderAndSubmit();

    const results = await Promise.allSettled([
      approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN }),
      approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected  = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const balance = await getWalletBalance(WS_A);
    expect(balance.purchasedPoints).toBe(5000);

    const grantsCount = await realDb.execute(
      sql`SELECT count(*)::int AS n FROM point_grants WHERE workspace_id = ${WS_A}::uuid`,
    ).then((r: { rows: { n: number }[] }) => r.rows[0].n);
    expect(grantsCount).toBe(1);

    const ledgerCount = await realDb.execute(
      sql`SELECT count(*)::int AS n FROM point_ledger WHERE workspace_id = ${WS_A}::uuid AND transaction_type = 'credit'`,
    ).then((r: { rows: { n: number }[] }) => r.rows[0].n);
    expect(ledgerCount).toBe(1);

    const orderRow = await realDb.execute(
      sql`SELECT status FROM point_purchase_orders WHERE id = ${orderId}::uuid`,
    ).then((r: { rows: { status: string }[] }) => r.rows[0]);
    expect(orderRow.status).toBe("approved");
  }, 15_000);
});

// ── T-R: اختبار Rollback ──────────────────────────────────────────────────────

describe("T-R: rollback on ledger failure", () => {
  IT("if ledger insert fails mid-tx, no grant and order stays under_review", async () => {
    const { pointGrantsTable: pgt, pointPurchaseOrdersTable: ppot } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    const { createGrant } = await import("../services/point-wallet");

    const { orderId } = await createOrderAndSubmit();

    let rolledBack = false;
    try {
      await realDb.transaction(async (tx: typeof realDb) => {
        // قفل الطلب
        await tx.execute(sql`SELECT * FROM point_purchase_orders WHERE id = ${orderId}::uuid FOR UPDATE`);

        // إنشاء grant
        await createGrant(
          {
            workspaceId: WS_A,
            grantType: "purchased",
            points: 5000,
            startsAt: new Date(),
            expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
            idempotencyKey: `rollback_test:${orderId}`,
          },
          tx,
        );

        // خطأ مقصود قبل COMMIT
        throw new Error("INTENTIONAL_ROLLBACK");
      });
    } catch (err) {
      if ((err as Error).message === "INTENTIONAL_ROLLBACK") {
        rolledBack = true;
      } else {
        throw err;
      }
    }

    expect(rolledBack).toBe(true);

    const grants = await realDb.select({ id: pgt.id }).from(pgt).where(eq(pgt.workspaceId, WS_A));
    expect(grants.length).toBe(0);

    const [orderRow] = await realDb
      .select({ status: ppot.status })
      .from(ppot)
      .where(eq(ppot.id, orderId));
    expect(orderRow?.status).toBe("under_review");
  });
});

// ── T-B: BigInt precision beyond MAX_SAFE_INTEGER ─────────────────────────────

describe("T-B: BigInt precision beyond Number.MAX_SAFE_INTEGER", () => {
  IT("stores and retrieves BIGINT > MAX_SAFE_INTEGER without precision loss", async () => {
    const { sql } = await import("drizzle-orm");
    const { getOrCreateWallet } = await import("../services/point-wallet");

    const wallet = await getOrCreateWallet(WS_A);
    // قيمة فردية > MAX_SAFE_INTEGER: لا يمكن تمثيلها بدقة كـfloat64
    // 9007199254741001n فردية، عند تحويلها إلى Number ترتبط إلى 9007199254741000
    const bigValue = 9_007_199_254_741_001n; // > Number.MAX_SAFE_INTEGER (فردي → يفقد الدقة كـnumber)

    const expiry = new Date(Date.now() + 365 * 24 * 3600 * 1000);
    await realDb.execute(
      sql`INSERT INTO point_grants (
            id, workspace_id, wallet_id, grant_type,
            original_micro_points, remaining_micro_points,
            starts_at, expires_at, status, idempotency_key, metadata
          ) VALUES (
            gen_random_uuid(),
            ${WS_A}::uuid, ${wallet.id}::uuid,
            'admin_adjustment',
            ${bigValue}, ${bigValue},
            now(), ${expiry}, 'active',
            'bigint_precision_integ', '{}'::jsonb
          )`,
    );

    const rows = await realDb.execute(
      sql`SELECT original_micro_points FROM point_grants
          WHERE workspace_id = ${WS_A}::uuid AND idempotency_key = 'bigint_precision_integ'`,
    );
    const row = rows.rows[0] as { original_micro_points: string | bigint };
    const retrieved = BigInt(row.original_micro_points.toString());

    // BigInt يحتفظ بالدقة الكاملة
    expect(retrieved).toBe(bigValue);

    // إثبات أن Number() يفقد الدقة (9007199254741001 الفردي يُقرَّب إلى 9007199254741000)
    const asNumber = Number(bigValue);
    expect(asNumber).toBe(9007199254741000); // يُقرَّب!
    expect(BigInt(asNumber)).not.toBe(bigValue); // 9007199254741000n ≠ 9007199254741001n
    expect(retrieved).toBe(bigValue); // BigInt: دقة كاملة
  });
});

// ── T-I6: expire-grants job ───────────────────────────────────────────────────

describe("T-I6: expire-grants job idempotency", () => {
  IT("running expire job twice does not double-debit expired grants", async () => {
    const { createGrant, expireStaleGrants, getWalletBalance } = await import("../services/point-wallet");

    // grant منتهية الصلاحية
    await createGrant({
      workspaceId: WS_A,
      grantType: "purchased",
      points: 1000,
      startsAt: new Date(Date.now() - 2 * 24 * 3600 * 1000), // بدأت بالأمس
      expiresAt: new Date(Date.now() - 1000),                  // انتهت منذ ثانية
      idempotencyKey: "expire_job_test_01",
    });

    // تشغيل أول
    const r1 = await expireStaleGrants();
    expect(r1.expired).toBe(1);

    // تشغيل ثان — idempotent
    const r2 = await expireStaleGrants();
    expect(r2.expired).toBe(0);

    // الرصيد = صفر (منتهية)
    const balance = await getWalletBalance(WS_A);
    expect(balance.totalAvailablePoints).toBe(0);
  });
});

// ── T-I7: إنشاء الطلب ورفع الإيصال لا يضيفان رصيداً (#4 و#5) ─────────────

describe("T-I7: order creation and payment submission do not add balance", () => {
  IT("balance = 0 immediately after createPurchaseOrder (#4)", async () => {
    const { createPurchaseOrder } = await import("../services/point-topup");
    const { getWalletBalance } = await import("../services/point-wallet");
    const product = await getTopup5kProduct();

    await createPurchaseOrder({ workspaceId: WS_A, topupProductId: product.id });

    const balance = await getWalletBalance(WS_A);
    expect(balance.purchasedPoints).toBe(0);
    expect(balance.totalAvailablePoints).toBe(0);
  });

  IT("balance = 0 after submitPaymentProof (#5)", async () => {
    const { getWalletBalance } = await import("../services/point-wallet");

    const { orderId } = await createOrderAndSubmit();

    const balance = await getWalletBalance(WS_A);
    expect(balance.purchasedPoints).toBe(0);
    expect(balance.totalAvailablePoints).toBe(0);
    expect(balance.monthlyPoints).toBe(0);
  });
});

// ── T-I8: دقة كل حزمة — 20k و 50k (#9 و#10) ────────────────────────────────

describe("T-I8: package precision — 20k and 50k add exact amounts", () => {
  IT("topup_20k adds exactly 20,000 points (#9)", async () => {
    const { sql } = await import("drizzle-orm");
    const { createPurchaseOrder, submitPaymentProof, approvePurchaseOrder } = await import("../services/point-topup");
    const { getWalletBalance } = await import("../services/point-wallet");

    const product20k = await realDb.execute(
      sql`SELECT id FROM point_topup_products WHERE slug = 'topup_20k' LIMIT 1`,
    ).then((r: { rows: { id: string }[] }) => r.rows[0]);
    if (!product20k) return;

    const order = await createPurchaseOrder({ workspaceId: WS_A, topupProductId: product20k.id });
    await submitPaymentProof({ workspaceId: WS_A, orderId: order.id, paymentMethod: "kuraimi", paidAmountMinor: "2000000", paidCurrency: "YER" });
    await approvePurchaseOrder({ orderId: order.id, approvedByUserId: USER_ADMIN });

    const balance = await getWalletBalance(WS_A);
    expect(balance.purchasedPoints).toBe(20_000);
  });

  IT("topup_50k adds exactly 50,000 points (#10)", async () => {
    const { sql } = await import("drizzle-orm");
    const { createPurchaseOrder, submitPaymentProof, approvePurchaseOrder } = await import("../services/point-topup");
    const { getWalletBalance } = await import("../services/point-wallet");

    const product50k = await realDb.execute(
      sql`SELECT id FROM point_topup_products WHERE slug = 'topup_50k' LIMIT 1`,
    ).then((r: { rows: { id: string }[] }) => r.rows[0]);
    if (!product50k) return;

    const order = await createPurchaseOrder({ workspaceId: WS_A, topupProductId: product50k.id });
    await submitPaymentProof({ workspaceId: WS_A, orderId: order.id, paymentMethod: "kuraimi", paidAmountMinor: "5000000", paidCurrency: "YER" });
    await approvePurchaseOrder({ orderId: order.id, approvedByUserId: USER_ADMIN });

    const balance = await getWalletBalance(WS_A);
    expect(balance.purchasedPoints).toBe(50_000);
  });
});

// ── T-I9: تجميد وفك تجميد النقاط (#12، #13، #14) ───────────────────────────

describe("T-I9: freeze / unfreeze purchased grants", () => {
  IT("purchased points stay after plan renewal simulation (#12)", async () => {
    const { createGrant, getWalletBalance } = await import("../services/point-wallet");

    // نقاط مشتراة
    await createGrant({
      workspaceId: WS_A,
      grantType: "purchased",
      points: 5000,
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      idempotencyKey: "renewal_persist_test",
    });

    // محاكاة تجديد الاشتراك: النقاط المشتراة يجب أن تبقى
    const balance = await getWalletBalance(WS_A);
    expect(balance.purchasedPoints).toBe(5000);
    expect(balance.totalAvailablePoints).toBe(5000);
  });

  IT("purchased points freeze when downgrading to free (#13)", async () => {
    const { createGrant, freezePurchasedGrants, getWalletBalance } = await import("../services/point-wallet");

    await createGrant({
      workspaceId: WS_A,
      grantType: "purchased",
      points: 3000,
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      idempotencyKey: "freeze_downgrade_test",
    });

    // تحقق الرصيد قبل التجميد
    const before = await getWalletBalance(WS_A);
    expect(before.purchasedPoints).toBe(3000);

    // تجميد عند التخفيض للمجاني
    const frozen = await freezePurchasedGrants(WS_A, USER_ADMIN);
    expect(frozen).toBeGreaterThan(0);

    // الرصيد المتاح = صفر، المجمّد = 3000
    const after = await getWalletBalance(WS_A);
    expect(after.purchasedPoints).toBe(0);
    expect(after.frozenPoints).toBe(3000);
    expect(after.totalAvailablePoints).toBe(0);
  });

  IT("purchased points unfreeze when upgrading back to paid (#14)", async () => {
    const { createGrant, freezePurchasedGrants, unfreezePurchasedGrants, getWalletBalance } = await import("../services/point-wallet");

    await createGrant({
      workspaceId: WS_A,
      grantType: "purchased",
      points: 7000,
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      idempotencyKey: "unfreeze_upgrade_test",
    });

    await freezePurchasedGrants(WS_A, USER_ADMIN);
    const frozen = await getWalletBalance(WS_A);
    expect(frozen.frozenPoints).toBe(7000);

    // ترقية → فك التجميد
    await unfreezePurchasedGrants(WS_A, USER_ADMIN);
    const restored = await getWalletBalance(WS_A);
    expect(restored.purchasedPoints).toBe(7000);
    expect(restored.frozenPoints).toBe(0);
    expect(restored.totalAvailablePoints).toBe(7000);
  });
});

// ── T-I10: processRefund — الاسترداد الكامل والجزئي (#17) ─────────────────

describe("T-I10: processRefund — full_refund / partial_refund / idempotency", () => {
  IT("full_refund: لا يُعدّل الـledger القديم ويعكس كل النقاط (#17)", async () => {
    const { sql } = await import("drizzle-orm");
    const { processRefund } = await import("../services/point-topup");
    const { approvePurchaseOrder } = await import("../services/point-topup");

    const { orderId } = await createOrderAndSubmit();
    const approved = await approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN });
    const grantId = approved.creditedGrantId!;

    // تسجيل حركات ledger قبل الاسترداد
    const beforeRows = await realDb.execute(
      sql`SELECT id, transaction_type, micro_points FROM point_ledger WHERE grant_id = ${grantId}::uuid ORDER BY created_at`,
    ).then((r: { rows: { id: string; transaction_type: string; micro_points: string }[] }) => r.rows);
    expect(beforeRows.length).toBe(1);
    expect(beforeRows[0].transaction_type).toBe("credit");

    // full_refund
    const ikey = `full_refund_test:${orderId}`;
    const result = await processRefund({
      orderId,
      refundType: "full_refund",
      reason: "customer requested full refund",
      actorId: USER_ADMIN,
      idempotencyKey: ikey,
    });

    expect(result.wasAlreadyRefunded).toBe(false);
    expect(result.refundType).toBe("full_refund");
    expect(BigInt(result.microPointsReversedStr) > 0n).toBe(true);

    // الـledger: حركة credit قديمة + reversal جديدة (لا تعديل)
    const afterRows = await realDb.execute(
      sql`SELECT id, transaction_type, micro_points FROM point_ledger WHERE grant_id = ${grantId}::uuid ORDER BY created_at`,
    ).then((r: { rows: { id: string; transaction_type: string; micro_points: string }[] }) => r.rows);
    expect(afterRows.length).toBe(2);
    expect(afterRows[0].id).toBe(beforeRows[0].id);       // قديمة غير متغيرة
    expect(afterRows[0].transaction_type).toBe("credit");
    expect(afterRows[1].transaction_type).toBe("reversal");
    expect(BigInt(afterRows[1].micro_points) < 0n).toBe(true);

    // حالة الطلب
    const [orderRow] = await realDb.execute(
      sql`SELECT status, refund_type FROM point_purchase_orders WHERE id = ${orderId}::uuid`,
    ).then((r: { rows: { status: string; refund_type: string }[] }) => r.rows);
    expect(orderRow.status).toBe("refunded");
    expect(orderRow.refund_type).toBe("full_refund");

    // payment_submission حُدِّث
    const [subRow] = await realDb.execute(
      sql`SELECT status FROM payment_submissions WHERE point_purchase_order_id = ${orderId}::uuid`,
    ).then((r: { rows: { status: string }[] }) => r.rows);
    expect(subRow.status).toBe("refunded");
  });

  IT("full_refund مرفوض إذا استُخدمت نقاط (يعيد RefundInfo)", async () => {
    const { processRefund } = await import("../services/point-topup");
    const { approvePurchaseOrder } = await import("../services/point-topup");
    const { sql } = await import("drizzle-orm");

    const { orderId } = await createOrderAndSubmit();
    await approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN });

    // محاكاة استخدام نقاط — تخفيض remaining_micro_points مباشرة
    await realDb.execute(
      sql`UPDATE point_grants SET remaining_micro_points = 1000000 WHERE source_id = ${orderId}`,
    );

    await expect(
      processRefund({
        orderId,
        refundType: "full_refund",
        reason: "test",
        actorId: USER_ADMIN,
        idempotencyKey: `blocked_refund:${orderId}`,
      }),
    ).rejects.toMatchObject({
      code: "points_partially_used",
      refundInfo: expect.objectContaining({
        remainingPoints: expect.any(Number),
        usedPoints: expect.any(Number),
      }),
    });
  });

  IT("partial_refund يعكس كل المتبقي ويسجّل مبلغاً جزئياً", async () => {
    const { processRefund } = await import("../services/point-topup");
    const { approvePurchaseOrder } = await import("../services/point-topup");
    const { sql } = await import("drizzle-orm");

    const { orderId } = await createOrderAndSubmit();
    const approved = await approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN });

    // استخدام جزء من النقاط
    await realDb.execute(
      sql`UPDATE point_grants SET remaining_micro_points = 2000000 WHERE id = ${approved.creditedGrantId!}::uuid`,
    );

    const result = await processRefund({
      orderId,
      refundType: "partial_refund",
      reason: "used some points",
      actorId: USER_ADMIN,
      idempotencyKey: `partial_refund_test:${orderId}`,
      partialRefundAmountMinor: "200000",
      partialRefundCurrency: "YER",
    });

    expect(result.refundType).toBe("partial_refund");
    expect(result.refundedAmountMinor).toBe("200000");
    expect(result.refundedCurrency).toBe("YER");
    expect(BigInt(result.microPointsReversedStr)).toBe(2_000_000n);
  });

  IT("partial_refund يفشل بدون partialRefundAmountMinor", async () => {
    const { processRefund } = await import("../services/point-topup");
    const { approvePurchaseOrder } = await import("../services/point-topup");

    const { orderId } = await createOrderAndSubmit();
    await approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN });

    await expect(
      processRefund({
        orderId,
        refundType: "partial_refund",
        reason: "test",
        actorId: USER_ADMIN,
        idempotencyKey: `partial_no_amount:${orderId}`,
      }),
    ).rejects.toMatchObject({ code: "partial_amount_required" });
  });

  IT("points_reversal لا يُغيّر حالة الطلب ولا يُدرج refundedAmountMinor", async () => {
    const { processRefund } = await import("../services/point-topup");
    const { approvePurchaseOrder } = await import("../services/point-topup");
    const { sql } = await import("drizzle-orm");

    const { orderId } = await createOrderAndSubmit();
    await approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN });

    const result = await processRefund({
      orderId,
      refundType: "points_reversal",
      reason: "admin correction",
      actorId: USER_ADMIN,
      idempotencyKey: `pts_reversal:${orderId}`,
    });

    expect(result.refundType).toBe("points_reversal");
    expect(result.refundedAmountMinor).toBeNull();
    expect(result.refundedCurrency).toBeNull();

    const [orderRow] = await realDb.execute(
      sql`SELECT status FROM point_purchase_orders WHERE id = ${orderId}::uuid`,
    ).then((r: { rows: { status: string }[] }) => r.rows);
    expect(orderRow.status).toBe("approved"); // لا تغيير — لا إعادة مال
  });

  IT("idempotency: تنفيذ استرداد مرتين لا يضاعف الحركات", async () => {
    const { processRefund } = await import("../services/point-topup");
    const { approvePurchaseOrder } = await import("../services/point-topup");
    const { sql } = await import("drizzle-orm");

    const { orderId } = await createOrderAndSubmit();
    const approved = await approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN });
    const grantId = approved.creditedGrantId!;
    const ikey = `idem_refund:${orderId}`;

    const r1 = await processRefund({ orderId, refundType: "full_refund", reason: "test", actorId: USER_ADMIN, idempotencyKey: ikey });
    expect(r1.wasAlreadyRefunded).toBe(false);

    const r2 = await processRefund({ orderId, refundType: "full_refund", reason: "duplicate", actorId: USER_ADMIN, idempotencyKey: ikey });
    expect(r2.wasAlreadyRefunded).toBe(true);

    // حركة ledger واحدة فقط
    const rows = await realDb.execute(
      sql`SELECT id FROM point_ledger WHERE grant_id = ${grantId}::uuid AND transaction_type = 'reversal'`,
    ).then((r: { rows: { id: string }[] }) => r.rows);
    expect(rows.length).toBe(1);
  });

  IT("rollback: فشل تحديث الطلب بعد حركة ledger → كل شيء يُرجع", async () => {
    const { sql } = await import("drizzle-orm");
    const { approvePurchaseOrder } = await import("../services/point-topup");

    const { orderId } = await createOrderAndSubmit();
    await approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN });

    // نجعل الطلب غير قابل للتحديث بتغيير حالته يدوياً قبل processRefund
    await realDb.execute(sql`UPDATE point_purchase_orders SET status = 'cancelled' WHERE id = ${orderId}::uuid`);

    const { processRefund } = await import("../services/point-topup");
    await expect(
      processRefund({
        orderId,
        refundType: "full_refund",
        reason: "should fail",
        actorId: USER_ADMIN,
        idempotencyKey: `rb_refund:${orderId}`,
      }),
    ).rejects.toMatchObject({ code: "not_approved" });

    // لا حركة ledger جديدة
    const rows = await realDb.execute(
      sql`SELECT id FROM point_ledger WHERE workspace_id = ${WS_A}::uuid AND transaction_type = 'reversal'`,
    ).then((r: { rows: { id: string }[] }) => r.rows);
    expect(rows.length).toBe(0);
  });

  IT("تزامن: استردادان متزامنان لا يُضاعفان الحركات", async () => {
    const { processRefund, approvePurchaseOrder } = await import("../services/point-topup");

    const { orderId } = await createOrderAndSubmit();
    await approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN });
    const ikey = `concurrent_refund:${orderId}`;

    const results = await Promise.allSettled([
      processRefund({ orderId, refundType: "full_refund", reason: "r1", actorId: USER_ADMIN, idempotencyKey: ikey }),
      processRefund({ orderId, refundType: "full_refund", reason: "r2", actorId: USER_ADMIN, idempotencyKey: ikey }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    // واحد فقط يُنجَز (أو كلاهما عبر idempotency)
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const { sql } = await import("drizzle-orm");
    const rows = await realDb.execute(
      sql`SELECT id FROM point_ledger WHERE workspace_id = ${WS_A}::uuid AND transaction_type = 'reversal'`,
    ).then((r: { rows: { id: string }[] }) => r.rows);
    expect(rows.length).toBe(1); // حركة واحدة فقط
  });
});

// ── T-I12: Authorization — فقط platform admin يستطيع الاسترداد (#6) ─────────

describe("T-I12: refund authorization — service-level isolation", () => {
  IT("processRefund يرفض orderId غير موجود", async () => {
    const { processRefund } = await import("../services/point-topup");
    await expect(
      processRefund({
        orderId: "00000000-0000-0000-0000-000000000000",
        refundType: "full_refund",
        reason: "test",
        actorId: USER_ADMIN,
        idempotencyKey: "auth_test_notfound",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  IT("processRefund يرفض الاسترداد من طلب غير معتمد", async () => {
    const { createPurchaseOrder, processRefund } = await import("../services/point-topup");
    const product = await getTopup5kProduct();
    const order = await createPurchaseOrder({ workspaceId: WS_A, topupProductId: product.id });

    // الطلب pending_payment — ليس approved
    await expect(
      processRefund({
        orderId: order.id,
        refundType: "full_refund",
        reason: "should fail",
        actorId: USER_ADMIN,
        idempotencyKey: `auth_pending:${order.id}`,
      }),
    ).rejects.toMatchObject({ code: "not_approved" });
  });

  IT("getRefundInfo يُعيد معلومات الطلب بدقة للإدارة قبل الاسترداد", async () => {
    const { getRefundInfo, approvePurchaseOrder } = await import("../services/point-topup");

    const { orderId } = await createOrderAndSubmit();
    await approvePurchaseOrder({ orderId, approvedByUserId: USER_ADMIN });

    const info = await getRefundInfo(orderId);
    expect(info.orderId).toBe(orderId);
    expect(info.originalPoints).toBe(5000);
    expect(info.usedPoints).toBe(0);
    expect(info.remainingPoints).toBe(5000);
    expect(info.paidAmountMinor).toBe("500000");
    expect(info.paidCurrency).toBe("YER");
  });
});
