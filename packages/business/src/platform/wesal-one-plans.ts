/**
 * Wesal One's platform subscription catalog — the single source of truth for
 * plan names, prices, and limits shown on the pricing page and applied to a
 * workspace owner's UserQuota row.
 *
 * Values are transcribed verbatim from the Wesal One reference project's own
 * documented policy (SYSTEM_PLANS, the "five approved plans, sole
 * operational source of truth" per its own comment), not invented here.
 *
 * Scope, deliberately narrow:
 * - `channelsLimit` / `contactsLimit` / `teamMembersLimit` map onto
 *   ChatbotX's native `UserQuota` columns and ARE enforced by the existing
 *   quota-enforcement service once a plan is applied.
 * - `agentsLimit`, `knowledgeDocumentsLimit`, `productsLimit`, and
 *   `monthlyPoints` are part of the documented plan but have no matching
 *   native UserQuota column (no "agents"/"points" metric exists in this
 *   OSS repo) — they are DISPLAY-ONLY here, not enforced. Enforcing
 *   `monthlyPoints` specifically would mean metering AI/agent token usage,
 *   which (a) has no native quota metric to hook into and (b) is explicitly
 *   deferred post-launch even in Wesal One's own live product (see its
 *   launch-readiness-plan.md §5.8) and would require touching AI agent
 *   code, which is out of scope here. Documented for provenance only:
 *   1 point = 1,000 tokens (env `TOKENS_PER_POINT`, default 1000).
 * - `workspacesLimit` / `macLimit` (native UserQuota columns) have no
 *   corresponding concept in Wesal One's plan model and are intentionally
 *   left unset (null = unlimited) rather than invented.
 */

export type WesalOnePlanSlug =
  | "free"
  | "starter"
  | "growth"
  | "professional"
  | "business"

export const WESAL_ONE_PRICE_VERSION = "2026-07-27.v1"

export const getPlanPriceCents = (
  plan: WesalOnePlan,
  cycle: "monthly" | "annual",
): number | null => {
  const price = cycle === "annual" ? plan.priceYearlyUsd : plan.priceMonthlyUsd
  return price === null ? null : Math.round(price * 100)
}

export type WesalOnePlan = {
  slug: WesalOnePlanSlug
  nameEn: string
  nameAr: string
  audience: "individual" | "business" | "enterprise"
  /** USD, null = custom/contact sales. */
  priceMonthlyUsd: number | null
  priceYearlyUsd: number | null
  /** SAR, monthly only — not documented for yearly billing. */
  priceMonthlySar: number | null
  /** Display-only, see module doc — not metered. null = custom. */
  monthlyPoints: number | null
  /** Enforced via native UserQuota columns once a plan is applied. */
  limits: {
    workspaces: number | null
    channels: number | null
    contacts: number | null
    monthlyActiveContacts: number | null
    teamMembers: number | null
  }
  /** Display-only — no native "agents" quota metric. null = custom. */
  agentsLimit: number | null
  knowledgeDocumentsLimit: number | null
  productsLimit: number | null
  autoReply: boolean
  /** Feature flag slugs as documented; rendered via i18n keys, not literal copy. */
  features: string[]
  highlighted?: boolean
}

export const WESAL_ONE_PLANS: readonly WesalOnePlan[] = [
  {
    slug: "free",
    nameEn: "Free",
    nameAr: "مجاني",
    audience: "individual",
    priceMonthlyUsd: 0,
    priceYearlyUsd: 0,
    priceMonthlySar: 0,
    monthlyPoints: 1000,
    limits: {
      workspaces: 1,
      channels: 1,
      contacts: 100,
      monthlyActiveContacts: 100,
      teamMembers: 1,
    },
    agentsLimit: 1,
    knowledgeDocumentsLimit: 1,
    productsLimit: 20,
    // Auto-reply is NOT withheld from the free plan. Gating it here took the
    // agent offline for real merchants, including a paying one whose quota row
    // had never been stamped with its plan and so read as free. The gate in
    // the reply path stays — it is how a specific workspace gets suspended —
    // but no tier withholds auto-reply.
    autoReply: true,
    features: ["inbox", "ai_agent", "catalog"],
  },
  {
    slug: "starter",
    nameEn: "Starter",
    nameAr: "البداية",
    audience: "individual",
    priceMonthlyUsd: 19,
    priceYearlyUsd: 182,
    priceMonthlySar: 71.25,
    monthlyPoints: 10_000,
    limits: {
      workspaces: 1,
      channels: 1,
      contacts: 1000,
      monthlyActiveContacts: 1000,
      teamMembers: 2,
    },
    agentsLimit: 1,
    knowledgeDocumentsLimit: 1,
    productsLimit: 500,
    autoReply: true,
    features: ["inbox", "ai_agent", "catalog", "basic_automation"],
  },
  {
    slug: "growth",
    nameEn: "Growth",
    nameAr: "النمو",
    audience: "business",
    priceMonthlyUsd: 49,
    priceYearlyUsd: 470,
    priceMonthlySar: 183.75,
    monthlyPoints: 40_000,
    limits: {
      workspaces: 3,
      channels: 3,
      contacts: 10_000,
      monthlyActiveContacts: 10_000,
      teamMembers: 5,
    },
    agentsLimit: 3,
    knowledgeDocumentsLimit: 5,
    productsLimit: 5000,
    autoReply: true,
    features: [
      "inbox",
      "ai_agent",
      "catalog",
      "automation",
      "campaigns",
      "advanced_analytics",
      "vision_voice",
    ],
    highlighted: true,
  },
  {
    slug: "professional",
    nameEn: "Professional",
    nameAr: "احترافي",
    audience: "business",
    priceMonthlyUsd: 140,
    priceYearlyUsd: 1344,
    priceMonthlySar: 525,
    monthlyPoints: 100_000,
    limits: {
      workspaces: 10,
      channels: 10,
      contacts: 50_000,
      monthlyActiveContacts: 50_000,
      teamMembers: 15,
    },
    agentsLimit: 10,
    knowledgeDocumentsLimit: 20,
    productsLimit: 25_000,
    autoReply: true,
    features: [
      "inbox",
      "ai_agent",
      "catalog",
      "automation",
      "campaigns",
      "advanced_analytics",
      "vision_voice",
      "priority_support",
    ],
  },
  {
    slug: "business",
    nameEn: "Business",
    nameAr: "الأعمال",
    audience: "enterprise",
    priceMonthlyUsd: null,
    priceYearlyUsd: null,
    priceMonthlySar: null,
    monthlyPoints: null,
    limits: {
      workspaces: null,
      channels: null,
      contacts: null,
      monthlyActiveContacts: null,
      teamMembers: null,
    },
    agentsLimit: null,
    knowledgeDocumentsLimit: null,
    productsLimit: null,
    autoReply: true,
    features: ["everything", "priority_support"],
  },
] as const

export const findWesalOnePlan = (slug: string): WesalOnePlan | undefined =>
  WESAL_ONE_PLANS.find((plan) => plan.slug === slug)
