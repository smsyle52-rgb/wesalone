import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  domainEventsTable,
  paymentSubmissionsTable,
  plansTable,
  subscriptionsTable,
} from "@workspace/db";
import { getDisplayPrice, type BillingCurrency } from "./billing";
import { createGrant } from "./point-wallet";

export type BillingCycle = "monthly" | "annual";
export type SubscriptionPaymentStatus = "pending_payment" | "under_review" | "confirmed" | "rejected" | "cancelled" | "expired";

const REVIEWABLE_STATUS = "under_review";
const paymentSubmissionColumns = paymentSubmissionsTable as typeof paymentSubmissionsTable & {
  billingCycle: any;
  rejectionReason: any;
};
const subscriptionColumns = subscriptionsTable as typeof subscriptionsTable & {
  billingCycle: any;
};

function numeric(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthlyPoints(limits: unknown): number {
  if (!limits || typeof limits !== "object") return 0;
  const value = (limits as Record<string, unknown>).monthly_points;
  return typeof value === "number" && value > 0 ? Math.floor(value) : 0;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addBillingPeriod(date: Date, cycle: BillingCycle): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + (cycle === "annual" ? 12 : 1));
  return next;
}

export async function createSubscriptionPaymentSubmission(opts: {
  workspaceId: string;
  planId: string;
  billingCycle: BillingCycle;
  paymentMethod: string;
  paidCurrency: BillingCurrency;
  paymentReference?: string | null;
  receiptFileUrl?: string | null;
  receiptNote?: string | null;
}) {
  const [plan] = await db
    .select()
    .from(plansTable)
    .where(and(eq(plansTable.id, opts.planId), eq(plansTable.isActive, true)))
    .limit(1);

  if (!plan) throw Object.assign(new Error("PLAN_NOT_FOUND"), { code: "plan_not_found" });

  const slug = plan.slug ?? plan.key ?? "";
  const usdPrice = numeric(opts.billingCycle === "annual" ? plan.priceUsdAnnual : plan.priceUsd);
  if (slug === "free" || slug === "trial" || usdPrice <= 0) {
    throw Object.assign(new Error("PLAN_NOT_PAYABLE"), { code: slug === "business" ? "sales_required" : "plan_not_payable" });
  }

  const [duplicate] = await db
    .select({ id: paymentSubmissionsTable.id })
    .from(paymentSubmissionsTable)
    .where(and(
      eq(paymentSubmissionsTable.workspaceId, opts.workspaceId),
      eq(paymentSubmissionsTable.planId, opts.planId),
      eq(paymentSubmissionColumns.billingCycle, opts.billingCycle),
      eq(paymentSubmissionsTable.submissionType, "subscription"),
      eq(paymentSubmissionsTable.status, REVIEWABLE_STATUS),
    ))
    .limit(1);
  if (duplicate) throw Object.assign(new Error("DUPLICATE_UNDER_REVIEW"), { code: "duplicate_under_review" });

  const display = await getDisplayPrice(opts.workspaceId, plan, opts.paidCurrency, opts.billingCycle);
  const exchangeRateSnapshot = {
    source: "server",
    billingCycle: opts.billingCycle,
    priceUsd: usdPrice,
    expectedCurrency: display.currency,
    requestedCurrency: opts.paidCurrency,
    rate: display.rate,
    calculatedAt: new Date().toISOString(),
  };

  const [submission] = await db.insert(paymentSubmissionsTable).values({
    workspaceId: opts.workspaceId,
    submissionType: "subscription",
    planId: plan.id,
    billingCycle: opts.billingCycle,
    amountYer: String(display.amount),
    amountCurrency: display.currency,
    exchangeRateSnapshot,
    paidCurrency: opts.paidCurrency,
    paymentMethod: opts.paymentMethod,
    reference: opts.paymentReference ?? null,
    receiptNote: opts.receiptNote ?? null,
    receiptFileUrl: opts.receiptFileUrl ?? null,
    status: REVIEWABLE_STATUS,
  } as any).returning();

  await db.insert(domainEventsTable).values({
    workspaceId: opts.workspaceId,
    eventType: "billing.payment.submitted",
    entityType: "payment_submission",
    entityId: submission.id,
    payload: { planId: plan.id, billingCycle: opts.billingCycle, amount: display.amount, currency: display.currency },
  });

  return submission;
}

