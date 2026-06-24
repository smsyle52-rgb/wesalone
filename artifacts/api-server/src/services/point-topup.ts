import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  plansTable,
  subscriptionsTable,
  pointTopupProductsTable,
  pointPurchaseOrdersTable,
  paymentSubmissionsTable,
  pointGrantsTable,
  pointLedgerTable,
  type PointTopupProduct,
  type PointPurchaseOrder,
} from "@workspace/db";
import { createGrant, toVisiblePoints } from "./point-wallet";

const PAID_PLAN_SLUGS = ["starter", "growth", "professional", "business"] as const;

// حد أقصى للطلبات المعلقة لكل workspace (anti-abuse)
const MAX_PENDING_ORDERS = 3;

export type TopupEligibility = {
  eligible: boolean;
  reason?: string;
  planSlug: string | null;
};

export async function checkTopupEligibility(workspaceId: string): Promise<TopupEligibility> {
  const [sub] = await db
    .select({ status: subscriptionsTable.status, planSlug: plansTable.slug })
    .from(subscriptionsTable)
    .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(eq(subscriptionsTable.workspaceId, workspaceId))
    .limit(1);

  if (!sub) return { eligible: false, reason: "no_subscription", planSlug: null };

  if (!PAID_PLAN_SLUGS.includes(sub.planSlug as typeof PAID_PLAN_SLUGS[number])) {
    return { eligible: false, reason: "free_plan", planSlug: sub.planSlug };
  }

  if (sub.status !== "active" && sub.status !== "trialing") {
    return { eligible: false, reason: "inactive_subscription", planSlug: sub.planSlug };
  }

  return { eligible: true, planSlug: sub.planSlug };
}

export async function listActiveTopupProducts(): Promise<PointTopupProduct[]> {
  const now = new Date();
  return db
    .select()
    .from(pointTopupProductsTable)
    .where(
      and(
        eq(pointTopupProductsTable.isActive, true),
        or(isNull(pointTopupProductsTable.effectiveFrom), sql`${pointTopupProductsTable.effectiveFrom} <= ${now}`),
        or(isNull(pointTopupProductsTable.effectiveUntil), sql`${pointTopupProductsTable.effectiveUntil} > ${now}`),
      ),
    )
    .orderBy(pointTopupProductsTable.sortOrder);
}

export async function createPurchaseOrder(opts: {
  workspaceId: string;
  topupProductId: string;
}): Promise<PointPurchaseOrder> {
  const eligibility = await checkTopupEligibility(opts.workspaceId);
  if (!eligibility.eligible) {
    throw Object.assign(new Error("NOT_ELIGIBLE"), { code: eligibility.reason });
  }

  // السعر والنقاط من الخادم — لا نثق بالعميل
  const [product] = await db
    .select()
    .from(pointTopupProductsTable)
    .where(and(eq(pointTopupProductsTable.id, opts.topupProductId), eq(pointTopupProductsTable.isActive, true)))
    .limit(1);

  if (!product) throw Object.assign(new Error("PRODUCT_NOT_FOUND"), { code: "product_not_found" });

  if (product.allowedPlanSlugs.length > 0 && eligibility.planSlug) {
    if (!product.allowedPlanSlugs.includes(eligibility.planSlug)) {
      throw Object.assign(new Error("PLAN_NOT_ALLOWED"), { code: "plan_not_allowed" });
    }
  }

  // anti-abuse: حد الطلبات المعلقة
  const [{ pendingCount }] = await db
    .select({ pendingCount: sql<number>`count(*)::int` })
    .from(pointPurchaseOrdersTable)
    .where(
      and(
        eq(pointPurchaseOrdersTable.workspaceId, opts.workspaceId),
        or(
          eq(pointPurchaseOrdersTable.status, "pending_payment"),
          eq(pointPurchaseOrdersTable.status, "payment_submitted"),
          eq(pointPurchaseOrdersTable.status, "under_review"),
        ),
      ),
    );

  if ((pendingCount ?? 0) >= MAX_PENDING_ORDERS) {
    throw Object.assign(new Error("TOO_MANY_PENDING"), { code: "max_pending_reached" });
  }

  const idempotencyKey = `order:${opts.workspaceId}:${Date.now()}:${randomUUID().slice(0, 8)}`;

  const [order] = await db
    .insert(pointPurchaseOrdersTable)
    .values({
      workspaceId: opts.workspaceId,
      topupProductId: product.id,
      productSlugSnapshot: product.slug,
      productNameSnapshot: product.nameAr,
      pointsSnapshot: product.points,
      priceCentsSnapshot: product.priceCents,
      currencySnapshot: product.currency,
      status: "pending_payment",
      idempotencyKey,
    })
    .returning();

  return order;
}

