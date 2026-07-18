import { beforeEach, describe, expect, test, vi } from "vitest"
import { makeChain } from "./support/mock-chain"

const UNKNOWN_PLAN_ERROR = /unknown plan/i
const NOT_PAYABLE_ERROR = /cannot be paid for/i
const CONTACT_SALES_ERROR = /contacting sales/i
const DUPLICATE_UNDER_REVIEW_ERROR = /already under review/i
const NOT_UNDER_REVIEW_ERROR = /no longer under review/i
const CONCURRENT_UPDATE_ERROR = /already reviewed/i
const NOT_FOUND_ERROR = /not found/i
const NOT_CANCELLABLE_ERROR = /no longer be cancelled/i
const RECEIPT_NOT_FOUND_ERROR = /receipt file not found/i
const RECEIPT_TYPE_ERROR = /unsupported receipt file type/i
const RECEIPT_TOO_LARGE_ERROR = /larger than 5mb/i
const RECEIPT_INCOMPLETE_ERROR = /did not complete/i

const platformSubscriptionPaymentModel = {
  id: "id-column",
  workspaceId: "workspaceId-column",
  planSlug: "planSlug-column",
  billingCycle: "billingCycle-column",
  paymentMethod: "paymentMethod-column",
  reference: "reference-column",
  receiptFileId: "receiptFileId-column",
  receiptNote: "receiptNote-column",
  status: "status-column",
  reviewedBy: "reviewedBy-column",
  reviewedAt: "reviewedAt-column",
  rejectionReason: "rejectionReason-column",
  createdAt: "createdAt-column",
}
const fileModel = {
  id: "file-id-column",
  workspaceId: "file-workspaceId-column",
  status: "file-status-column",
  path: "file-path-column",
  mimeType: "file-mimeType-column",
  uploadedAt: "file-uploadedAt-column",
}
const workspaceModel = {
  id: "workspace-id-column",
  name: "workspace-name-column",
  ownerId: "workspace-ownerId-column",
}
const userModel = {
  id: "user-id-column",
  name: "user-name-column",
  email: "user-email-column",
}

const { applyPlanEntitlements, findById, headObject, getPresignedDownload } =
  vi.hoisted(() => ({
    applyPlanEntitlements: vi.fn(async () => undefined),
    findById: vi.fn(async () => ({ id: "workspace-1", ownerId: "owner-1" })),
    headObject: vi.fn(async () => ({ ContentLength: 1024 })),
    getPresignedDownload: vi.fn(async () => "https://storage.example/signed"),
  }))

vi.mock("../src/user-quota", () => ({
  userQuotaService: { applyPlanEntitlements },
}))
vi.mock("../src/workspace", () => ({
  workspaceService: { findById },
}))
vi.mock("@chatbotx.io/filesystem", () => ({
  uploader: { headObject, getPresignedDownload },
}))

vi.mock("@chatbotx.io/database/schema", () => ({
  platformSubscriptionPaymentModel,
  fileModel,
  workspaceModel,
  userModel,
}))

vi.mock("@chatbotx.io/database/partials", async () => {
  const actual = await vi.importActual("@chatbotx.io/database/partials")
  return actual
})

let fileRow: Record<string, unknown> | null = {
  id: "file-1",
  workspaceId: "workspace-1",
  mimeType: "image/png",
  path: "workspaces/workspace-1/subscription-payment-receipts/1-receipt.png",
  status: "pending",
}
let selectDuplicateRows: unknown[] = []
let insertReturnRows: unknown[] = []
let txSelectRows: unknown[] = []
let txUpdateRows: unknown[] = []
let plainUpdateRows: unknown[] = []

const dbMock = {
  select: vi.fn(() => makeChain(selectDuplicateRows)),
  insert: vi.fn(() => makeChain(insertReturnRows)),
  update: vi.fn(() => makeChain(plainUpdateRows)),
  query: {
    fileModel: { findFirst: vi.fn(async () => fileRow) },
  },
  transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
    const tx = {
      select: vi.fn(() => {
        const chain = makeChain(txSelectRows)
        chain.for = vi.fn(() => chain)
        return chain
      }),
      update: vi.fn(() => makeChain(txUpdateRows)),
    }
    return await fn(tx)
  }),
}

vi.mock("@chatbotx.io/database/client", () => ({
  db: dbMock,
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
}))

const { platformSubscriptionPaymentService } = await import(
  "../src/platform-subscription-payment/service"
)

const WORKSPACE = "workspace-1"
const ADMIN = "admin-1"

