import { beforeEach, describe, expect, test, vi } from "vitest"

const USER = "user-1"

const { dbInsert, distributedStore, insertBuilder, userQuotaModel } =
  vi.hoisted(() => {
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
      onConflictDoUpdate: vi.fn(),
    }
    insertBuilder.values.mockReturnValue(insertBuilder)
    insertBuilder.onConflictDoUpdate.mockResolvedValue(undefined)

    return {
      dbInsert: vi.fn(() => insertBuilder),
      distributedStore: {
        get: vi.fn(async () => null as unknown),
        put: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
      insertBuilder,
      userQuotaModel,
    }
  })

vi.mock("@chatbotx.io/database/client", () => ({
  db: {
    insert: dbInsert,
    query: { userQuotaModel: { findFirst: vi.fn(async () => null) } },
  },
  eq: vi.fn(),
  sql: vi.fn(),
}))

vi.mock("@chatbotx.io/database/schema", () => ({
  ROOT_TENANT_ID: "1",
  userQuotaModel,
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

vi.mock("../src/keys", () => ({ isCloud: vi.fn(() => false) }))
vi.mock("../src/logger", () => ({ logger: { warn: vi.fn() } }))

const { userQuotaService } = await import("../src/user-quota/service")

beforeEach(() => {
  vi.clearAllMocks()
  insertBuilder.values.mockClear().mockReturnValue(insertBuilder)
  insertBuilder.onConflictDoUpdate.mockClear().mockResolvedValue(undefined)
  distributedStore.delete.mockClear()
})

describe("userQuotaService.applySandboxPlan", () => {
  const plan = {
    slug: "growth",
    nameEn: "Growth",
    limits: { channels: 3, contacts: 10_000, teamMembers: 5 },
  }

  test("writes the plan's enforceable resource limits", async () => {
    await userQuotaService.applySandboxPlan({ userId: USER, plan })

    expect(dbInsert).toHaveBeenCalledWith(userQuotaModel)
    const [values] = insertBuilder.values.mock.calls[0]
    expect(values).toMatchObject({
      userId: USER,
      contactsLimit: 10_000,
      channelsLimit: 3,
      teamMembersLimit: 5,
      planName: "Growth",
      planStatus: "active",
      periodEnd: null,
    })
    expect(values).not.toHaveProperty("monthlyPoints")
    expect(values).toHaveProperty("agentsLimit", null)
  })

  test("marks the plan active immediately — no trial, no Stripe, no payment step", async () => {
    await userQuotaService.applySandboxPlan({ userId: USER, plan })

    const [values] = insertBuilder.values.mock.calls[0]
    expect(values.planStatus).toBe("active")
    expect(values.periodStart).toBeInstanceOf(Date)
    expect(values.periodEnd).toBeNull()
  })

  test("upserts on conflict (re-selecting a plan updates the existing row) instead of no-op", async () => {
    await userQuotaService.applySandboxPlan({ userId: USER, plan })

    expect(insertBuilder.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: userQuotaModel.userId,
        set: expect.objectContaining({
          channelsLimit: 3,
          contactsLimit: 10_000,
          teamMembersLimit: 5,
          planName: "Growth",
          planStatus: "active",
        }),
      }),
    )
  })

  test("invalidates the cached quota row so the new limits take effect immediately", async () => {
    await userQuotaService.applySandboxPlan({ userId: USER, plan })

    expect(distributedStore.delete).toHaveBeenCalledWith(`user-quota:${USER}`)
  })

  test("applies a custom/unlimited plan's null limits as null, not zero", async () => {
    await userQuotaService.applySandboxPlan({
      userId: USER,
      plan: {
        slug: "business",
        nameEn: "Business",
        limits: { channels: null, contacts: null, teamMembers: null },
      },
    })

    const [values] = insertBuilder.values.mock.calls[0]
    expect(values.channelsLimit).toBeNull()
    expect(values.contactsLimit).toBeNull()
    expect(values.teamMembersLimit).toBeNull()
  })
})
