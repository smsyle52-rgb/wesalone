import { type DatabaseClient, db, eq } from "@chatbotx.io/database/client"
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

export const addMonthsUtc = (from: Date, months: number): Date => {
  const next = new Date(from)
  const day = next.getUTCDate()
  next.setUTCDate(1)
  next.setUTCMonth(next.getUTCMonth() + months)
  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate()
  next.setUTCDate(Math.min(day, lastDay))
  return next
}

class PlatformSubscriptionService {
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
      const [subscription] = await tx
        .select()
        .from(platformSubscriptionModel)
        .where(eq(platformSubscriptionModel.id, subscriptionId))
        .for("update")
      if (
        subscription?.status !== "active" ||
        subscription.nextGrantAt > new Date()
      ) {
        return false
      }
      if (subscription.periodEnd <= new Date()) {
        if (subscription.source === "free") {
          const plan = findWesalOnePlan("free")
          if (!plan) {
            throw new ChatbotXException("Free plan not found")
          }
          const nextPeriodStart = subscription.periodEnd
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
          addMonthsUtc(grantStart, 1).getTime(),
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
      where: { status: "active", nextGrantAt: { lte: new Date() } },
      columns: { id: true },
      orderBy: { nextGrantAt: "asc" },
      limit,
    })
    return rows.map((row) => row.id)
  }
}

export const platformSubscriptionService = new PlatformSubscriptionService()