beforeEach(() => {
  vi.clearAllMocks()
  fileRow = {
    id: "file-1",
    workspaceId: "workspace-1",
    mimeType: "image/png",
    path: "workspaces/workspace-1/subscription-payment-receipts/1-receipt.png",
    status: "pending",
  }
  selectDuplicateRows = []
  insertReturnRows = [{ id: "sub-1", status: "under_review" }]
  txSelectRows = []
  txUpdateRows = []
  plainUpdateRows = []
  findById.mockResolvedValue({ id: WORKSPACE, ownerId: "owner-1" })
  headObject.mockResolvedValue({ ContentLength: 1024 })
})

describe("platformSubscriptionPaymentService.createSubmission — receipt ownership/type/size", () => {
  test("rejects a receiptFileId that does not belong to this workspace", async () => {
    fileRow = null // findFirst({ id, workspaceId }) returns nothing for a foreign file

    await expect(
      platformSubscriptionPaymentService.createSubmission({
        workspaceId: WORKSPACE,
        planSlug: "growth",
        billingCycle: "monthly",
        paymentMethod: "bank_transfer",
        receiptFileId: "someone-elses-file",
      }),
    ).rejects.toThrow(RECEIPT_NOT_FOUND_ERROR)
  })

  test("rejects an unsupported receipt mimeType", async () => {
    fileRow = { ...fileRow, mimeType: "application/pdf" }

    await expect(
      platformSubscriptionPaymentService.createSubmission({
        workspaceId: WORKSPACE,
        planSlug: "growth",
        billingCycle: "monthly",
        paymentMethod: "bank_transfer",
        receiptFileId: "file-1",
      }),
    ).rejects.toThrow(RECEIPT_TYPE_ERROR)
  })

  test("rejects a receipt larger than 5MB, checked against the real stored object", async () => {
    headObject.mockResolvedValue({ ContentLength: 6 * 1024 * 1024 })

    await expect(
      platformSubscriptionPaymentService.createSubmission({
        workspaceId: WORKSPACE,
        planSlug: "growth",
        billingCycle: "monthly",
        paymentMethod: "bank_transfer",
        receiptFileId: "file-1",
      }),
    ).rejects.toThrow(RECEIPT_TOO_LARGE_ERROR)
  })

  test("rejects when the upload never completed (object missing from storage)", async () => {
    headObject.mockRejectedValue(new Error("NotFound"))

    await expect(
      platformSubscriptionPaymentService.createSubmission({
        workspaceId: WORKSPACE,
        planSlug: "growth",
        billingCycle: "monthly",
        paymentMethod: "bank_transfer",
        receiptFileId: "file-1",
      }),
    ).rejects.toThrow(RECEIPT_INCOMPLETE_ERROR)
  })
})

describe("platformSubscriptionPaymentService.createSubmission — plan/duplicate", () => {
  test("rejects an unknown plan slug", async () => {
    await expect(
      platformSubscriptionPaymentService.createSubmission({
        workspaceId: WORKSPACE,
        planSlug: "not-a-real-plan",
        billingCycle: "monthly",
        paymentMethod: "bank_transfer",
        receiptFileId: "file-1",
      }),
    ).rejects.toThrow(UNKNOWN_PLAN_ERROR)
  })

  test("rejects the free plan (nothing to pay for)", async () => {
    await expect(
      platformSubscriptionPaymentService.createSubmission({
        workspaceId: WORKSPACE,
        planSlug: "free",
        billingCycle: "monthly",
        paymentMethod: "bank_transfer",
        receiptFileId: "file-1",
      }),
    ).rejects.toThrow(NOT_PAYABLE_ERROR)
  })

  test("rejects the custom/business plan (contact-sales only, no price)", async () => {
    await expect(
      platformSubscriptionPaymentService.createSubmission({
        workspaceId: WORKSPACE,
        planSlug: "business",
        billingCycle: "monthly",
        paymentMethod: "bank_transfer",
        receiptFileId: "file-1",
      }),
    ).rejects.toThrow(CONTACT_SALES_ERROR)
  })

  test("rejects a duplicate still-under-review submission for the same workspace+plan+cycle", async () => {
    selectDuplicateRows = [{ id: "existing-sub" }]

    await expect(
      platformSubscriptionPaymentService.createSubmission({
        workspaceId: WORKSPACE,
        planSlug: "growth",
        billingCycle: "monthly",
        paymentMethod: "bank_transfer",
        receiptFileId: "file-1",
      }),
    ).rejects.toThrow(DUPLICATE_UNDER_REVIEW_ERROR)
  })

  test("accepts a payable plan with a verified receipt and never derives price from caller input", async () => {
    const submission =
      await platformSubscriptionPaymentService.createSubmission({
        workspaceId: WORKSPACE,
        planSlug: "growth",
        billingCycle: "monthly",
        paymentMethod: "bank_transfer",
        reference: "TX123",
        receiptFileId: "file-1",
      })

    expect(submission).toEqual({ id: "sub-1", status: "under_review" })
    const usedChain = dbMock.insert.mock.results.at(-1)?.value as {
      values: ReturnType<typeof vi.fn>
    }
    const [values] = usedChain.values.mock.calls.at(-1) ?? []
    expect(values).not.toHaveProperty("amount")
    expect(values).not.toHaveProperty("price")
    expect(values).toMatchObject({
      workspaceId: WORKSPACE,
      planSlug: "growth",
      billingCycle: "monthly",
      status: "under_review",
      receiptFileId: "file-1",
    })
  })
})