export async function cancelSubscriptionPaymentSubmission(opts: { workspaceId: string; submissionId: string }) {
  const [submission] = await db
    .update(paymentSubmissionsTable)
    .set({ status: "cancelled" })
    .where(and(
      eq(paymentSubmissionsTable.id, opts.submissionId),
      eq(paymentSubmissionsTable.workspaceId, opts.workspaceId),
      eq(paymentSubmissionsTable.submissionType, "subscription"),
      eq(paymentSubmissionsTable.status, REVIEWABLE_STATUS),
    ))
    .returning();
  if (!submission) throw Object.assign(new Error("NOT_CANCELLABLE"), { code: "not_cancellable" });
  return submission;
}

export async function confirmSubscriptionPayment(opts: { submissionId: string; reviewedByUserId: string }) {
  return db.transaction(async (tx) => {
    const [submission] = await tx
      .select()
      .from(paymentSubmissionsTable)
      .where(eq(paymentSubmissionsTable.id, opts.submissionId))
      .for("update")
      .limit(1);

    if (!submission) throw Object.assign(new Error("PAYMENT_NOT_FOUND"), { code: "not_found" });
    if (submission.submissionType !== "subscription" || !submission.planId) {
      throw Object.assign(new Error("NOT_SUBSCRIPTION_PAYMENT"), { code: "not_subscription" });
    }
    if (submission.status !== REVIEWABLE_STATUS) {
      throw Object.assign(new Error("NOT_UNDER_REVIEW"), { code: "not_under_review", currentStatus: submission.status });
    }

    const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, submission.planId)).limit(1);
    if (!plan) throw Object.assign(new Error("PLAN_NOT_FOUND"), { code: "plan_not_found" });

    const cycle = ((submission as typeof submission & { billingCycle?: string | null }).billingCycle === "annual" ? "annual" : "monthly") as BillingCycle;
    const now = new Date();
    const periodEnd = addBillingPeriod(now, cycle);
    const currentPeriodStart = dateOnly(now);
    const currentPeriodEnd = dateOnly(periodEnd);

    const [updatedPayment] = await tx
      .update(paymentSubmissionsTable)
      .set({ status: "confirmed", reviewedBy: opts.reviewedByUserId, reviewedAt: now })
      .where(and(eq(paymentSubmissionsTable.id, submission.id), eq(paymentSubmissionsTable.status, REVIEWABLE_STATUS)))
      .returning();
    if (!updatedPayment) throw Object.assign(new Error("CONCURRENT_UPDATE"), { code: "concurrent_update" });

    await tx.insert(subscriptionsTable).values({
      workspaceId: submission.workspaceId,
      planId: plan.id,
      status: "active",
      startedAt: now,
      currentPeriodStart,
      currentPeriodEnd,
      billingCycle: cycle,
      paymentMethod: submission.paymentMethod,
      lastPaymentRef: submission.reference ?? null,
    } as any).onConflictDoUpdate({
      target: subscriptionsTable.workspaceId,
      set: {
        planId: plan.id,
        status: "active",
        currentPeriodStart,
        currentPeriodEnd,
        billingCycle: cycle,
        paymentMethod: submission.paymentMethod,
        lastPaymentRef: submission.reference ?? null,
        updatedAt: now,
      } as any,
    });

    const points = monthlyPoints(plan.limits);
    if (points > 0) {
      await createGrant({
        workspaceId: submission.workspaceId,
        grantType: "monthly_subscription",
        points,
        startsAt: now,
        expiresAt: periodEnd,
        sourceType: "subscription",
        sourceId: submission.id,
        idempotencyKey: `subscription-grant:${submission.id}`,
        actorType: "admin",
        actorId: opts.reviewedByUserId,
        reason: `subscription:${plan.slug}:${cycle}`,
        metadata: { planId: plan.id, planSlug: plan.slug, billingCycle: cycle },
      }, tx);
    }

    await tx.insert(domainEventsTable).values({
      workspaceId: submission.workspaceId,
      eventType: "billing.payment.confirmed",
      entityType: "payment_submission",
      entityId: submission.id,
      payload: { planId: plan.id, billingCycle: cycle, currentPeriodStart, currentPeriodEnd, points },
    });

    return { submission: updatedPayment, plan, currentPeriodStart, currentPeriodEnd, points };
  });
}

