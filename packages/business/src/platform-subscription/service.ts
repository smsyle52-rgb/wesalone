import { and, type DatabaseClient, db, eq } from "@chatbotx.io/database/client"
import type {
  PlatformSubscriptionBillingCycle,
  PlatformSubscriptionSource,
} from "@chatbotx.io/database/partials"
import {
  platformSubscriptionModel,
  userQuotaModel,
} from "@chatbotx.io/database/schema"
import type { PlatformSubscriptionModel } from "@chatbotx.io/database/types"
import { ChatbotXException } from "../errors"
import {
  findWesalOnePlan,
  getPlanPriceCents,
  WESAL_ONE_PRICE_VERSION,
} from "../platform/wesal-one-plans"
import { userQuotaService } from "../user-quota"

export const addMonthsUtc = (
  from: Date,
  months: number,
  anchorDay = from.getUTCDate(),
): Date => {
  const next = new Date(from)
  next.setUTCDate(1)
  next.setUTCMonth(next.getUTCMonth() + months)
  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate()
  next.setUTCDate(Math.min(anchorDay, lastDay))
  return next
}

export const currentMonthlyPeriod = (
  firstStart: Date,
  now: Date,
  anchorDay = firstStart.getUTCDate(),
): { periodStart: Date; periodEnd: Date } => {
  let periodStart = firstStart
  let monthOffset = 1
  let periodEnd = addMonthsUtc(firstStart, monthOffset, anchorDay)
  while (periodEnd <= now) {
    periodStart = periodEnd
    monthOffset += 1
    // Always calculate from the original anchor. Chaining Feb 28 -> Mar 28
    // would permanently move a subscription that began on Jan 31 forward by
    // three days; Jan 31 + 2 months correctly lands on Mar 31.
    periodEnd = addMonthsUtc(firstStart, monthOffset, anchorDay)
  }
  return { periodStart, periodEnd }
}

class PlatformSubscriptionService {
  async getForWorkspace(
    workspaceId: string,
  ): Promise<PlatformSubscriptionModel | null> {
    const workspace = await db.query.workspaceModel.findFirst({
      where: { id: workspaceId },
      columns: { ownerId: true },
    })
    if (!workspace) {
      throw new ChatbotXException("Workspace not found", "notFound", 404)
    }
    return (
      (await db.query.platformSubscriptionModel.findFirst({
        where: { userId: workspace.ownerId },
      })) ?? null
    )
  }

  async scheduleCancellationForWorkspace(
    workspaceId: string,
  ): Promise<PlatformSubscriptionModel> {
    const subscription = await this.getForWorkspace(workspaceId)
    if (!subscription) {
      throw new ChatbotXException(
        "Subscription not found",
        "subscriptionNotFound",
        404,
      )
    }
    if (subscription.source === "free") {
      throw new ChatbotXException(
        "The free plan cannot be cancelled",
        "freePlanNotCancellable",
        409,
      )
    }
    if (subscription.status === "cancel_at_period_end") {
      return subscription
    }
    const [updated] = await db
      .update(platformSubscriptionModel)
      .set({ status: "cancel_at_period_end", cancelAtPeriodEnd: true })
      .where(
        and(
          eq(platformSubscriptionModel.id, subscription.id),
          eq(platformSubscriptionModel.status, "active"),
        ),
      )
      .returning()
    if (!updated) {
      throw new ChatbotXException(
        "Subscription can no longer be cancelled",
        "subscriptionNotCancellable",
        409,
      )
    }
    return updated
  }

  async resumeForWorkspace(
    workspaceId: string,
  ): Promise<PlatformSubscriptionModel> {
    const subscription = await this.getForWorkspace(workspaceId)
    if (!subscription) {
      throw new ChatbotXException(
        "Subscription not found",
        "subscriptionNotFound",
        404,
      )
    }
    if (subscription.status === "active") {
      return subscription
    }
    const [updated] = await db
      .update(platformSubscriptionModel)
      .set({ status: "active", cancelAtPeriodEnd: false })
      .where(
        and(
          eq(platformSubscriptionModel.id, subscription.id),
          eq(platformSubscriptionModel.status, "cancel_at_period_end"),
        ),
      )
      .returning()
    if (!updated) {
      throw new ChatbotXException(
        "Subscription can no longer be resumed",
        "subscriptionNotResumable",
        409,
      )
    }
    return updated
  }

  async activate(props: {
    userId: string
    workspaceId?: string | null
    planSlug: string
    billingCycle: PlatformSubscriptionBillingCycle
    source: PlatformSubscriptionSource
    startsAt?: Date
    tx?: DatabaseClient
  }): Promise<PlatformSubscriptionModel> {
    const plan = findWesalOnePlan(props.planSlug)
    if (!plan) {
      throw new ChatbotXException("Unknown plan", "planNotFound", 404)
    }
    const tx = props.tx ?? db
    const startsAt = props.startsAt ?? new Date()
    const periodEnd = addMonthsUtc(
      startsAt,
      props.billingCycle === "annual" ? 12 : 1,
    )
    const firstGrantEnd = addMonthsUtc(startsAt, 1)
    const priceCents = getPlanPriceCents(plan, props.billingCycle) ?? 0

    const [subscription] = await tx
      .insert(platformSubscriptionModel)
      .values({
        userId: props.userId,
        workspaceId: props.workspaceId ?? null,
        planSlug: plan.slug,
        billingCycle: props.billingCycle,
        status: "active",
        source: props.source,
        periodStart: startsAt,
        periodEnd,
        nextGrantAt: firstGrantEnd,
        cancelAtPeriodEnd: false,
        priceCents,
        currency: "USD",
        priceVersion: WESAL_ONE_PRICE_VERSION,
      })
      .onConflictDoUpdate({
        target: platformSubscriptionModel.userId,
        set: {
          workspaceId: props.workspaceId ?? null,
          planSlug: plan.slug,
          billingCycle: props.billingCycle,
          status: "active",
          source: props.source,
          periodStart: startsAt,
          periodEnd,
          nextGrantAt: firstGrantEnd,
          cancelAtPeriodEnd: false,
          priceCents,
          currency: "USD",
          priceVersion: WESAL_ONE_PRICE_VERSION,
        },
      })
      .returning()

    await userQuotaService.applyPlanEntitlements({
      userId: props.userId,
      plan,
      periodStart: startsAt,
      periodEnd,
      grantExpiresAt: firstGrantEnd,
      tx,
    })
    return subscription
  }

