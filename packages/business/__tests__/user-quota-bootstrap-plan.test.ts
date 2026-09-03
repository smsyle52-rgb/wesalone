import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const DEFAULT_PLAN_ENTITLEMENT_KEY = "entitlements:default-plan"
const USER = "user-1"

const {
  dbInsert,
  createGrant,
  distributedStore,
  insertBuilder,
  isCloud,
  loggerWarn,
  userQuotaModel,
} = vi.hoisted(() => {
  const userQuotaModel = {
    userId: "userId-column",
    contactsUsed: "contactsUsed-column",
    workspacesUsed: "workspacesUsed-column",
    channelsUsed: "channelsUsed-column",
    teamMembersUsed: "teamMembersUsed-column",
    macUsed: "macUsed-column",
  }
  const insertBuilder = {
    values: vi.fn(),
    onConflictDoNothing: vi.fn(),
    returning: vi.fn(async () => [{ userId: USER }]),
  }
  insertBuilder.values.mockReturnValue(insertBuilder)
  insertBuilder.onConflictDoNothing.mockReturnValue(insertBuilder)

  return {
    createGrant: vi.fn(async () => undefined),
    dbInsert: vi.fn(() => insertBuilder),
    distributedStore: {
      get: vi.fn(async () => null as unknown),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
    insertBuilder,
    isCloud: vi.fn(() => true),
    loggerWarn: vi.fn(),
    userQuotaModel,
  }
})

vi.mock("@chatbotx.io/database/client", () => ({
  db: {
    insert: dbInsert,
    query: { userQuotaModel: { findFirst: vi.fn(async () => null) } },
    transaction: vi.fn(async (callback) => callback({ insert: dbInsert })),
  },
  eq: vi.fn(),
  sql: vi.fn(),
}))

vi.mock("@chatbotx.io/database/schema", () => ({
  ROOT_TENANT_ID: "1",
  platformSubscriptionModel: { userId: "subscription-userId-column" },
  userQuotaModel,
}))

vi.mock("../src/point-wallet/service", () => ({
  pointWalletService: { createGrant },
}))

vi.mock("@chatbotx.io/redis", () => ({
  cacheConnections: {
    useExisting: vi.fn(async () => ({
      hget: vi.fn(async () => null),
      hsetnx: vi.fn(async () => 1),
      hincrby: vi.fn(async () => 1),
    })),
  },
  distributedStore,
  invalidateCacheByTags: vi.fn(async () => undefined),
}))

vi.mock("../src/keys", () => ({ isCloud }))
vi.mock("../src/logger", () => ({ logger: { warn: loggerWarn } }))

const { userQuotaService } = await import("../src/user-quota/service")

const snapshot = {
  channelsLimit: 2,
  contactsLimit: 1000,
  macLimit: 100,
  planName: "Free",
  saasMode: true,
  ssoSaml: false,
  teamMembersLimit: 3,
  trialDays: 14,
  whiteLabel: true,
  workspacesLimit: 4,
}

beforeEach(() => {
  vi.clearAllMocks()
  isCloud.mockReturnValue(true)
  distributedStore.get.mockResolvedValue(null)
  insertBuilder.values.mockClear().mockReturnValue(insertBuilder)
  insertBuilder.onConflictDoNothing.mockClear().mockReturnValue(insertBuilder)
  insertBuilder.returning.mockClear().mockResolvedValue([{ userId: USER }])
  createGrant.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("userQuotaService.ensureBootstrapPlan", () => {
  test("stamps an active Free row for a root Wesal One signup", async () => {
    distributedStore.get.mockImplementation(async (key: string) =>
      key === DEFAULT_PLAN_ENTITLEMENT_KEY ? snapshot : null,
    )

    await userQuotaService.ensureBootstrapPlan({ userId: USER })

    expect(dbInsert).toHaveBeenCalledWith(userQuotaModel)
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        contactsLimit: 1000,
        workspacesLimit: 4,
        channelsLimit: 2,
        teamMembersLimit: 3,
        macLimit: 100,
        whiteLabel: false,
        ssoSaml: false,
        saasMode: false,
        planName: "Free",
        planStatus: "active",
      }),
    )
    expect(insertBuilder.onConflictDoNothing).toHaveBeenCalledWith({
      target: userQuotaModel.userId,
    })
    const [values] = insertBuilder.values.mock.calls[0]
    expect(values.periodStart).toBeInstanceOf(Date)
    expect(values.periodEnd).toBeNull()
    expect(distributedStore.delete).toHaveBeenCalledWith(`user-quota:${USER}`)
  })

  test("falls back to active access when snapshot trialDays is invalid", async () => {
    distributedStore.get.mockImplementation(async (key: string) =>
      key === DEFAULT_PLAN_ENTITLEMENT_KEY
        ? { ...snapshot, trialDays: undefined }
        : null,
    )

    await userQuotaService.ensureBootstrapPlan({ userId: USER })

    const [values] = insertBuilder.values.mock.calls[0]
    expect(values.planStatus).toBe("active")
    expect(values.periodEnd).toBeNull()
  })

  test("stamps an active, never-expiring row when snapshot trialDays is 0", async () => {
    distributedStore.get.mockImplementation(async (key: string) =>
      key === DEFAULT_PLAN_ENTITLEMENT_KEY
        ? { ...snapshot, trialDays: 0 }
        : null,
    )

    await userQuotaService.ensureBootstrapPlan({ userId: USER })

    const [values] = insertBuilder.values.mock.calls[0]
    expect(values.planStatus).toBe("active")
    expect(values.periodEnd).toBeNull()

    const accessState = userQuotaService.getAccessStateFromQuota({
      id: "quota-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      contactsUsed: 0,
      workspacesUsed: 0,
      channelsUsed: 0,
      teamMembersUsed: 0,
      macUsed: 0,
      ...values,
    })
    expect(accessState).toMatchObject({ blocked: false, status: "active" })
    expect(accessState.trialEndsAt).toBeNull()
  })

  test("skips the cache bust when the insert was a no-op conflict", async () => {
    insertBuilder.returning.mockResolvedValue([])

    await userQuotaService.ensureBootstrapPlan({ userId: USER })

    expect(insertBuilder.onConflictDoNothing).toHaveBeenCalledWith({
      target: userQuotaModel.userId,
    })
    expect(distributedStore.delete).not.toHaveBeenCalled()
  })

  test("creates the free subscription grant when quota already won the race", async () => {
    insertBuilder.returning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userId: USER }])

    await userQuotaService.ensureBootstrapPlan({ userId: USER })

    expect(createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        grantType: "monthly_subscription",
        points: 1000,
        idempotencyKey: `bootstrap-free:${USER}`,
      }),
      expect.anything(),
    )
    expect(distributedStore.delete).not.toHaveBeenCalled()
  })

  test("clamps a month-end signup to the last day of the next month", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-31T12:30:00.000Z"))

    await userQuotaService.ensureBootstrapPlan({ userId: USER })

    expect(createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: new Date("2026-01-31T12:30:00.000Z"),
        expiresAt: new Date("2026-02-28T12:30:00.000Z"),
      }),
      expect.anything(),
    )
  })

  test("does not grant free points when a subscription already exists", async () => {
    insertBuilder.returning
      .mockResolvedValueOnce([{ userId: USER }])
      .mockResolvedValueOnce([])

    await userQuotaService.ensureBootstrapPlan({ userId: USER })

    expect(createGrant).not.toHaveBeenCalled()
  })

  test("stamps the usable free fallback when the snapshot is absent", async () => {
    await userQuotaService.ensureBootstrapPlan({ userId: USER })

    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        contactsLimit: 100,
        workspacesLimit: 1,
        channelsLimit: 1,
        teamMembersLimit: 1,
        macLimit: 100,
        whiteLabel: false,
        ssoSaml: false,
        saasMode: false,
        planName: "Free",
        planStatus: "active",
      }),
    )
  })

  test("does not clobber an existing quota row", async () => {
    await userQuotaService.ensureBootstrapPlan({ userId: USER })

    expect(insertBuilder.onConflictDoNothing).toHaveBeenCalledWith({
      target: userQuotaModel.userId,
    })
    expect(dbInsert).toHaveBeenCalledTimes(2)
  })

  // Upstream no-ops off-cloud. Wesal One runs the community edition but is
  // itself the platform for its merchants, so the row has to be stamped here
  // too: without it the quota row is only created later as a side effect of
  // usage counting, landing with `autoReplyEnabled` false, and the merchant's
  // agent is silent from the moment they sign up.
  test("still stamps the bootstrap row outside cloud edition", async () => {
    isCloud.mockReturnValue(false)

    await userQuotaService.ensureBootstrapPlan({ userId: USER })

    expect(dbInsert).toHaveBeenCalled()
  })

  test("creates an unblocked active free access state", async () => {
    await userQuotaService.ensureBootstrapPlan({ userId: USER })

    const [values] = insertBuilder.values.mock.calls[0]
    const accessState = userQuotaService.getAccessStateFromQuota({
      id: "quota-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      contactsUsed: 0,
      workspacesUsed: 0,
      channelsUsed: 0,
      teamMembersUsed: 0,
      macUsed: 0,
      ...values,
    })

    expect(accessState).toMatchObject({
      blocked: false,
      planName: "Free",
      status: "active",
    })
    expect(accessState.trialEndsAt).toBeNull()
  })

  test("uses a tenant snapshot for a non-root tenant", async () => {
    const tenantId = "tenant-42"
    distributedStore.get.mockImplementation(async (key: string) =>
      key === `${DEFAULT_PLAN_ENTITLEMENT_KEY}:${tenantId}`
        ? { ...snapshot, planName: "Tenant Free", macLimit: 250 }
        : null,
    )

    await userQuotaService.ensureBootstrapPlan({ userId: USER, tenantId })

    expect(distributedStore.get).toHaveBeenCalledWith(
      `${DEFAULT_PLAN_ENTITLEMENT_KEY}:${tenantId}`,
    )
    expect(distributedStore.get).not.toHaveBeenCalledWith(
      DEFAULT_PLAN_ENTITLEMENT_KEY,
    )
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        macLimit: 250,
        planName: "Tenant Free",
        planStatus: "trial",
      }),
    )
  })

  test("uses the free fallback when a tenant snapshot is missing", async () => {
    const tenantId = "tenant-42"
    distributedStore.get.mockImplementation(async (key: string) =>
      key === DEFAULT_PLAN_ENTITLEMENT_KEY ? snapshot : null,
    )

    await userQuotaService.ensureBootstrapPlan({ userId: USER, tenantId })

    expect(distributedStore.get).toHaveBeenCalledWith(
      `${DEFAULT_PLAN_ENTITLEMENT_KEY}:${tenantId}`,
    )
    expect(distributedStore.get).not.toHaveBeenCalledWith(
      DEFAULT_PLAN_ENTITLEMENT_KEY,
    )
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        contactsLimit: 100,
        workspacesLimit: 1,
        channelsLimit: 1,
        teamMembersLimit: 1,
        macLimit: 100,
        planName: "Free",
        planStatus: "active",
      }),
    )
  })
})
