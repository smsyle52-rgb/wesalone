/**
 * Read-only integrity audit for Wesal One subscriptions and points.
 *
 * This script never repairs data. PostgreSQL enforces a READ ONLY transaction
 * so an accidental future write fails at the database boundary.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node ./scripts/audit-billing-integrity.mjs
 *   BILLING_AUDIT_CREATED_AFTER=2026-07-29T00:00:00Z ...
 */
import pg from "pg"

const databaseUrl = process.env.DATABASE_URL
const createdAfterRaw = process.env.BILLING_AUDIT_CREATED_AFTER
const createdAfter = createdAfterRaw ? new Date(createdAfterRaw) : null
if (createdAfter && Number.isNaN(createdAfter.getTime())) {
  console.error("BILLING_AUDIT_CREATED_AFTER must be a valid ISO timestamp.")
  process.exitCode = 1
}
if (!databaseUrl) {
  console.error("DATABASE_URL is required.")
  process.exitCode = 1
} else if (process.exitCode !== 1) {
  const client = new pg.Client({ connectionString: databaseUrl })
  const requiredTables = [
    "UserQuota",
    "PlatformSubscription",
    "PointWallet",
    "PointGrant",
    "PointLedger",
    "BillableUsageEvent",
  ]

  const scalar = async (query, values = []) => {
    const result = await client.query(query, values)
    return Number(result.rows[0]?.count ?? 0)
  }

  try {
    await client.connect()
    await client.query("BEGIN TRANSACTION READ ONLY")

    const tableResult = await client.query(
      `SELECT name, to_regclass(format('%I', name)) IS NOT NULL AS present
       FROM unnest($1::text[]) AS names(name)`,
      [requiredTables],
    )
    const missingTables = tableResult.rows
      .filter((row) => !row.present)
      .map((row) => row.name)

    if (missingTables.length > 0) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            checkedAt: new Date().toISOString(),
            missingTables,
            message:
              "Billing schema is incomplete. No data checks were executed.",
          },
          null,
          2,
        ),
      )
      process.exitCode = 2
    } else {
      const scopedValues = createdAfter ? [createdAfter] : []
      const userScope = createdAfter ? `AND u."createdAt" >= $1` : ""
      const subscriptionScope = createdAfter ? `AND s."createdAt" >= $1` : ""
      const grantScope = createdAfter ? `AND g."createdAt" >= $1` : ""
      const usageScope = createdAfter ? `AND "createdAt" >= $1` : ""
      const checks = {
        workspaceOwnersMissingQuota: await scalar(
          `
          SELECT count(DISTINCT w."ownerId")
          FROM "Workspace" w
          JOIN "User" u ON u.id = w."ownerId"
          LEFT JOIN "UserQuota" q ON q."userId" = w."ownerId"
          WHERE q.id IS NULL
          ${userScope}
        `,
          scopedValues,
        ),
        workspaceOwnersMissingSubscription: await scalar(
          `
          SELECT count(DISTINCT w."ownerId")
          FROM "Workspace" w
          JOIN "User" u ON u.id = w."ownerId"
          LEFT JOIN "PlatformSubscription" s ON s."userId" = w."ownerId"
          WHERE s.id IS NULL
          ${userScope}
        `,
          scopedValues,
        ),
        subscriptionsMissingWallet: await scalar(
          `
          SELECT count(*)
          FROM "PlatformSubscription" s
          LEFT JOIN "PointWallet" w ON w."userId" = s."userId"
          WHERE w.id IS NULL
          ${subscriptionScope}
        `,
          scopedValues,
        ),
        activeSubscriptionQuotaMismatch: await scalar(
          `
          SELECT count(*)
          FROM "PlatformSubscription" s
          JOIN "UserQuota" q ON q."userId" = s."userId"
          WHERE s.status IN ('active', 'cancel_at_period_end')
            AND (q."planStatus" <> 'active' OR q."planName" IS NULL)
          ${subscriptionScope}
        `,
          scopedValues,
        ),
        overdueSubscriptions: await scalar(
          `
          SELECT count(*)
          FROM "PlatformSubscription" s
          WHERE s.status IN ('active', 'cancel_at_period_end')
            AND s."nextGrantAt" <= now()
          ${subscriptionScope}
        `,
          scopedValues,
        ),
        invalidGrantBalances: await scalar(
          `
          SELECT count(*)
          FROM "PointGrant" g
          WHERE (g."originalMicroPoints" < 0
             OR g."remainingMicroPoints" < 0
             OR g."remainingMicroPoints" > g."originalMicroPoints")
          ${grantScope}
        `,
          scopedValues,
        ),
        grantLedgerDrift: await scalar(
          `
          SELECT count(*)
          FROM "PointGrant" g
          LEFT JOIN LATERAL (
            SELECT coalesce(sum(l."microPoints"), 0) AS ledger_total
            FROM "PointLedger" l
            WHERE l."grantId" = g.id
          ) ledger ON true
          WHERE g."remainingMicroPoints" <> ledger.ledger_total
          ${grantScope}
        `,
          scopedValues,
        ),
        staleReservations: await scalar(
          `
          SELECT count(*)
          FROM "BillableUsageEvent"
          WHERE status = 'reserved'
            AND "updatedAt" < now() - interval '30 minutes'
          ${usageScope}
        `,
          scopedValues,
        ),
        pendingSettlements: await scalar(
          `
          SELECT count(*)
          FROM "BillableUsageEvent"
          WHERE status = 'settlement_pending'
          ${usageScope}
        `,
          scopedValues,
        ),
      }

      const criticalKeys = [
        "workspaceOwnersMissingQuota",
        "workspaceOwnersMissingSubscription",
        "subscriptionsMissingWallet",
        "activeSubscriptionQuotaMismatch",
        "invalidGrantBalances",
        "grantLedgerDrift",
      ]
      const criticalIssues = criticalKeys.reduce(
        (sum, key) => sum + checks[key],
        0,
      )

      console.log(
        JSON.stringify(
          {
            ok: criticalIssues === 0,
            checkedAt: new Date().toISOString(),
            readOnly: true,
            createdAfter: createdAfter?.toISOString() ?? null,
            checks,
          },
          null,
          2,
        ),
      )
      if (criticalIssues > 0) {
        process.exitCode = 2
      }
    }

    await client.query("ROLLBACK")
  } catch (error) {
    try {
      await client.query("ROLLBACK")
    } catch {
      // The original audit error is more useful than a cleanup error.
    }
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  } finally {
    await client.end()
  }
}