export async function rejectSubscriptionPayment(opts: { submissionId: string; reviewedByUserId: string; reason: string }) {
  return db.transaction(async (tx) => {
    const [submission] = await tx
      .select()
      .from(paymentSubmissionsTable)
      .where(eq(paymentSubmissionsTable.id, opts.submissionId))
      .for("update")
      .limit(1);
    if (!submission) throw Object.assign(new Error("PAYMENT_NOT_FOUND"), { code: "not_found" });
    if (submission.submissionType !== "subscription") throw Object.assign(new Error("NOT_SUBSCRIPTION_PAYMENT"), { code: "not_subscription" });
    if (submission.status === "confirmed") throw Object.assign(new Error("CONFIRMED_NOT_REJECTABLE"), { code: "confirmed_not_rejectable" });
    if (submission.status !== REVIEWABLE_STATUS) throw Object.assign(new Error("NOT_REVIEWABLE"), { code: "not_reviewable", currentStatus: submission.status });

    const [updated] = await tx.update(paymentSubmissionsTable)
      .set({ status: "rejected", reviewedBy: opts.reviewedByUserId, reviewedAt: new Date(), rejectionReason: opts.reason } as any)
      .where(and(eq(paymentSubmissionsTable.id, opts.submissionId), eq(paymentSubmissionsTable.status, REVIEWABLE_STATUS)))
      .returning();
    if (!updated) throw Object.assign(new Error("CONCURRENT_UPDATE"), { code: "concurrent_update" });

    await tx.insert(domainEventsTable).values({
      workspaceId: updated.workspaceId,
      eventType: "billing.payment.rejected",
      entityType: "payment_submission",
      entityId: updated.id,
      payload: { reason: opts.reason },
    });

    return updated;
  });
}

export async function listSubscriptionPaymentsAdmin(status?: string) {
  const statusSql = status && status !== "all"
    ? sql`AND ps.status = ${status}`
    : sql``;

  const result = await db.execute(sql`
    SELECT
      ps.id,
      ps.workspace_id AS "workspaceId",
      w.name AS "workspaceName",
      owner_user.name AS "ownerName",
      owner_user.email AS "ownerEmail",
      ps.plan_id AS "planId",
      p.name AS "planName",
      p.name_ar AS "planNameAr",
      ps.billing_cycle AS "billingCycle",
      ps.amount_yer AS "amount",
      ps.amount_currency AS "amountCurrency",
      ps.paid_currency AS "paidCurrency",
      ps.payment_method AS "paymentMethod",
      ps.reference,
      ps.receipt_note AS "receiptNote",
      ps.rejection_reason AS "rejectionReason",
      ps.receipt_file_url AS "receiptFileUrl",
      ps.status,
      ps.reviewed_at AS "reviewedAt",
      ps.created_at AS "createdAt"
    FROM payment_submissions ps
    JOIN workspaces w ON w.id = ps.workspace_id
    LEFT JOIN plans p ON p.id = ps.plan_id
    LEFT JOIN LATERAL (
      SELECT u.name, u.email
      FROM workspace_memberships wm
      JOIN membership_roles mr ON mr.membership_id = wm.id
      JOIN roles r ON r.id = mr.role_id
      JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = ps.workspace_id
        AND wm.status = 'active'
        AND r.slug = 'owner'
      ORDER BY wm.created_at ASC
      LIMIT 1
    ) owner_user ON true
    WHERE ps.submission_type = 'subscription'
    ${statusSql}
    ORDER BY ps.created_at DESC
    LIMIT 100
  `);

  return result.rows;
}

export async function getSubscriptionPaymentStats() {
  const result = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'under_review')::int AS "underReview",
      count(*) FILTER (WHERE status = 'confirmed' AND reviewed_at::date = CURRENT_DATE)::int AS "confirmedToday",
      count(*) FILTER (WHERE status = 'rejected')::int AS "rejected",
      coalesce(jsonb_object_agg(amount_currency, total_amount) FILTER (WHERE amount_currency IS NOT NULL), '{}'::jsonb) AS "amountsByCurrency"
    FROM (
      SELECT status, reviewed_at, amount_currency, sum(coalesce(amount_yer, 0::numeric)) AS total_amount
      FROM payment_submissions
      WHERE submission_type = 'subscription'
      GROUP BY status, reviewed_at, amount_currency
    ) s
  `);
  return result.rows[0] ?? { underReview: 0, confirmedToday: 0, rejected: 0, amountsByCurrency: {} };
}
