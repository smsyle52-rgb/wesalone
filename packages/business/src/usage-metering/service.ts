import {
  and,
  db,
  eq,
  gt,
  gte,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "@chatbotx.io/database/client"
import type { BillableUsageCategory } from "@chatbotx.io/database/partials"
import {
  billableUsageEventModel,
  pointGrantModel,
  pointWalletModel,
} from "@chatbotx.io/database/schema"
import { ChatbotXException } from "../errors"
import { env } from "../keys"
import {
  InsufficientPointsError,
  pointWalletService,
  toVisiblePoints,
} from "../point-wallet/service"
import {
  defaultReservationMicroPoints,
  type LanguageUsage,
  languageUsageMicroPoints,
  USAGE_RATE_VERSION,
  unitUsageMicroPoints,
} from "./rates"

export type ReserveUsageOptions = {
  workspaceId: string
  operationId: string
  category: BillableUsageCategory
  provider?: string
  model?: string
  estimatedMicroPoints?: bigint
  metadata?: Record<string, unknown>
}

export type UsageReservation = {
  enabled: boolean
  operationId: string
  eventId?: string
}

const requireWorkspaceOwner = async (workspaceId: string) => {
  const workspace = await db.query.workspaceModel.findFirst({
    where: { id: workspaceId },
    columns: { ownerId: true },
  })
  if (!workspace) {
    throw new ChatbotXException("Workspace not found")
  }
  return workspace.ownerId
}

const getAvailableMicroPoints = async (
  walletId: string,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
) => {
  const now = new Date()
  const grants = await tx
    .select({ remaining: pointGrantModel.remainingMicroPoints })
    .from(pointGrantModel)
    .where(
      and(
        eq(pointGrantModel.walletId, walletId),
        eq(pointGrantModel.status, "active"),
        gt(pointGrantModel.remainingMicroPoints, "0"),
        lte(pointGrantModel.startsAt, now),
        or(
          isNull(pointGrantModel.expiresAt),
          gt(pointGrantModel.expiresAt, now),
        ),
      ),
    )
  return grants.reduce((sum, row) => sum + BigInt(row.remaining), 0n)
}

const getReservedMicroPoints = async (
  walletId: string,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  exceptEventId?: string,
) => {
  const conditions = [
    eq(billableUsageEventModel.walletId, walletId),
    eq(billableUsageEventModel.status, "reserved"),
  ]
  if (exceptEventId) {
    conditions.push(ne(billableUsageEventModel.id, exceptEventId))
  }
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(${billableUsageEventModel.reservedMicroPoints}), 0)`,
    })
    .from(billableUsageEventModel)
    .where(and(...conditions))
  return BigInt(row?.total ?? "0")
}

const reserve = async (
  opts: ReserveUsageOptions,
): Promise<UsageReservation> => {
  if (env.AI_POINTS_ENFORCEMENT_MODE === "off") {
    return { enabled: false, operationId: opts.operationId }
  }
  const ownerId = await requireWorkspaceOwner(opts.workspaceId)
  const requested =
    opts.estimatedMicroPoints ?? defaultReservationMicroPoints(opts.category)

  return db.transaction(async (tx) => {
    const wallet = await pointWalletService.getOrCreateWallet(ownerId, tx)
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

    const existing = await tx.query.billableUsageEventModel.findFirst({
      where: { operationId: opts.operationId },
      columns: { id: true, status: true },
    })
    if (existing) {
      if (existing.status === "settled") {
        throw new ChatbotXException(
          "This AI operation was already completed",
          "usageOperationAlreadySettled",
          409,
        )
      }
      if (existing.status === "reserved") {
        throw new ChatbotXException(
          "This AI operation is already running",
          "usageOperationInProgress",
          409,
        )
      }
      if (existing.status === "settlement_pending") {
        throw new ChatbotXException(
          "This AI operation requires billing reconciliation",
          "usageSettlementPending",
          402,
        )
      }
    }

    const available = await getAvailableMicroPoints(wallet.id, tx)
    const reserved = await getReservedMicroPoints(wallet.id, tx)
    if (
      env.AI_POINTS_ENFORCEMENT_MODE === "enforce" &&
      available - reserved < requested
    ) {
      throw new InsufficientPointsError(
        toVisiblePoints(available - reserved),
        toVisiblePoints(requested),
      )
    }

    const eventValues = {
      userId: ownerId,
      workspaceId: opts.workspaceId,
      walletId: wallet.id,
      operationId: opts.operationId,
      category: opts.category,
      provider: opts.provider ?? null,
      model: opts.model ?? null,
      rateVersion: USAGE_RATE_VERSION,
      reservedMicroPoints: requested.toString(),
      metadata: opts.metadata ?? {},
    }
    const [event] = existing
      ? await tx
          .update(billableUsageEventModel)
          .set({
            ...eventValues,
            status: "reserved",
            releasedAt: null,
            error: null,
          })
          .where(eq(billableUsageEventModel.id, existing.id))
          .returning({ id: billableUsageEventModel.id })
      : await tx
          .insert(billableUsageEventModel)
          .values(eventValues)
          .returning({ id: billableUsageEventModel.id })
    return { enabled: true, operationId: opts.operationId, eventId: event.id }
  })
}

const settleMicroPoints = async (props: {
  reservation: UsageReservation
  microPoints: bigint
  usage: Record<string, unknown>
  inputUnits?: number
  outputUnits?: number
  cachedInputUnits?: number
  reasoningUnits?: number
}) => {
  if (!props.reservation.enabled) {
    return
  }
  await db.transaction(async (tx) => {
    const event = await tx.query.billableUsageEventModel.findFirst({
      where: { operationId: props.reservation.operationId },
    })
    if (!event || event.status === "settled" || event.status === "released") {
      return null
    }

    const [lockedWallet] = await tx
      .select({ id: pointWalletModel.id })
      .from(pointWalletModel)
      .where(eq(pointWalletModel.id, event.walletId))
      .for("update")
    if (!lockedWallet) {
      throw new ChatbotXException("Point wallet not found")
    }

    const available = await getAvailableMicroPoints(event.walletId, tx)
    const otherReserved = await getReservedMicroPoints(
      event.walletId,
      tx,
      event.id,
    )
    if (
      env.AI_POINTS_ENFORCEMENT_MODE === "enforce" &&
      available - otherReserved < props.microPoints
    ) {
      await tx
        .update(billableUsageEventModel)
        .set({
          status: "settlement_pending",
          settledMicroPoints: props.microPoints.toString(),
          inputUnits: props.inputUnits?.toString() ?? null,
          outputUnits: props.outputUnits?.toString() ?? null,
          cachedInputUnits: props.cachedInputUnits?.toString() ?? null,
          reasoningUnits: props.reasoningUnits?.toString() ?? null,
          usage: props.usage,
          error: "insufficient_points_after_provider_call",
        })
        .where(eq(billableUsageEventModel.id, event.id))
      return null
    }

    if (env.AI_POINTS_ENFORCEMENT_MODE === "enforce") {
      await pointWalletService.debitMicroPointsFromWallet(
        {
          userId: event.userId,
          microPoints: props.microPoints,
          idempotencyKey: `usage:${event.operationId}`,
          sourceType: "billable_usage_event",
          sourceId: event.id,
          reason: `ai_usage:${event.category}`,
        },
        tx,
      )
    }

    await tx
      .update(billableUsageEventModel)
      .set({
        status: "settled",
        settledMicroPoints: props.microPoints.toString(),
        inputUnits: props.inputUnits?.toString() ?? null,
        outputUnits: props.outputUnits?.toString() ?? null,
        cachedInputUnits: props.cachedInputUnits?.toString() ?? null,
        reasoningUnits: props.reasoningUnits?.toString() ?? null,
        usage: props.usage,
        settledAt: new Date(),
        error: null,
      })
      .where(eq(billableUsageEventModel.id, event.id))
    return null
  })
}

const settleLanguage = (reservation: UsageReservation, usage: LanguageUsage) =>
  settleMicroPoints({
    reservation,
    microPoints: languageUsageMicroPoints(usage),
    usage,
    inputUnits: usage.inputTokens,
    outputUnits: usage.outputTokens,
    cachedInputUnits: usage.cachedInputTokens,
    reasoningUnits: usage.reasoningTokens,
  })

const settleUnits = (
  reservation: UsageReservation,
  category: BillableUsageCategory,
  units: number,
  usage: Record<string, unknown> = { units },
) =>
  settleMicroPoints({
    reservation,
    microPoints: unitUsageMicroPoints(category, units),
    usage,
    inputUnits: units,
  })

const release = async (reservation: UsageReservation, error?: unknown) => {
  if (!reservation.enabled) {
    return
  }
  await db
    .update(billableUsageEventModel)
    .set({
      status: "released",
      releasedAt: new Date(),
      error: error instanceof Error ? error.message.slice(0, 1000) : null,
    })
    .where(
      and(
        eq(billableUsageEventModel.operationId, reservation.operationId),
        eq(billableUsageEventModel.status, "reserved"),
      ),
    )
}

const releaseStaleReservations = async (): Promise<number> => {
  const cutoff = new Date(
    Date.now() - env.AI_POINTS_RESERVATION_TTL_MINUTES * 60 * 1000,
  )
  const released = await db
    .update(billableUsageEventModel)
    .set({
      status: "released",
      releasedAt: new Date(),
      error: "stale_reservation_timeout",
    })
    .where(
      and(
        eq(billableUsageEventModel.status, "reserved"),
        lt(billableUsageEventModel.updatedAt, cutoff),
      ),
    )
    .returning({ id: billableUsageEventModel.id })
  return released.length
}

const retryPendingSettlements = async (limit = 100): Promise<number> => {
  const pending = await db.query.billableUsageEventModel.findMany({
    where: { status: "settlement_pending" },
    orderBy: { updatedAt: "asc" },
    limit,
  })
  let settled = 0
  for (const event of pending) {
    if (!event.settledMicroPoints) {
      continue
    }
    await settleMicroPoints({
      reservation: {
        enabled: true,
        operationId: event.operationId,
        eventId: event.id,
      },
      microPoints: BigInt(event.settledMicroPoints),
      usage: (event.usage as Record<string, unknown> | null) ?? {},
      inputUnits: event.inputUnits ? Number(event.inputUnits) : undefined,
      outputUnits: event.outputUnits ? Number(event.outputUnits) : undefined,
      cachedInputUnits: event.cachedInputUnits
        ? Number(event.cachedInputUnits)
        : undefined,
      reasoningUnits: event.reasoningUnits
        ? Number(event.reasoningUnits)
        : undefined,
    })
    const refreshed = await db.query.billableUsageEventModel.findFirst({
      where: { id: event.id },
      columns: { status: true },
    })
    if (refreshed?.status === "settled") {
      settled += 1
    }
  }
  return settled
}

const getUsageSummary = async (workspaceId: string, days = 30) => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = await db
    .select({
      category: billableUsageEventModel.category,
      microPoints: sql<string>`coalesce(sum(${billableUsageEventModel.settledMicroPoints}), 0)`,
      operations: sql<number>`count(*)::int`,
    })
    .from(billableUsageEventModel)
    .where(
      and(
        eq(billableUsageEventModel.workspaceId, workspaceId),
        eq(billableUsageEventModel.status, "settled"),
        gte(billableUsageEventModel.createdAt, since),
      ),
    )
    .groupBy(billableUsageEventModel.category)
    .orderBy(sql`sum(${billableUsageEventModel.settledMicroPoints}) desc`)
  return rows.map((row) => ({
    category: row.category,
    points: toVisiblePoints(BigInt(row.microPoints)),
    operations: row.operations,
  }))
}

export const usageMeteringService = {
  reserve,
  settleLanguage,
  settleUnits,
  release,
  releaseStaleReservations,
  retryPendingSettlements,
  getUsageSummary,
}
