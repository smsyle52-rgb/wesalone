import {
  and,
  type DatabaseClient,
  db,
  eq,
  gt,
  isNull,
  lte,
  or,
  sql,
} from "@chatbotx.io/database/client"
import {
  billableUsageEventModel,
  pointGrantModel,
  pointLedgerModel,
  pointWalletModel,
} from "@chatbotx.io/database/schema"
import { ChatbotXException } from "../errors"
import { env } from "../keys"

// 1 visible point = 1,000,000 micro-points — internal precision only, never
// surfaced to a merchant. Keeps per-reply debits (a fraction of a point)
// exact instead of accumulating float rounding error across thousands of
// AI runs.
export const MICRO_POINTS_PER_POINT = 1_000_000n

export const toMicroPoints = (visiblePoints: number): bigint =>
  BigInt(Math.round(visiblePoints * Number(MICRO_POINTS_PER_POINT)))

export const toVisiblePoints = (microPoints: bigint): number =>
  Number(microPoints) / Number(MICRO_POINTS_PER_POINT)

export type WalletBalance = {
  walletId: string
  walletStatus: string
  monthlyPoints: number
  monthlyGrantedPoints: number
  monthlyUsedPoints: number
  purchasedPoints: number
  reservedPoints: number
  frozenPoints: number
  totalAvailablePoints: number
  nearestExpiry: Date | null
}

async function getOrCreateWallet(
  userId: string,
  tx: DatabaseClient = db,
): Promise<{ id: string; status: string }> {
  const existing = await tx.query.pointWalletModel.findFirst({
    where: { userId },
    columns: { id: true, status: true },
  })
  if (existing) {
    return existing
  }

  const [created] = await tx
    .insert(pointWalletModel)
    .values({ userId })
    .onConflictDoNothing()
    .returning({ id: pointWalletModel.id, status: pointWalletModel.status })
  if (created) {
    return created
  }

  // Lost the create race to a concurrent request — the row now exists.
  const refetched = await tx.query.pointWalletModel.findFirst({
    where: { userId },
    columns: { id: true, status: true },
  })
  if (!refetched) {
    throw new ChatbotXException(`Wallet creation failed for user ${userId}`)
  }
  return refetched
}

/**
 * Balance is never stored — it is rebuilt on every call from
 * PointGrant.remainingMicroPoints, the single source of truth. This keeps a
 * grant update and the balance it produces from ever drifting apart.
 */
async function getWalletBalance(userId: string): Promise<WalletBalance> {
  const wallet = await getOrCreateWallet(userId)
  const now = new Date()

  const grants = await db.query.pointGrantModel.findMany({
    where: {
      walletId: wallet.id,
      status: { in: ["active", "frozen"] },
      startsAt: { lte: now },
      OR: [{ expiresAt: { isNull: true } }, { expiresAt: { gt: now } }],
    },
  })

  let monthlyMicro = 0n
  let monthlyOriginalMicro = 0n
  let purchasedMicro = 0n
  let frozenMicro = 0n
  let nearestExpiry: Date | null = null

  for (const grant of grants) {
    const remaining = BigInt(grant.remainingMicroPoints)
    if (grant.status === "frozen") {
      frozenMicro += remaining
      continue
    }
    if (grant.grantType === "monthly_subscription") {
      monthlyMicro += remaining
      monthlyOriginalMicro += BigInt(grant.originalMicroPoints)
    } else {
      purchasedMicro += remaining
      if (
        grant.expiresAt &&
        (!nearestExpiry || grant.expiresAt < nearestExpiry)
      ) {
        nearestExpiry = grant.expiresAt
      }
    }
  }

  const [reservedRow] = await db
    .select({
      total: sql<string>`coalesce(sum(${billableUsageEventModel.reservedMicroPoints}), 0)`,
    })
    .from(billableUsageEventModel)
    .where(
      and(
        eq(billableUsageEventModel.walletId, wallet.id),
        eq(billableUsageEventModel.status, "reserved"),
      ),
    )
  const reservedMicro = BigInt(reservedRow?.total ?? "0")
  const availableMicro =
    monthlyMicro + purchasedMicro > reservedMicro
      ? monthlyMicro + purchasedMicro - reservedMicro
      : 0n

  return {
    walletId: wallet.id,
    walletStatus: wallet.status,
    monthlyPoints: toVisiblePoints(monthlyMicro),
    monthlyGrantedPoints: toVisiblePoints(monthlyOriginalMicro),
    monthlyUsedPoints: toVisiblePoints(monthlyOriginalMicro - monthlyMicro),
    purchasedPoints: toVisiblePoints(purchasedMicro),
    reservedPoints: toVisiblePoints(reservedMicro),
    frozenPoints: toVisiblePoints(frozenMicro),
    totalAvailablePoints: toVisiblePoints(availableMicro),
    nearestExpiry,
  }
}