describe("platformSubscriptionPaymentService.confirmSubmission", () => {
  test("activates the plan exactly once on a fresh under_review submission, resolving ownerId fresh from the workspace", async () => {
    txSelectRows = [
      {
        id: "sub-1",
        workspaceId: WORKSPACE,
        planSlug: "growth",
        billingCycle: "monthly",
        status: "under_review",
      },
    ]
    txUpdateRows = [{ id: "sub-1", status: "confirmed" }]

    const result = await platformSubscriptionPaymentService.confirmSubmission({
      submissionId: "sub-1",
      reviewedByUserId: ADMIN,
    })

    expect(result.status).toBe("confirmed")
    expect(findById).toHaveBeenCalledWith({ id: WORKSPACE })
    expect(applyPlanEntitlements).toHaveBeenCalledTimes(1)
    expect(applyPlanEntitlements).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "owner-1" }),
    )
  })

  test("rejects confirming a submission that is not under review, without touching UserQuota", async () => {
    txSelectRows = [
      {
        id: "sub-1",
        workspaceId: WORKSPACE,
        planSlug: "growth",
        billingCycle: "monthly",
        status: "confirmed",
      },
    ]

    await expect(
      platformSubscriptionPaymentService.confirmSubmission({
        submissionId: "sub-1",
        reviewedByUserId: ADMIN,
      }),
    ).rejects.toThrow(NOT_UNDER_REVIEW_ERROR)
    expect(applyPlanEntitlements).not.toHaveBeenCalled()
  })

  test("a concurrent duplicate confirm does not double-activate — conditional update returning 0 rows throws instead of re-granting", async () => {
    txSelectRows = [
      {
        id: "sub-1",
        workspaceId: WORKSPACE,
        planSlug: "growth",
        billingCycle: "monthly",
        status: "under_review",
      },
    ]
    txUpdateRows = []

    await expect(
      platformSubscriptionPaymentService.confirmSubmission({
        submissionId: "sub-1",
        reviewedByUserId: ADMIN,
      }),
    ).rejects.toThrow(CONCURRENT_UPDATE_ERROR)
  })

  test("submission not found is rejected cleanly", async () => {
    txSelectRows = []

    await expect(
      platformSubscriptionPaymentService.confirmSubmission({
        submissionId: "missing",
        reviewedByUserId: ADMIN,
      }),
    ).rejects.toThrow(NOT_FOUND_ERROR)
    expect(applyPlanEntitlements).not.toHaveBeenCalled()
  })
})

describe("platformSubscriptionPaymentService.rejectSubmission", () => {
  test("never touches UserQuota — a rejected payment cannot change the customer's current plan", async () => {
    plainUpdateRows = [
      { id: "sub-1", status: "rejected", rejectionReason: "no receipt" },
    ]

    const result = await platformSubscriptionPaymentService.rejectSubmission({
      submissionId: "sub-1",
      reviewedByUserId: ADMIN,
      reason: "no receipt",
    })

    expect(result.status).toBe("rejected")
    expect(applyPlanEntitlements).not.toHaveBeenCalled()
  })

  test("rejects when the submission is no longer under review", async () => {
    plainUpdateRows = []

    await expect(
      platformSubscriptionPaymentService.rejectSubmission({
        submissionId: "sub-1",
        reviewedByUserId: ADMIN,
        reason: "too late",
      }),
    ).rejects.toThrow(NOT_UNDER_REVIEW_ERROR)
  })
})

describe("platformSubscriptionPaymentService.cancelSubmission", () => {
  test("only cancels a submission belonging to the caller's own workspace", async () => {
    plainUpdateRows = []

    await expect(
      platformSubscriptionPaymentService.cancelSubmission({
        workspaceId: "someone-elses-workspace",
        submissionId: "sub-1",
      }),
    ).rejects.toThrow(NOT_CANCELLABLE_ERROR)
  })
})
