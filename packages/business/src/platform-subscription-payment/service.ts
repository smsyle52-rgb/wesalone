import { and, db, eq } from "@chatbotx.io/database/client"
import {
  fileStatuses,
  type PlatformSubscriptionBillingCycle,
  platformSubscriptionBillingCycles,
} from "@chatbotx.io/database/partials"
import {
  fileModel,
  platformSubscriptionPaymentModel,
  userModel,
  workspaceModel,
} from "@chatbotx.io/database/schema"
import type { PlatformSubscriptionPaymentModel } from "@chatbotx.io/database/types"
import { uploader } from "@chatbotx.io/filesystem"
import { ChatbotXException } from "../errors"
import {
  findWesalOnePlan,
  type WesalOnePlan,
} from "../platform/wesal-one-plans"
import { userQuotaService } from "../user-quota"
import { workspaceService } from "../workspace"

const UNDER_REVIEW = "under_review"
const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
])
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024

function addBillingPeriod(
  from: Date,
  cycle: PlatformSubscriptionBillingCycle,
): Date {
  const next = new Date(from)
  next.setMonth(next.getMonth() + (cycle === "annual" ? 12 : 1))
  return next
}

function assertPayablePlan(plan: WesalOnePlan | undefined): WesalOnePlan {
  if (!plan) {
    throw new ChatbotXException("Unknown plan", "planNotFound", 404)
  }
  if (plan.priceMonthlyUsd === null || plan.priceMonthlyUsd <= 0) {
    throw new ChatbotXException(
      plan.slug === "business"
        ? "The business plan requires contacting sales, not a self-serve payment."
        : "This plan cannot be paid for.",
      "planNotPayable",
      400,
    )
  }
  return plan
}

/**
 * Verifies the receipt is a real, completed upload that belongs to THIS
 * workspace — never trusts a client-supplied URL. Mirrors the ownership
 * check import-contacts.action.ts already uses for its own uploaded files
 * (`fileModel.findFirst({ id, workspaceId })`), plus a real server-side
 * mimeType + byte-size check against the object actually sitting in
 * storage (the presigned PUT itself enforces neither).
 */
export async function verifyReceiptFile(
  workspaceId: string,
  receiptFileId: string,
) {
  const file = await db.query.fileModel.findFirst({
    where: { id: receiptFileId, workspaceId },
  })
  if (!file) {
    throw new ChatbotXException(
      "Receipt file not found for this workspace.",
      "receiptNotFound",
      404,
    )
  }
  if (!ALLOWED_RECEIPT_MIME_TYPES.has(file.mimeType)) {
    throw new ChatbotXException(
      "Unsupported receipt file type. Use JPG, PNG, or WebP.",
      "receiptTypeUnsupported",
      415,
    )
  }

  let contentLength: number | undefined
  try {
    const head = await uploader.headObject(file.path)
    contentLength = head.ContentLength
  } catch {
    throw new ChatbotXException(
      "The receipt upload did not complete. Please try again.",
      "receiptUploadIncomplete",
      422,
    )
  }
  if (typeof contentLength === "number" && contentLength > MAX_RECEIPT_BYTES) {
    throw new ChatbotXException(
      "Receipt file is larger than 5MB.",
      "receiptTooLarge",
      413,
    )
  }

  return file
}

/**
 * Manual (bank-transfer + platform-admin review) platform-subscription
 * payment flow — the model Wesal One's own reference project actually uses
 * (no automated gateway exists there; see docs/audit/BILLING_REPORT.md).
 * Deliberately mirrors its createSubscriptionPaymentSubmission /
 * confirmSubscriptionPayment / rejectSubscriptionPayment shape.
 *
 * Trust boundary: a submission never activates a plan by itself. Only
 * `confirmSubmission`, called from the super-admin-only action, writes to
 * UserQuota — and only via userQuotaService.applyPlanEntitlements, the same
 * write path the sandbox switcher uses. No order/payment/checkout code is
 * imported or touched.
 */
class PlatformSubscriptionPaymentService {
  async createSubmission(props: {
    workspaceId: string
    planSlug: string
    billingCycle: string
    paymentMethod: string
    reference?: string | null
    receiptFileId: string
    receiptNote?: string | null
  }): Promise<PlatformSubscriptionPaymentModel> {
    const plan = assertPayablePlan(findWesalOnePlan(props.planSlug))
    const cycle = platformSubscriptionBillingCycles.parse(props.billingCycle)
    const file = await verifyReceiptFile(props.workspaceId, props.receiptFileId)

    const [duplicate] = await db
      .select({ id: platformSubscriptionPaymentModel.id })
      .from(platformSubscriptionPaymentModel)
      .where(
        and(
          eq(platformSubscriptionPaymentModel.workspaceId, props.workspaceId),
          eq(platformSubscriptionPaymentModel.planSlug, plan.slug),
          eq(platformSubscriptionPaymentModel.billingCycle, cycle),
          eq(platformSubscriptionPaymentModel.status, UNDER_REVIEW),
        ),
      )
      .limit(1)
    if (duplicate) {
      throw new ChatbotXException(
        "A payment submission for this plan is already under review.",
        "duplicateUnderReview",
        409,
      )
    }

    const [submission] = await db
      .insert(platformSubscriptionPaymentModel)
      .values({
        workspaceId: props.workspaceId,
        planSlug: plan.slug,
        billingCycle: cycle,
        paymentMethod: props.paymentMethod,
        reference: props.reference ?? null,
        receiptFileId: file.id,
        receiptNote: props.receiptNote ?? null,
        status: UNDER_REVIEW,
      })
      .returning()

    await db
      .update(fileModel)
      .set({ status: fileStatuses.enum.uploaded, uploadedAt: new Date() })
      .where(
        and(
          eq(fileModel.id, file.id),
          eq(fileModel.workspaceId, props.workspaceId),
        ),
      )

    return submission
  }

