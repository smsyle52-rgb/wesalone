import { and, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import {
  db,
  pointWalletsTable,
  pointGrantsTable,
  pointLedgerTable,
  type PointGrant,
  type PointLedgerEntry,
} from "@workspace/db";
import { logger } from "../lib/logger";

// 1 نقطة مرئية = 1,000,000 micro_points (بنية داخلية فقط — لا تُعرض للتجار)
export const MICRO_POINTS_PER_POINT = 1_000_000;
const MICRO_POINTS_BIG = 1_000_000n;

// ── تحويل بين نقاط مرئية (number) وmicro_points داخلي (bigint) ───────────────

export function toMicroPoints(visiblePoints: number): bigint {
  return BigInt(Math.round(visiblePoints)) * MICRO_POINTS_BIG;
}

export function toVisiblePoints(microPoints: bigint): number {
  return Number(microPoints / MICRO_POINTS_BIG);
}

// تحويل آمن لـJSON — يُستخدم عند إعادة micro_points في API responses
export function microPointsToString(v: bigint): string {
  return v.toString();
}

// ── Wallet Management ──────────────────────────────────────────────────────────

export async function getOrCreateWallet(workspaceId: string): Promise<{ id: string; status: string }> {
  const [existing] = await db
    .select({ id: pointWalletsTable.id, status: pointWalletsTable.status })
    .from(pointWalletsTable)
    .where(eq(pointWalletsTable.workspaceId, workspaceId))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(pointWalletsTable)
    .values({ workspaceId })
    .onConflictDoNothing()
    .returning({ id: pointWalletsTable.id, status: pointWalletsTable.status });
  if (created) return created;

  // سباق: طلب آخر أدرج أولاً
  const [refetch] = await db
    .select({ id: pointWalletsTable.id, status: pointWalletsTable.status })
    .from(pointWalletsTable)
    .where(eq(pointWalletsTable.workspaceId, workspaceId))
    .limit(1);
  if (!refetch) throw new Error(`wallet creation failed for workspace ${workspaceId}`);
  return refetch;
}

// ── Balance (محسوب من grants، لا عمود ثابت) ──────────────────────────────────

/**
 * WalletBalance — الرصيد يُعاد بناؤه من حالة الـgrants في كل استدعاء (لا balance_snapshot).
 *
 * قرار التصميم (§3 من المواصفة):
 *   الرصيد لا يُخزَّن كقيمة مُجمَّعة في الـDB؛ يُحسب دائماً من remainingMicroPoints
 *   في جدول point_grants. الـledger سجل أحداث audit فقط — القيم السالبة تعني خصم/انتهاء/عكس.
 *   هذا يضمن: لا تناقض بين الجداول، وكل تعديل على grant ينعكس فوراً على الرصيد.
 *   مرجع الاتساق: point_grants.remaining_micro_points هو مصدر الحقيقة الوحيد.
 */
export type WalletBalance = {
  walletId: string;
  walletStatus: string;
  monthlyPoints: number;
  purchasedPoints: number;
  frozenPoints: number;
  totalAvailablePoints: number;
  nearestExpiry: Date | null;
};

export async function getWalletBalance(workspaceId: string): Promise<WalletBalance> {
  const wallet = await getOrCreateWallet(workspaceId);
  const now = new Date();

  const grants = await db
    .select()
    .from(pointGrantsTable)
    .where(
      and(
        eq(pointGrantsTable.workspaceId, workspaceId),
        or(eq(pointGrantsTable.status, "active"), eq(pointGrantsTable.status, "frozen")),
        or(isNull(pointGrantsTable.expiresAt), gt(pointGrantsTable.expiresAt, now)),
      ),
    );

  let monthlyMicro = 0n;
  let purchasedMicro = 0n;
  let frozenMicro = 0n;
  let nearestExpiry: Date | null = null;

  for (const grant of grants) {
    if (grant.status === "frozen") {
      frozenMicro += grant.remainingMicroPoints;
      continue;
    }
    if (grant.grantType === "monthly_subscription") {
      monthlyMicro += grant.remainingMicroPoints;
    } else {
      purchasedMicro += grant.remainingMicroPoints;
      if (grant.expiresAt && (!nearestExpiry || grant.expiresAt < nearestExpiry)) {
        nearestExpiry = grant.expiresAt;
      }
    }
  }

  return {
    walletId: wallet.id,
    walletStatus: wallet.status,
    monthlyPoints: toVisiblePoints(monthlyMicro),
    purchasedPoints: toVisiblePoints(purchasedMicro),
    frozenPoints: toVisiblePoints(frozenMicro),
    totalAvailablePoints: toVisiblePoints(monthlyMicro + purchasedMicro),
    nearestExpiry,
  };
}

// ── Grant Creation (exactly-once via idempotencyKey) ──────────────────────────

export type CreateGrantOptions = {
  workspaceId: string;
  grantType: string;
  points: number;
  startsAt?: Date;
  expiresAt?: Date | null;
  sourceType?: string;
  sourceId?: string;
  idempotencyKey: string;
  actorType?: string;
  actorId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTx = PgTransaction<any, any, any>;

/**
 * createGrant: exactly-once via idempotencyKey.
 * يقبل tx اختيارياً ليعمل داخل transaction خارجية (مثل approvePurchaseOrder).
 * بدون tx يفتح transaction داخلية مستقلة.
 */
export async function createGrant(
  opts: CreateGrantOptions,
  externalTx?: AnyTx,
): Promise<PointGrant> {
  const wallet = await getOrCreateWallet(opts.workspaceId);
  const microPoints = toMicroPoints(opts.points); // bigint
  const now = new Date();

  const run = async (tx: AnyTx) => {
    const [existing] = await tx
      .select()
      .from(pointGrantsTable)
      .where(eq(pointGrantsTable.idempotencyKey, opts.idempotencyKey))
      .limit(1);
    if (existing) return existing;

    const [grant] = await tx
      .insert(pointGrantsTable)
      .values({
        workspaceId: opts.workspaceId,
        walletId: wallet.id,
        grantType: opts.grantType,
        originalMicroPoints: microPoints,
        remainingMicroPoints: microPoints,
        startsAt: opts.startsAt ?? now,
        expiresAt: opts.expiresAt ?? null,
        status: "active",
        sourceType: opts.sourceType ?? null,
        sourceId: opts.sourceId ?? null,
        idempotencyKey: opts.idempotencyKey,
        metadata: opts.metadata ?? {},
      })
      .returning();

    await tx.insert(pointLedgerTable).values({
      workspaceId: opts.workspaceId,
      walletId: wallet.id,
      grantId: grant.id,
      transactionType: "credit",
      microPoints,
      sourceType: opts.sourceType ?? null,
      sourceId: opts.sourceId ?? null,
      idempotencyKey: `credit:${opts.idempotencyKey}`,
      reason: opts.reason ?? `grant:${opts.grantType}`,
      actorType: opts.actorType ?? "system",
      actorId: opts.actorId ?? null,
    });

    return grant;
  };

  if (externalTx) return run(externalTx);
  return db.transaction(run);
}

// ── Freeze / Unfreeze (عند التخفيض لمجاني / الترقية لمدفوع) ─────────────────

export async function freezePurchasedGrants(workspaceId: string, actorId?: string): Promise<number> {
  const now = new Date();
  const wallet = await getOrCreateWallet(workspaceId);

  return db.transaction(async (tx) => {
    const grants = await tx
      .select()
      .from(pointGrantsTable)
      .where(
        and(
          eq(pointGrantsTable.workspaceId, workspaceId),
          eq(pointGrantsTable.grantType, "purchased"),
          eq(pointGrantsTable.status, "active"),
          or(isNull(pointGrantsTable.expiresAt), gt(pointGrantsTable.expiresAt, now)),
        ),
      );

    if (!grants.length) return 0;

    await tx
      .update(pointGrantsTable)
      .set({ status: "frozen", updatedAt: now })
      .where(
        and(
          eq(pointGrantsTable.workspaceId, workspaceId),
          eq(pointGrantsTable.grantType, "purchased"),
          eq(pointGrantsTable.status, "active"),
        ),
      );

    for (const grant of grants) {
      await tx.insert(pointLedgerTable).values({
        workspaceId,
        walletId: wallet.id,
        grantId: grant.id,
        transactionType: "admin_adjustment",
        microPoints: 0n,
        sourceType: "system",
        sourceId: null,
        idempotencyKey: `freeze:${grant.id}:${now.getTime()}`,
        reason: "freeze:downgrade_to_free",
        actorType: "system",
        actorId: actorId ?? null,
      });
    }

    return grants.length;
  });
}

export async function unfreezePurchasedGrants(workspaceId: string, actorId?: string): Promise<number> {
  const now = new Date();
  const wallet = await getOrCreateWallet(workspaceId);

  return db.transaction(async (tx) => {
    const grants = await tx
      .select()
      .from(pointGrantsTable)
      .where(
        and(
          eq(pointGrantsTable.workspaceId, workspaceId),
          eq(pointGrantsTable.grantType, "purchased"),
          eq(pointGrantsTable.status, "frozen"),
          or(isNull(pointGrantsTable.expiresAt), gt(pointGrantsTable.expiresAt, now)),
        ),
      );

    if (!grants.length) return 0;

    await tx
      .update(pointGrantsTable)
      .set({ status: "active", updatedAt: now })
      .where(
        and(
          eq(pointGrantsTable.workspaceId, workspaceId),
          eq(pointGrantsTable.grantType, "purchased"),
          eq(pointGrantsTable.status, "frozen"),
        ),
      );

    for (const grant of grants) {
      await tx.insert(pointLedgerTable).values({
        workspaceId,
        walletId: wallet.id,
        grantId: grant.id,
        transactionType: "admin_adjustment",
        microPoints: 0n,
        sourceType: "system",
        sourceId: null,
        idempotencyKey: `unfreeze:${grant.id}:${now.getTime()}`,
        reason: "unfreeze:upgrade_to_paid",
        actorType: "system",
        actorId: actorId ?? null,
      });
    }

    return grants.length;
  });
}

// ── Expiry Job (idempotent — تشغيل يومي) ─────────────────────────────────────

export async function expireStaleGrants(): Promise<{ expired: number; microPointsExpiredStr: string }> {
  const now = new Date();

  const expiredGrants = await db
    .select()
    .from(pointGrantsTable)
    .where(
      and(
        eq(pointGrantsTable.status, "active"),
        isNotNull(pointGrantsTable.expiresAt),
        lt(pointGrantsTable.expiresAt, now),
        gt(pointGrantsTable.remainingMicroPoints, 0n),
      ),
    );

  if (!expiredGrants.length) return { expired: 0, microPointsExpiredStr: "0" };

  // batch wallet lookups
  const wsIds = [...new Set(expiredGrants.map((g) => g.workspaceId))];
  const wallets = await db
    .select({ id: pointWalletsTable.id, workspaceId: pointWalletsTable.workspaceId })
    .from(pointWalletsTable)
    .where(inArray(pointWalletsTable.workspaceId, wsIds));
  const walletMap = new Map(wallets.map((w) => [w.workspaceId, w.id]));

  let totalMicro = 0n;
  let processed = 0;

  for (const grant of expiredGrants) {
    const walletId = walletMap.get(grant.workspaceId);
    if (!walletId) continue;

    try {
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(pointGrantsTable)
          .where(and(eq(pointGrantsTable.id, grant.id), eq(pointGrantsTable.status, "active")))
          .limit(1);

        if (!current || current.remainingMicroPoints <= 0n) return;

        await tx
          .update(pointGrantsTable)
          .set({ status: "expired", remainingMicroPoints: 0n, updatedAt: now })
          .where(eq(pointGrantsTable.id, grant.id));

        await tx.insert(pointLedgerTable).values({
          workspaceId: grant.workspaceId,
          walletId,
          grantId: grant.id,
          transactionType: "expiration",
          microPoints: -current.remainingMicroPoints,
          sourceType: "system",
          sourceId: null,
          idempotencyKey: `expire:${grant.id}`,
          reason: "12_month_expiry",
          actorType: "system",
          actorId: null,
        });

        totalMicro += current.remainingMicroPoints;
        processed++;
      });
    } catch (err) {
      logger.warn({ err, grantId: grant.id }, "expireStaleGrants: skipping grant");
    }
  }

  return { expired: processed, microPointsExpiredStr: totalMicro.toString() };
}