export type CreateGrantOptions = {
  userId: string
  grantType:
    | "monthly_subscription"
    | "purchased"
    | "admin_adjustment"
    | "refund"
    | "promotional"
  points: number
  startsAt?: Date
  expiresAt?: Date | null
  sourceType?: string
  sourceId?: string
  /** Guarantees this exact grant is created at most once, even on retry. */
  idempotencyKey: string
  actorType?: string
  actorId?: string
  reason?: string
  metadata?: Record<string, unknown>
}

function createGrant(opts: CreateGrantOptions, externalTx?: DatabaseClient) {
  const microPoints = toMicroPoints(opts.points)
  const now = new Date()

  const run = async (tx: DatabaseClient) => {
    const wallet = await getOrCreateWallet(opts.userId, tx)

    const existing = await tx.query.pointGrantModel.findFirst({
      where: { idempotencyKey: opts.idempotencyKey },
    })
    if (existing) {
      return existing
    }

    const [grant] = await tx
      .insert(pointGrantModel)
      .values({
        walletId: wallet.id,
        grantType: opts.grantType,
        originalMicroPoints: microPoints.toString(),
        remainingMicroPoints: microPoints.toString(),
        startsAt: opts.startsAt ?? now,
        expiresAt: opts.expiresAt ?? null,
        status: "active",
        sourceType: opts.sourceType ?? null,
        sourceId: opts.sourceId ?? null,
        idempotencyKey: opts.idempotencyKey,
        metadata: opts.metadata ?? {},
      })
      .returning()

    await tx.insert(pointLedgerModel).values({
      walletId: wallet.id,
      grantId: grant.id,
      transactionType: "credit",
      microPoints: microPoints.toString(),
      sourceType: opts.sourceType ?? null,
      sourceId: opts.sourceId ?? null,
      idempotencyKey: `credit:${opts.idempotencyKey}`,
      reason: opts.reason ?? `grant:${opts.grantType}`,
      actorType: opts.actorType ?? "system",
      actorId: opts.actorId ?? null,
    })

    return grant
  }

  return externalTx ? run(externalTx) : db.transaction(run)
}

export type DebitPointsOptions = {
  userId: string
  points: number
  /** Guarantees this exact debit is applied at most once, even on retry. */
  idempotencyKey: string
  sourceType?: string
  sourceId?: string | null
  reason?: string
  actorType?: string
  actorId?: string | null
}

export type DebitMicroPointsOptions = Omit<DebitPointsOptions, "points"> & {
  microPoints: bigint
}

export class InsufficientPointsError extends ChatbotXException {
  available: number
  required: number
  constructor(available: number, required: number) {
    super("Insufficient points", "insufficientPoints", 402)
    this.available = available
    this.required = required
  }
}

/**
 * Depletes monthly-subscription grants before purchased ones (so
 * plan-included points expire with the billing period rather than being
 * undercut by points a merchant paid extra for), then soonest-expiring
 * first. Spans multiple grants atomically under row locks so two concurrent
 * debits can never double-spend the same remaining points.
 */
function debitMicroPointsFromWallet(
  opts: DebitMicroPointsOptions,
  externalTx?: DatabaseClient,
): Promise<{ debited: boolean; points: number; microPoints: bigint }> {
  if (opts.microPoints <= 0n) {
    return Promise.resolve({ debited: false, points: 0, microPoints: 0n })
  }
  const debitMicro = opts.microPoints
  const points = toVisiblePoints(debitMicro)
  const now = new Date()
  const markerKey = `debit:${opts.idempotencyKey}`

  const run = async (tx: DatabaseClient) => {
    const wallet = await getOrCreateWallet(opts.userId, tx)

    const [lockedWallet] = await tx
      .select({ status: pointWalletModel.status })
      .from(pointWalletModel)
      .where(eq(pointWalletModel.id, wallet.id))
      .for("update")
    if (lockedWallet?.status !== "active") {
      throw new ChatbotXException(
        "Point wallet is not active",
        "walletInactive",
        402,
      )
    }

    const existingMarker = await tx.query.pointLedgerModel.findFirst({
      where: { idempotencyKey: markerKey },
      columns: { id: true },
    })
    if (existingMarker) {
      return { debited: false, points, microPoints: debitMicro }
    }

    const grants = await tx
      .select()
      .from(pointGrantModel)
      .where(
        and(
          eq(pointGrantModel.walletId, wallet.id),
          eq(pointGrantModel.status, "active"),
          gt(pointGrantModel.remainingMicroPoints, "0"),
          lte(pointGrantModel.startsAt, now),
          or(
            isNull(pointGrantModel.expiresAt),
            gt(pointGrantModel.expiresAt, now),
          ),
        ),
      )
      .orderBy(
        sql`case when ${pointGrantModel.grantType} = 'monthly_subscription' then 0 else 1 end`,
        sql`${pointGrantModel.expiresAt} asc nulls last`,
        pointGrantModel.createdAt,
      )
      .for("update")

    const available = grants.reduce(
      (sum, grant) => sum + BigInt(grant.remainingMicroPoints),
      0n,
    )
    if (available < debitMicro) {
      throw new InsufficientPointsError(toVisiblePoints(available), points)
    }

    let remaining = debitMicro
    for (const grant of grants) {
      if (remaining <= 0n) {
        break
      }
      const grantRemaining = BigInt(grant.remainingMicroPoints)
      const taken = grantRemaining >= remaining ? remaining : grantRemaining
      const nextRemaining = grantRemaining - taken

      await tx
        .update(pointGrantModel)
        .set({
          remainingMicroPoints: nextRemaining.toString(),
          status: nextRemaining === 0n ? "exhausted" : "active",
        })
        .where(eq(pointGrantModel.id, grant.id))

      await tx.insert(pointLedgerModel).values({
        walletId: wallet.id,
        grantId: grant.id,
        transactionType: "debit",
        microPoints: (-taken).toString(),
        sourceType: opts.sourceType ?? "ai_run",
        sourceId: opts.sourceId ?? null,
        idempotencyKey: `${markerKey}:${grant.id}`,
        reason: opts.reason ?? "ai_usage",
        actorType: opts.actorType ?? "system",
        actorId: opts.actorId ?? null,
      })
      remaining -= taken
    }

    // Marker row: makes a retried call with the same idempotencyKey a
    // guaranteed no-op (checked at the top of this transaction) even though
    // the real debit above is split across several per-grant ledger rows.
    await tx.insert(pointLedgerModel).values({
      walletId: wallet.id,
      grantId: null,
      transactionType: "debit",
      microPoints: "0",
      sourceType: opts.sourceType ?? "ai_run",
      sourceId: opts.sourceId ?? null,
      idempotencyKey: markerKey,
      reason: opts.reason ?? "ai_usage",
      actorType: opts.actorType ?? "system",
      actorId: opts.actorId ?? null,
      metadata: { points, marker: true },
    })

    return { debited: true, points, microPoints: debitMicro }
  }

  return externalTx ? run(externalTx) : db.transaction(run)
}