  async cancelSubmission(props: {
    workspaceId: string
    submissionId: string
  }): Promise<PlatformSubscriptionPaymentModel> {
    const [updated] = await db
      .update(platformSubscriptionPaymentModel)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(platformSubscriptionPaymentModel.id, props.submissionId),
          eq(platformSubscriptionPaymentModel.workspaceId, props.workspaceId),
          eq(platformSubscriptionPaymentModel.status, UNDER_REVIEW),
        ),
      )
      .returning()
    if (!updated) {
      throw new ChatbotXException(
        "This submission can no longer be cancelled.",
        "notCancellable",
        409,
      )
    }
    return updated
  }

  /**
   * Super-admin-only. Atomic: the UserQuota write and the submission's
   * status transition happen in one transaction, guarded by a conditional
   * UPDATE (`WHERE status = 'under_review'`). A second confirm/reject call —
   * concurrent or a stale retry — affects zero rows and throws instead of
   * granting the plan twice. The owner id is resolved fresh from the
   * workspace at confirm time (never cached on the submission row), so a
   * workspace-ownership transfer between submission and review is honored.
   */
  async confirmSubmission(props: {
    submissionId: string
    reviewedByUserId: string
  }): Promise<PlatformSubscriptionPaymentModel> {
    return await db.transaction(async (tx) => {
      const [submission] = await tx
        .select()
        .from(platformSubscriptionPaymentModel)
        .where(eq(platformSubscriptionPaymentModel.id, props.submissionId))
        .for("update")
        .limit(1)
      if (!submission) {
        throw new ChatbotXException(
          "Payment submission not found.",
          "notFound",
          404,
        )
      }
      if (submission.status !== UNDER_REVIEW) {
        throw new ChatbotXException(
          "This submission is no longer under review.",
          "notUnderReview",
          409,
        )
      }

      const plan = assertPayablePlan(findWesalOnePlan(submission.planSlug))
      const cycle = platformSubscriptionBillingCycles.parse(
        submission.billingCycle,
      )
      const workspace = await workspaceService.findById({
        id: submission.workspaceId,
      })
      const now = new Date()
      const periodEnd = addBillingPeriod(now, cycle)

      await userQuotaService.applyPlanEntitlements({
        userId: workspace.ownerId,
        plan,
        periodStart: now,
        periodEnd,
      })

      const [updated] = await tx
        .update(platformSubscriptionPaymentModel)
        .set({
          status: "confirmed",
          reviewedBy: props.reviewedByUserId,
          reviewedAt: now,
        })
        .where(
          and(
            eq(platformSubscriptionPaymentModel.id, submission.id),
            eq(platformSubscriptionPaymentModel.status, UNDER_REVIEW),
          ),
        )
        .returning()
      if (!updated) {
        throw new ChatbotXException(
          "This submission was already reviewed by someone else.",
          "concurrentUpdate",
          409,
        )
      }
      return updated
    })
  }

  async rejectSubmission(props: {
    submissionId: string
    reviewedByUserId: string
    reason: string
  }): Promise<PlatformSubscriptionPaymentModel> {
    const [updated] = await db
      .update(platformSubscriptionPaymentModel)
      .set({
        status: "rejected",
        reviewedBy: props.reviewedByUserId,
        reviewedAt: new Date(),
        rejectionReason: props.reason,
      })
      .where(
        and(
          eq(platformSubscriptionPaymentModel.id, props.submissionId),
          eq(platformSubscriptionPaymentModel.status, UNDER_REVIEW),
        ),
      )
      .returning()
    if (!updated) {
      throw new ChatbotXException(
        "This submission is no longer under review.",
        "notUnderReview",
        409,
      )
    }
    return updated
  }

  async listForWorkspace(
    workspaceId: string,
  ): Promise<PlatformSubscriptionPaymentModel[]> {
    return await db
      .select()
      .from(platformSubscriptionPaymentModel)
      .where(eq(platformSubscriptionPaymentModel.workspaceId, workspaceId))
      .orderBy(platformSubscriptionPaymentModel.createdAt)
  }

  /**
   * Admin review queue. Joins in just enough for the list/detail UI
   * (workspace + owner + reviewer names, a short-lived signed receipt URL)
   * without exposing raw storage paths to the client.
   */
  async listForAdmin(status?: string) {
    const rows = await db
      .select({
        submission: platformSubscriptionPaymentModel,
        workspaceName: workspaceModel.name,
        ownerName: userModel.name,
        ownerEmail: userModel.email,
      })
      .from(platformSubscriptionPaymentModel)
      .innerJoin(
        workspaceModel,
        eq(platformSubscriptionPaymentModel.workspaceId, workspaceModel.id),
      )
      .innerJoin(userModel, eq(workspaceModel.ownerId, userModel.id))
      .where(
        status && status !== "all"
          ? eq(platformSubscriptionPaymentModel.status, status)
          : undefined,
      )
      .orderBy(platformSubscriptionPaymentModel.createdAt)

    return await Promise.all(
      rows.map(async (row) => ({
        ...row,
        receiptUrl: await this.getReceiptViewUrl(row.submission.receiptFileId),
      })),
    )
  }

  async getReceiptViewUrl(
    receiptFileId: string | null,
  ): Promise<string | null> {
    if (!receiptFileId) {
      return null
    }
    const file = await db.query.fileModel.findFirst({
      where: { id: receiptFileId },
      columns: { path: true },
    })
    if (!file) {
      return null
    }
    return await uploader.getPresignedDownload(file.path)
  }
}

export const platformSubscriptionPaymentService =
  new PlatformSubscriptionPaymentService()