// ── Admin Manual Adjustment (with required reason) ────────────────────────────

export type AdminAdjustmentOptions = {
  workspaceId: string;
  points: number; // موجب فقط — الخصم الإداري مُعطَّل حتى Phase 3
  reason: string;
  actorId: string;
  idempotencyKey: string;
};

export async function adminAdjustPoints(opts: AdminAdjustmentOptions): Promise<void> {
  if (opts.points <= 0) {
    throw Object.assign(
      new Error("NEGATIVE_ADJUSTMENT_DISABLED"),
      { code: "negative_adjustment_disabled" },
    );
  }
  const wallet = await getOrCreateWallet(opts.workspaceId);
  const microPoints = toMicroPoints(opts.points);
  const now = new Date();

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: pointLedgerTable.id })
      .from(pointLedgerTable)
      .where(eq(pointLedgerTable.idempotencyKey, opts.idempotencyKey))
      .limit(1);
    if (existing) return; // idempotent

    const [grant] = await tx
      .insert(pointGrantsTable)
      .values({
        workspaceId: opts.workspaceId,
        walletId: wallet.id,
        grantType: "admin_adjustment",
        originalMicroPoints: microPoints,
        remainingMicroPoints: microPoints,
        startsAt: now,
        expiresAt: null,
        status: "active",
        sourceType: "admin",
        sourceId: opts.actorId,
        idempotencyKey: `adj_grant:${opts.idempotencyKey}`,
        metadata: { reason: opts.reason },
      })
      .returning();

    await tx.insert(pointLedgerTable).values({
      workspaceId: opts.workspaceId,
      walletId: wallet.id,
      grantId: grant.id,
      transactionType: "admin_adjustment",
      microPoints,
      sourceType: "admin",
      sourceId: opts.actorId,
      idempotencyKey: opts.idempotencyKey,
      reason: opts.reason,
      actorType: "admin",
      actorId: opts.actorId,
    });
  });
}

// ── Ledger Query ──────────────────────────────────────────────────────────────

export async function getLedgerEntries(
  workspaceId: string,
  limit = 50,
  offset = 0,
): Promise<PointLedgerEntry[]> {
  await getOrCreateWallet(workspaceId); // ensure wallet exists
  return db
    .select()
    .from(pointLedgerTable)
    .where(eq(pointLedgerTable.workspaceId, workspaceId))
    .orderBy(sql`${pointLedgerTable.createdAt} DESC`)
    .limit(limit)
    .offset(offset);
}