export async function submitPaymentProof(opts: {
  workspaceId: string;
  orderId: string;
  paymentMethod: string;
  /** المبلغ المدفوع بالوحدات الصغرى كـstring آمن (لا float). مثل: "70000" = $700.00 */
  paidAmountMinor: string;
  /** رمز ISO للعملة: YER | USD | SAR | … */
  paidCurrency: string;
  paymentReference?: string;
  paymentReceiptNote?: string;
  receiptFileUrl?: string;
}): Promise<PointPurchaseOrder> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(pointPurchaseOrdersTable)
      .where(
        and(
          eq(pointPurchaseOrdersTable.id, opts.orderId),
          eq(pointPurchaseOrdersTable.workspaceId, opts.workspaceId),
        ),
      )
      .for("update")
      .limit(1);

    if (!existing) throw Object.assign(new Error("ORDER_NOT_FOUND"), { code: "not_found" });
    if (existing.status !== "pending_payment") {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "invalid_status", currentStatus: existing.status });
    }

    // إنشاء سجل payment_submission (paidAmountMinor + paidCurrency — لا amountYer)
    await tx.insert(paymentSubmissionsTable).values({
      workspaceId: opts.workspaceId,
      submissionType: "point_topup",
      planId: null,
      pointPurchaseOrderId: opts.orderId,
      paidAmountMinor: opts.paidAmountMinor,
      paidCurrency: opts.paidCurrency,
      paymentMethod: opts.paymentMethod,
      reference: opts.paymentReference ?? null,
      receiptNote: opts.paymentReceiptNote ?? null,
      receiptFileUrl: opts.receiptFileUrl ?? null,
      status: "pending",
    });

    // تحديث order: حالة + snapshot المبلغ
    const [updated] = await tx
      .update(pointPurchaseOrdersTable)
      .set({
        status: "under_review",
        paidAmountMinor: opts.paidAmountMinor,
        paidCurrency: opts.paidCurrency,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pointPurchaseOrdersTable.id, opts.orderId),
          eq(pointPurchaseOrdersTable.workspaceId, opts.workspaceId),
          eq(pointPurchaseOrdersTable.status, "pending_payment"),
        ),
      )
      .returning();

    if (!updated) throw Object.assign(new Error("CONCURRENT_UPDATE"), { code: "concurrent_update" });
    return updated;
  });
}

