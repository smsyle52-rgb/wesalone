import { index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { platformSubscriptionPaymentStatusTypes } from "../partials/platform-subscription-payment"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import { userModel } from "./auth-user"
import { fileModel } from "./file"
import { workspaceModel } from "./workspace"

export const platformSubscriptionPaymentStatus = pgEnum(
  "platformSubscriptionPaymentStatus",
  platformSubscriptionPaymentStatusTypes.options as [string, ...string[]],
)

// Manual (bank-transfer + admin-review) platform-subscription payment claim —
// mirrors Wesal One's own real payment_submissions model (no automated
// gateway exists there either; see docs/audit/BILLING_REPORT.md in the
// reference project). Deliberately separate from the `Order`/`Payment`
// tables, which are store-customer commerce payments, not platform billing.
export const platformSubscriptionPaymentModel = pgTable(
  "PlatformSubscriptionPayment",
  {
    ...sharedColumns,
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, { onDelete: "cascade" }),
    // References WesalOnePlanSlug (a static TS catalog, not a DB table) —
    // validated server-side against the catalog on every read, never trusted
    // from the client past submission time.
    planSlug: text().notNull(),
    billingCycle: text().notNull(),
    // Free-text description of how the customer says they paid (e.g. "bank
    // transfer"), not a gateway identifier — there is no gateway.
    paymentMethod: text().notNull(),
    reference: text(),
    // The receipt is a File row the caller already uploaded through
    // ChatbotX's own presigned-upload system and that this workspace owns —
    // never a client-supplied URL. See submitSubscriptionPaymentAction.
    receiptFileId: bigintAsString().references(() => fileModel.id, {
      onDelete: "set null",
    }),
    receiptNote: text(),
    status: platformSubscriptionPaymentStatus()
      .default("under_review")
      .notNull(),
    reviewedBy: bigintAsString().references(() => userModel.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp(timestampConfig),
    rejectionReason: text(),
  },
  (table) => [
    index("PlatformSubscriptionPayment_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
    ),
    index("PlatformSubscriptionPayment_workspaceId_status_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
      table.status.asc().nullsLast(),
    ),
  ],
)
