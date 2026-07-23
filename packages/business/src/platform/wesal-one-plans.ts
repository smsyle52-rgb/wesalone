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

export type WesalOnePlan = {
  slug: WesalOnePlanSlug
  nameEn: string
  nameAr: string
  /** USD, null = custom/contact sales. */
  priceMonthlyUsd: number | null
  priceYearlyUsd: number | null
  /** SAR, monthly only — not documented for yearly billing. */
  priceMonthlySar: number | null
  /** Display-only, see module doc — not metered. null = custom. */
  monthlyPoints: number | null
  /** Enforced via native UserQuota columns once a plan is applied. */
  limits: {
    channels: number | null
    contacts: number | null
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
    priceMonthlyUsd: 0,
    priceYearlyUsd: 0,
    priceMonthlySar: 0,
    monthlyPoints: 1000,
    limits: { channels: 1, contacts: 100, teamMembers: 1 },
    agentsLimit: 1,
    knowledgeDocumentsLimit: 1,
    productsLimit: 20,
    autoReply: false,
    features: ["inbox", "ai_agent", "catalog"],
  },
  {
    slug: "starter",
    nameEn: "Starter",
    nameAr: "البداية",
    priceMonthlyUsd: 19,
    priceYearlyUsd: 182,
    priceMonthlySar: 71.25,
    monthlyPoints: 10_000,
    limits: { channels: 1, contacts: 1000, teamMembers: 2 },
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
    priceMonthlyUsd: 49,
    priceYearlyUsd: 470,
    priceMonthlySar: 183.75,
    monthlyPoints: 40_000,
    limits: { channels: 3, contacts: 10_000, teamMembers: 5 },
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
    priceMonthlyUsd: 140,
    priceYearlyUsd: 1344,
    priceMonthlySar: 525,
    monthlyPoints: 100_000,
    limits: { channels: 10, contacts: 50_000, teamMembers: 15 },
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
    priceMonthlyUsd: null,
    priceYearlyUsd: null,
    priceMonthlySar: null,
    monthlyPoints: null,
    limits: { channels: null, contacts: null, teamMembers: null },
    agentsLimit: null,
    knowledgeDocumentsLimit: null,
    productsLimit: null,
    autoReply: true,
    features: ["everything", "priority_support"],
  },
] as const

export const findWesalOnePlan = (slug: string): WesalOnePlan | undefined =>
  WESAL_ONE_PLANS.find((plan) => plan.slug === slug)