export async function approvePurchaseOrder(opts: {
  orderId: string;
  approvedByUserId: string;
}): Promise<PointPurchaseOrder> {
  return db.transaction(async (tx) => {
    // ① قفل صف الطلب FOR UPDATE — يمنع الاعتماد المتزامن
    // نستخدم Drizzle ORM (لا raw SQL) لضمان camelCase mapping الصحيح
    const [order] = await tx
      .select()
      .from(pointPurchaseOrdersTable)
      .where(eq(pointPurchaseOrdersTable.id, opts.orderId))
      .for("update")
      .limit(1);

    if (!order) throw Object.assign(new Error("ORDER_NOT_FOUND"), { code: "not_found" });

    // ② إعادة التحقق من الحالة داخل نفس الـtransaction
    if (order.status !== "under_review") {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "not_under_review", currentStatus: order.status });
    }

    // ③ exactly-once guard: creditedGrantId يُعيَّن مرة واحدة فقط
    if (order.creditedGrantId) {
      throw Object.assign(new Error("ALREADY_CREDITED"), { code: "already_credited" });
    }

    // ④ تحقق من إثبات الدفع المرتبط (بند 7: التحقق من صحة الاعتماد)
    const submissionRows = await tx.execute(
      sql`SELECT * FROM payment_submissions
          WHERE point_purchase_order_id = ${opts.orderId}
            AND workspace_id = ${order.workspaceId}
            AND submission_type = 'point_topup'
            AND status = 'pending'
          LIMIT 1`,
    );
    const submission = submissionRows.rows[0] as { id: string } | undefined;
    if (!submission) {
      throw Object.assign(
        new Error("NO_PAYMENT_SUBMISSION"),
        { code: "no_payment_submission" },
      );
    }

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1); // 12 شهراً

    // ⑤ إنشاء grant داخل نفس الـtransaction (tx مُمرَّر)
    const grant = await createGrant(
      {
        workspaceId: order.workspaceId,
        grantType: "purchased",
        points: order.pointsSnapshot,
        startsAt: now,
        expiresAt,
        sourceType: "point_purchase_order",
        sourceId: order.id,
        idempotencyKey: `topup_grant:${order.id}`,
        actorType: "admin",
        actorId: opts.approvedByUserId,
        reason: `topup:${order.productSlugSnapshot}`,
      },
      tx,
    );

    // ⑥ تحديث حالة الطلب + ربط الـgrant (WHERE يمنع تحديثاً مزدوجاً)
    const [updated] = await tx
      .update(pointPurchaseOrdersTable)
      .set({
        status: "approved",
        approvedAt: now,
        approvedBy: opts.approvedByUserId,
        creditedGrantId: grant.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(pointPurchaseOrdersTable.id, order.id),
          eq(pointPurchaseOrdersTable.status, "under_review"),
          isNull(pointPurchaseOrdersTable.creditedGrantId),
        ),
      )
      .returning();

    if (!updated) throw Object.assign(new Error("CONCURRENT_UPDATE"), { code: "concurrent_update" });

    // ⑦ تحديث payment_submission إلى 'approved' داخل نفس الـtransaction (بند 6)
    await tx.execute(
      sql`UPDATE payment_submissions
          SET status = 'approved',
              reviewed_by = ${opts.approvedByUserId},
              reviewed_at = ${now}
          WHERE id = ${submission.id}`,
    );

    return updated;
  });
}

export async function rejectPurchaseOrder(opts: {
  orderId: string;
  rejectedByUserId: string;
  reason: string;
}): Promise<PointPurchaseOrder> {
  return db.transaction(async (tx) => {
    // Drizzle ORM مع FOR UPDATE لضمان camelCase mapping
    const [existing] = await tx
      .select()
      .from(pointPurchaseOrdersTable)
      .where(eq(pointPurchaseOrdersTable.id, opts.orderId))
      .for("update")
      .limit(1);

    if (!existing) throw Object.assign(new Error("ORDER_NOT_FOUND"), { code: "not_found" });

    if (!["under_review", "payment_submitted"].includes(existing.status)) {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "not_reviewable", currentStatus: existing.status });
    }

    const now = new Date();

    const [updated] = await tx
      .update(pointPurchaseOrdersTable)
      .set({
        status: "rejected",
        rejectedAt: now,
        rejectedBy: opts.rejectedByUserId,
        rejectionReason: opts.reason,
        updatedAt: now,
      })
      .where(
        and(
          eq(pointPurchaseOrdersTable.id, opts.orderId),
          or(
            eq(pointPurchaseOrdersTable.status, "under_review"),
            eq(pointPurchaseOrdersTable.status, "payment_submitted"),
          ),
        ),
      )
      .returning();

    if (!updated) throw Object.assign(new Error("CONCURRENT_UPDATE"), { code: "concurrent_update" });

    // تحديث payment_submission إلى 'rejected' داخل نفس الـtransaction (بند 6)
    await tx.execute(
      sql`UPDATE payment_submissions
          SET status = 'rejected',
              reviewed_by = ${opts.rejectedByUserId},
              reviewed_at = ${now}
          WHERE point_purchase_order_id = ${opts.orderId}
            AND submission_type = 'point_topup'
            AND status = 'pending'`,
    );

    return updated;
  });
}

