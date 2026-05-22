import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import {
  aiAgentsTable,
  channelAccountsTable,
  contactsTable,
  db,
  exchangeRatesTable,
  messagesTable,
  plansTable,
  subscriptionsTable,
  usageCountersTable,
  workspaceMembershipsTable,
} from "@workspace/db";

export type PlanLimitKey = "channels" | "agents" | "monthly_messages" | "team_members" | "contacts";

export type LimitCheck = {
  allowed: boolean;
  current: number;
  limit: number | null;
  status: string | null;
  planKey: string | null;
};

export type BillingCurrency = "USD" | "YER" | "SAR";

type PricePlan = {
  priceUsd?: string | null;
  priceUsdAnnual?: string | null;
  priceYer?: string | null;
  priceYerAnnual?: string | null;
  priceSar?: string | null;
};

export type DisplayPrice = {
  amount: number;
  currency: BillingCurrency;
  sourceCurrency: "USD";
  rate: number | null;
  note: string | null;
};

function currentPeriodMonth(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthStart(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function numericLimit(limits: unknown, key: PlanLimitKey): number | null {
  if (!limits || typeof limits !== "object") return null;
  const value = (limits as Record<string, unknown>)[key];
  if (typeof value !== "number" || value < 0) return null;
  return value;
}

function numeric(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getDisplayPrice(workspaceId: string, plan: PricePlan, currency: BillingCurrency, cycle: "monthly" | "annual" = "monthly"): Promise<DisplayPrice> {
  const usd = numeric(cycle === "annual" ? plan.priceUsdAnnual : plan.priceUsd);
  if (currency === "USD") {
    return { amount: usd, currency: "USD", sourceCurrency: "USD", rate: 1, note: null };
  }

  if (currency === "YER") {
    const override = cycle === "annual" ? plan.priceYerAnnual : plan.priceYer;
    if (override != null) return { amount: numeric(override), currency: "YER", sourceCurrency: "USD", rate: null, note: null };
  }

  if (currency === "SAR" && plan.priceSar != null && cycle === "monthly") {
    return { amount: numeric(plan.priceSar), currency: "SAR", sourceCurrency: "USD", rate: null, note: null };
  }

  const [rate] = await db
    .select()
    .from(exchangeRatesTable)
    .where(and(
      eq(exchangeRatesTable.workspaceId, workspaceId),
      eq(exchangeRatesTable.fromCurrency, "USD"),
      eq(exchangeRatesTable.toCurrency, currency),
    ))
    .orderBy(desc(exchangeRatesTable.effectiveAt))
    .limit(1);

  if (!rate) {
    return {
      amount: usd,
      currency: "USD",
      sourceCurrency: "USD",
      rate: null,
      note: "السعر بالدولار، يُحوّل عند الدفع",
    };
  }

  return {
    amount: Math.round(usd * numeric(rate.rate) * 100) / 100,
    currency,
    sourceCurrency: "USD",
    rate: numeric(rate.rate),
    note: null,
  };
}

export async function getActiveSubscription(workspaceId: string) {
  const [subscription] = await db
    .select({
      id: subscriptionsTable.id,
      workspaceId: subscriptionsTable.workspaceId,
      planId: subscriptionsTable.planId,
      status: subscriptionsTable.status,
      startedAt: subscriptionsTable.startedAt,
      trialEndsAt: subscriptionsTable.trialEndsAt,
      currentPeriodEnd: subscriptionsTable.currentPeriodEnd,
      paymentMethod: subscriptionsTable.paymentMethod,
      lastPaymentRef: subscriptionsTable.lastPaymentRef,
      planKey: plansTable.key,
      planSlug: plansTable.slug,
      planName: plansTable.name,
      planNameAr: plansTable.nameAr,
      priceYer: plansTable.priceYer,
      priceYerAnnual: plansTable.priceYerAnnual,
      limits: plansTable.limits,
      features: plansTable.features,
    })
    .from(subscriptionsTable)
    .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(eq(subscriptionsTable.workspaceId, workspaceId))
    .limit(1);

  return subscription ?? null;
}

async function usageValue(workspaceId: string, key: PlanLimitKey): Promise<number> {
  if (key === "channels") {
    const [row] = await db.select({ value: count() }).from(channelAccountsTable).where(and(eq(channelAccountsTable.workspaceId, workspaceId), eq(channelAccountsTable.status, "active")));
    return row?.value ?? 0;
  }
  if (key === "agents") {
    const [row] = await db.select({ value: count() }).from(aiAgentsTable).where(and(eq(aiAgentsTable.workspaceId, workspaceId), eq(aiAgentsTable.status, "active")));
    return row?.value ?? 0;
  }
  if (key === "contacts") {
    const [row] = await db.select({ value: count() }).from(contactsTable).where(eq(contactsTable.workspaceId, workspaceId));
    return row?.value ?? 0;
  }
  if (key === "team_members") {
    const [row] = await db.select({ value: count() }).from(workspaceMembershipsTable).where(and(eq(workspaceMembershipsTable.workspaceId, workspaceId), eq(workspaceMembershipsTable.status, "active")));
    return row?.value ?? 0;
  }
  const [row] = await db
    .select({ value: count() })
    .from(messagesTable)
    .where(and(eq(messagesTable.workspaceId, workspaceId), eq(messagesTable.direction, "outbound"), gte(messagesTable.createdAt, monthStart())));
  return row?.value ?? 0;
}

export async function checkLimit(workspaceId: string, limitKey: PlanLimitKey): Promise<LimitCheck> {
  const subscription = await getActiveSubscription(workspaceId);
  const current = await usageValue(workspaceId, limitKey);
  const limit = numericLimit(subscription?.limits, limitKey);
  return {
    allowed: limit === null || current < limit,
    current,
    limit,
    status: subscription?.status ?? null,
    planKey: subscription?.planKey ?? subscription?.planSlug ?? null,
  };
}

export async function recordUsage(workspaceId: string, metric: "messages_sent" | "agents_count" | "contacts_count" | "team_members", amount = 1): Promise<void> {
  const periodMonth = currentPeriodMonth();
  await db
    .insert(usageCountersTable)
    .values({
      workspaceId,
      periodMonth,
      messagesSent: metric === "messages_sent" ? amount : 0,
      agentsCount: metric === "agents_count" ? amount : 0,
      contactsCount: metric === "contacts_count" ? amount : 0,
      teamMembers: metric === "team_members" ? amount : 0,
    })
    .onConflictDoUpdate({
      target: [usageCountersTable.workspaceId, usageCountersTable.periodMonth],
      set: {
        messagesSent: metric === "messages_sent" ? sql`${usageCountersTable.messagesSent} + ${amount}` : usageCountersTable.messagesSent,
        agentsCount: metric === "agents_count" ? sql`${usageCountersTable.agentsCount} + ${amount}` : usageCountersTable.agentsCount,
        contactsCount: metric === "contacts_count" ? sql`${usageCountersTable.contactsCount} + ${amount}` : usageCountersTable.contactsCount,
        teamMembers: metric === "team_members" ? sql`${usageCountersTable.teamMembers} + ${amount}` : usageCountersTable.teamMembers,
        updatedAt: new Date(),
      },
    });
}

export async function getUsageSnapshot(workspaceId: string) {
  const [channels, agents, contacts, teamMembers, messages] = await Promise.all([
    usageValue(workspaceId, "channels"),
    usageValue(workspaceId, "agents"),
    usageValue(workspaceId, "contacts"),
    usageValue(workspaceId, "team_members"),
    usageValue(workspaceId, "monthly_messages"),
  ]);
  return {
    periodMonth: currentPeriodMonth(),
    channels,
    agents,
    contacts,
    teamMembers,
    messagesSent: messages,
  };
}

export async function getLimitWarnings(workspaceId: string) {
  const keys: PlanLimitKey[] = ["channels", "agents", "monthly_messages", "team_members", "contacts"];
  const checks = await Promise.all(keys.map((key) => checkLimit(workspaceId, key).then((check) => ({ key, ...check }))));
  return checks.filter((check) => check.limit !== null && check.current >= check.limit);
}