function debitPointsFromWallet(
  opts: DebitPointsOptions,
  externalTx?: DatabaseClient,
): Promise<{ debited: boolean; points: number; microPoints: bigint }> {
  if (!Number.isFinite(opts.points) || opts.points <= 0) {
    return Promise.resolve({ debited: false, points: 0, microPoints: 0n })
  }
  return debitMicroPointsFromWallet(
    { ...opts, microPoints: toMicroPoints(opts.points) },
    externalTx,
  )
}

export type DebitPointsForTokensOptions = {
  userId: string
  tokens: number
  /** Guarantees this exact debit is applied at most once, even on retry. */
  idempotencyKey: string
  sourceType?: string
  sourceId?: string | null
  reason?: string
}

/**
 * The single entry point AI call sites should use — takes raw token counts
 * (whatever the model provider reports) and converts to points internally
 * via env.TOKENS_PER_POINT, so callers never need to know the conversion
 * ratio or round it themselves. Rounds up: a partial point of usage still
 * costs a whole point, the same way the original implementation did.
 */
function debitPointsForTokens(
  opts: DebitPointsForTokensOptions,
): Promise<{ debited: boolean; points: number }> {
  const points = opts.tokens / env.TOKENS_PER_POINT
  return debitPointsFromWallet({
    userId: opts.userId,
    points,
    idempotencyKey: opts.idempotencyKey,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    reason: opts.reason,
  })
}

/**
 * Freezes (does not delete) an owner's purchased points when they downgrade
 * to a plan with no paid AI usage — unfreezing on upgrade is a caller
 * concern (flip status back to "active"). Monthly-subscription grants are
 * untouched; those already lapse on their own by not being renewed.
 */
function freezePurchasedGrants(userId: string): Promise<number> {
  const now = new Date()

  return db.transaction(async (tx) => {
    const wallet = await getOrCreateWallet(userId, tx)

    const grants = await tx
      .select()
      .from(pointGrantModel)
      .where(
        and(
          eq(pointGrantModel.walletId, wallet.id),
          eq(pointGrantModel.grantType, "purchased"),
          eq(pointGrantModel.status, "active"),
          or(
            isNull(pointGrantModel.expiresAt),
            gt(pointGrantModel.expiresAt, now),
          ),
        ),
      )

    if (grants.length === 0) {
      return 0
    }

    await tx
      .update(pointGrantModel)
      .set({ status: "frozen" })
      .where(
        and(
          eq(pointGrantModel.walletId, wallet.id),
          eq(pointGrantModel.grantType, "purchased"),
          eq(pointGrantModel.status, "active"),
        ),
      )

    for (const grant of grants) {
      await tx.insert(pointLedgerModel).values({
        walletId: wallet.id,
        grantId: grant.id,
        transactionType: "admin_adjustment",
        microPoints: "0",
        sourceType: "system",
        sourceId: null,
        idempotencyKey: `freeze:${grant.id}:${now.getTime()}`,
        reason: "freeze:downgrade_to_free",
        actorType: "system",
        actorId: null,
      })
    }

    return grants.length
  })
}

export const pointWalletService = {
  getOrCreateWallet,
  getWalletBalance,
  createGrant,
  debitPointsFromWallet,
  debitMicroPointsFromWallet,
  debitPointsForTokens,
  freezePurchasedGrants,
}