export async function cancelPurchaseOrder(opts: {
  workspaceId: string;
  orderId: string;
}): Promise<PointPurchaseOrder> {
  const [existing] = await db
    .select()
    .from(pointPurchaseOrdersTable)
    .where(
      and(
        eq(pointPurchaseOrdersTable.id, opts.orderId),
        eq(pointPurchaseOrdersTable.workspaceId, opts.workspaceId),
      ),
    )
    .limit(1);

  if (!existing) throw Object.assign(new Error("ORDER_NOT_FOUND"), { code: "not_found" });
  if (existing.status !== "pending_payment") {
    throw Object.assign(new Error("INVALID_STATUS"), { code: "cannot_cancel", currentStatus: existing.status });
  }

  const [updated] = await db
    .update(pointPurchaseOrdersTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(pointPurchaseOrdersTable.id, opts.orderId),
        eq(pointPurchaseOrdersTable.workspaceId, opts.workspaceId),
        eq(pointPurchaseOrdersTable.status, "pending_payment"),
      ),
    )
    .returning();

  if (!updated) throw Object.assign(new Error("CONCURRENT_UPDATE"), { code: "concurrent_update" });
  return updated;
}

export async function listPurchaseOrders(
  workspaceId: string,
  limit = 20,
  offset = 0,
): Promise<PointPurchaseOrder[]> {
  return db
    .select()
    .from(pointPurchaseOrdersTable)
    .where(eq(pointPurchaseOrdersTable.workspaceId, workspaceId))
    .orderBy(desc(pointPurchaseOrdersTable.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function listAllOrdersAdmin(status?: string, limit = 50, offset = 0) {
  const whereClause = status && status !== "all"
    ? eq(pointPurchaseOrdersTable.status, status)
    : undefined;

  return db
    .select({
      id: pointPurchaseOrdersTable.id,
      workspaceId: pointPurchaseOrdersTable.workspaceId,
      productSlugSnapshot: pointPurchaseOrdersTable.productSlugSnapshot,
      productNameSnapshot: pointPurchaseOrdersTable.productNameSnapshot,
      pointsSnapshot: pointPurchaseOrdersTable.pointsSnapshot,
      priceCentsSnapshot: pointPurchaseOrdersTable.priceCentsSnapshot,
      currencySnapshot: pointPurchaseOrdersTable.currencySnapshot,
      status: pointPurchaseOrdersTable.status,
      approvedAt: pointPurchaseOrdersTable.approvedAt,
      approvedBy: pointPurchaseOrdersTable.approvedBy,
      rejectedAt: pointPurchaseOrdersTable.rejectedAt,
      rejectionReason: pointPurchaseOrdersTable.rejectionReason,
      creditedGrantId: pointPurchaseOrdersTable.creditedGrantId,
      idempotencyKey: pointPurchaseOrdersTable.idempotencyKey,
      createdAt: pointPurchaseOrdersTable.createdAt,
      updatedAt: pointPurchaseOrdersTable.updatedAt,
    })
    .from(pointPurchaseOrdersTable)
    .where(whereClause)
    .orderBy(desc(pointPurchaseOrdersTable.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function listTopupProductsAdmin() {
  return db.select().from(pointTopupProductsTable).orderBy(pointTopupProductsTable.sortOrder);
}

// ── Refund ────────────────────────────────────────────────────────────────────

export type RefundType = "full_refund" | "partial_refund" | "points_reversal" | "chargeback";

export type RefundInfo = {
  orderId: string;
  originalPoints: number;
  usedPoints: number;
  remainingPoints: number;
  originalMicroPointsStr: string;
  usedMicroPointsStr: string;
  remainingMicroPointsStr: string;
  paidAmountMinor: string | null;
  paidCurrency: string | null;
  priceCentsSnapshot: number;
  currencySnapshot: string;
};

export type ProcessRefundOpts = {
  orderId: string;
  refundType: RefundType;
  reason: string;
  actorId: string;
  idempotencyKey: string;
  /** مطلوب فقط لـpartial_refund — المبلغ المُستردّ بالوحدات الصغرى */
  partialRefundAmountMinor?: string;
  partialRefundCurrency?: string;
};

export type ProcessRefundResult = {
  orderId: string;
  refundType: RefundType;
  microPointsReversedStr: string;
  wasAlreadyRefunded: boolean;
  refundedAmountMinor: string | null;
  refundedCurrency: string | null;
};

/**
 * getRefundInfo — قراءة معلومات الطلب لعرضها قبل تنفيذ الاسترداد.
 * يُعيد أصل النقاط، المستخدم، المتبقي، وأقصى مبلغ قابل للاسترداد.
 */
export async function getRefundInfo(orderId: string): Promise<RefundInfo> {
  const [order] = await db
    .select()
    .from(pointPurchaseOrdersTable)
    .where(eq(pointPurchaseOrdersTable.id, orderId))
    .limit(1);

  if (!order) throw Object.assign(new Error("ORDER_NOT_FOUND"), { code: "not_found" });
  if (order.status !== "approved") {
    throw Object.assign(new Error("NOT_APPROVED"), { code: "not_approved", currentStatus: order.status });
  }
  if (!order.creditedGrantId) {
    throw Object.assign(new Error("NO_GRANT"), { code: "no_grant" });
  }

  const [grant] = await db
    .select()
    .from(pointGrantsTable)
    .where(eq(pointGrantsTable.id, order.creditedGrantId))
    .limit(1);

  if (!grant) throw Object.assign(new Error("GRANT_NOT_FOUND"), { code: "not_found" });

  const originalMp = grant.originalMicroPoints;
  const remainingMp = grant.remainingMicroPoints;
  const usedMp = originalMp - remainingMp;

  return {
    orderId,
    originalPoints: toVisiblePoints(originalMp),
    usedPoints: toVisiblePoints(usedMp),
    remainingPoints: toVisiblePoints(remainingMp),
    originalMicroPointsStr: originalMp.toString(),
    usedMicroPointsStr: usedMp.toString(),
    remainingMicroPointsStr: remainingMp.toString(),
    paidAmountMinor: order.paidAmountMinor ?? null,
    paidCurrency: order.paidCurrency ?? null,
    priceCentsSnapshot: order.priceCentsSnapshot,
    currencySnapshot: order.currencySnapshot,
  };
}

/**
 * processRefund — استرداد ذري idempotent في transaction واحدة.
 *
 * 10 خطوات:
 * 1. SELECT FOR UPDATE على الطلب
 * 2. التحقق من الحالة والـgrant
 * 3. idempotency check على refundIdempotencyKey
 * 4. SELECT FOR UPDATE على الـgrant
 * 5. حساب المستخدم والمتبقي
 * 6. full_refund → خطأ 422 إن وُجدت نقاط مستخدمة (عرض RefundInfo للإدارة)
 * 7. partial_refund → التحقق من partial amount
 * 8. حركة reversal في ledger (سالبة بالمتبقي)
 * 9. تحديث grant (remaining=0, status=reversed)
 * 10. تحديث order + payment_submission → commit
 */
export async function processRefund(opts: ProcessRefundOpts): Promise<ProcessRefundResult> {
  if (opts.refundType === "partial_refund") {
    if (!opts.partialRefundAmountMinor || !opts.partialRefundCurrency) {
      throw Object.assign(
        new Error("PARTIAL_AMOUNT_REQUIRED"),
        { code: "partial_amount_required" },
      );
    }
  }

  return db.transaction(async (tx) => {
    // ① قفل الطلب
    const [order] = await tx
      .select()
      .from(pointPurchaseOrdersTable)
      .where(eq(pointPurchaseOrdersTable.id, opts.orderId))
      .for("update")
      .limit(1);

    if (!order) throw Object.assign(new Error("ORDER_NOT_FOUND"), { code: "not_found" });

    // ② idempotency check قبل فحص الحالة — نعيد نتيجة حتى لو الطلب تغيّرت حالته
    if (order.refundIdempotencyKey === opts.idempotencyKey) {
      return {
        orderId: order.id,
        refundType: order.refundType as RefundType,
        microPointsReversedStr: "0",
        wasAlreadyRefunded: true,
        refundedAmountMinor: order.refundedAmountMinor ?? null,
        refundedCurrency: order.refundedCurrency ?? null,
      };
    }

    // ③ فحص الحالة (بعد idempotency)
    const approvedOrReversal = order.status === "approved" ||
      (order.status === "refunded" && order.refundType === "points_reversal");
    if (!approvedOrReversal) {
      throw Object.assign(
        new Error("NOT_APPROVED"),
        { code: "not_approved", currentStatus: order.status },
      );
    }
    if (!order.creditedGrantId) {
      throw Object.assign(new Error("NO_GRANT"), { code: "no_grant" });
    }

    // ④ قفل الـgrant
    const [grant] = await tx
      .select()
      .from(pointGrantsTable)
      .where(eq(pointGrantsTable.id, order.creditedGrantId))
      .for("update")
      .limit(1);

    if (!grant) throw Object.assign(new Error("GRANT_NOT_FOUND"), { code: "not_found" });

    const originalMp = grant.originalMicroPoints;
    const remainingMp = grant.remainingMicroPoints;
    const usedMp = originalMp - remainingMp;

    // ④ full_refund: يرفض إن وُجدت نقاط مستخدمة
    if (opts.refundType === "full_refund" && usedMp > 0n) {
      throw Object.assign(
        new Error("POINTS_PARTIALLY_USED"),
        {
          code: "points_partially_used",
          refundInfo: {
            orderId: opts.orderId,
            originalPoints: toVisiblePoints(originalMp),
            usedPoints: toVisiblePoints(usedMp),
            remainingPoints: toVisiblePoints(remainingMp),
            originalMicroPointsStr: originalMp.toString(),
            usedMicroPointsStr: usedMp.toString(),
            remainingMicroPointsStr: remainingMp.toString(),
            paidAmountMinor: order.paidAmountMinor ?? null,
            paidCurrency: order.paidCurrency ?? null,
            priceCentsSnapshot: order.priceCentsSnapshot,
            currencySnapshot: order.currencySnapshot,
          } satisfies RefundInfo,
        },
      );
    }

    // ⑤ لا رصيد سالب — ما يُعكس = المتبقي فقط
    const microPointsToReverse = remainingMp; // never negative

    // ⑥ حركة reversal (تُنشأ فقط إن بقيت نقاط)
    const now = new Date();
    if (microPointsToReverse > 0n) {
      await tx.insert(pointLedgerTable).values({
        workspaceId: grant.workspaceId,
        walletId: grant.walletId,
        grantId: grant.id,
        transactionType: opts.refundType === "chargeback" ? "refund" : "reversal",
        microPoints: -microPointsToReverse,
        sourceType: "admin",
        sourceId: opts.actorId,
        idempotencyKey: `${opts.idempotencyKey}:ledger`,
        reason: opts.reason,
        actorType: "admin",
        actorId: opts.actorId,
      });
    }

    // ⑦ تحديث الـgrant
    const newGrantStatus = remainingMp <= 0n ? "exhausted" : "reversed";
    await tx
      .update(pointGrantsTable)
      .set({
        status: newGrantStatus,
        remainingMicroPoints: 0n,
        updatedAt: now,
      })
      .where(eq(pointGrantsTable.id, grant.id));

    // ⑧ القيمة المُستردة
    const refundedAmountMinor =
      opts.refundType === "partial_refund"
        ? (opts.partialRefundAmountMinor ?? null)
        : opts.refundType === "points_reversal"
          ? null
          : (order.paidAmountMinor ?? null); // full_refund / chargeback

    const refundedCurrency =
      opts.refundType === "partial_refund"
        ? (opts.partialRefundCurrency ?? null)
        : opts.refundType === "points_reversal"
          ? null
          : (order.paidCurrency ?? null);

    // ⑨ حالة الطلب الجديدة
    const newOrderStatus =
      opts.refundType === "chargeback"
        ? "chargeback"
        : opts.refundType === "points_reversal"
          ? "approved"  // لا إعادة مال — الطلب لا يزال صالحاً
          : "refunded"; // full_refund | partial_refund

    await tx
      .update(pointPurchaseOrdersTable)
      .set({
        status: newOrderStatus,
        refundType: opts.refundType,
        refundedAt: now,
        refundedBy: opts.actorId,
        refundedAmountMinor,
        refundedCurrency,
        refundReason: opts.reason,
        refundIdempotencyKey: opts.idempotencyKey,
        updatedAt: now,
      })
      .where(eq(pointPurchaseOrdersTable.id, order.id));

    // ⑩ تحديث payment_submission المرتبط
    if (opts.refundType !== "points_reversal") {
      await tx.execute(
        sql`UPDATE payment_submissions
            SET status = ${opts.refundType === "chargeback" ? "chargeback" : "refunded"},
                reviewed_by = ${opts.actorId},
                reviewed_at = ${now}
            WHERE point_purchase_order_id = ${order.id}
              AND submission_type = 'point_topup'`,
      );
    }

    return {
      orderId: order.id,
      refundType: opts.refundType,
      microPointsReversedStr: microPointsToReverse.toString(),
      wasAlreadyRefunded: false,
      refundedAmountMinor,
      refundedCurrency,
    };
  });
}