  processDueMonthlyGrant(subscriptionId: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const now = new Date()
      const [subscription] = await tx
        .select()
        .from(platformSubscriptionModel)
        .where(eq(platformSubscriptionModel.id, subscriptionId))
        .for("update")
      if (
        !(
          subscription &&
          ["active", "cancel_at_period_end"].includes(subscription.status)
        ) ||
        subscription.nextGrantAt > now
      ) {
        return false
      }
      if (subscription.periodEnd <= now) {
        if (subscription.status === "cancel_at_period_end") {
          const plan = findWesalOnePlan("free")
          if (!plan) {
            throw new ChatbotXException("Free plan not found")
          }
          // Never issue retroactive, already-expired free grants when the
          // scheduler catches up after downtime. Start the new free period
          // at processing time and grant exactly once for that live period.
          const nextPeriodStart = now
          const nextPeriodEnd = addMonthsUtc(nextPeriodStart, 1)
          await userQuotaService.applyPlanEntitlements({
            userId: subscription.userId,
            plan,
            periodStart: nextPeriodStart,
            periodEnd: nextPeriodEnd,
            grantStartsAt: nextPeriodStart,
            grantExpiresAt: nextPeriodEnd,
            tx,
          })
          await tx
            .update(platformSubscriptionModel)
            .set({
              planSlug: plan.slug,
              billingCycle: "monthly",
              status: "active",
              source: "free",
              periodStart: nextPeriodStart,
              periodEnd: nextPeriodEnd,
              nextGrantAt: nextPeriodEnd,
              cancelAtPeriodEnd: false,
              priceCents: 0,
              currency: "USD",
              priceVersion: WESAL_ONE_PRICE_VERSION,
            })
            .where(eq(platformSubscriptionModel.id, subscription.id))
          return true
        }
        if (subscription.source === "free") {
          const plan = findWesalOnePlan("free")
          if (!plan) {
            throw new ChatbotXException("Free plan not found")
          }
          const { periodStart: nextPeriodStart, periodEnd: nextPeriodEnd } =
            currentMonthlyPeriod(
              subscription.periodEnd,
              now,
              Math.max(
                subscription.periodStart.getUTCDate(),
                subscription.periodEnd.getUTCDate(),
              ),
            )
          await userQuotaService.applyPlanEntitlements({
            userId: subscription.userId,
            plan,
            periodStart: nextPeriodStart,
            periodEnd: nextPeriodEnd,
            grantStartsAt: nextPeriodStart,
            grantExpiresAt: nextPeriodEnd,
            tx,
          })
          await tx
            .update(platformSubscriptionModel)
            .set({
              periodStart: nextPeriodStart,
              periodEnd: nextPeriodEnd,
              nextGrantAt: nextPeriodEnd,
            })
            .where(eq(platformSubscriptionModel.id, subscription.id))
          return true
        }
        await tx
          .update(platformSubscriptionModel)
          .set({ status: "expired" })
          .where(eq(platformSubscriptionModel.id, subscription.id))
        await tx
          .update(userQuotaModel)
          .set({ planStatus: "expired" })
          .where(eq(userQuotaModel.userId, subscription.userId))
        return false
      }

      const plan = findWesalOnePlan(subscription.planSlug)
      if (!plan) {
        throw new ChatbotXException("Unknown subscription plan")
      }
      const grantStart = subscription.nextGrantAt
      const grantEnd = new Date(
        Math.min(
          currentMonthlyPeriod(
            subscription.periodStart,
            grantStart,
          ).periodEnd.getTime(),
          subscription.periodEnd.getTime(),
        ),
      )
      await userQuotaService.applyPlanEntitlements({
        userId: subscription.userId,
        plan,
        periodStart: subscription.periodStart,
        periodEnd: subscription.periodEnd,
        grantStartsAt: grantStart,
        grantExpiresAt: grantEnd,
        tx,
      })
      await tx
        .update(platformSubscriptionModel)
        .set({ nextGrantAt: grantEnd })
        .where(eq(platformSubscriptionModel.id, subscription.id))
      return true
    })
  }

  async listDue(limit = 100): Promise<string[]> {
    const rows = await db.query.platformSubscriptionModel.findMany({
      where: {
        status: { in: ["active", "cancel_at_period_end"] },
        nextGrantAt: { lte: new Date() },
      },
      columns: { id: true },
      orderBy: { nextGrantAt: "asc" },
      limit,
    })
    return rows.map((row) => row.id)
  }
}

export const platformSubscriptionService = new PlatformSubscriptionService()
