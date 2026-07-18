import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import { paymentModel } from "./payment"
import { workspaceModel } from "./workspace"

// Inbound-webhook replay guard, keyed globally on (provider, providerEventId)
// — independent of workspace, since a bad/unmatched event must still be
// de-duplicated before we know which workspace it belongs to.
// `payloadSummary` must only ever hold sanitized fields (event type, amount,
// currency, reference) — never the raw body, headers, or signing secret.
export const paymentWebhookEventModel = pgTable(
  "PaymentWebhookEvent",
  {
    ...sharedColumns,
    provider: text().notNull(),
    providerEventId: text().notNull(),
    paymentId: bigintAsString().references(() => paymentModel.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    receivedAt: timestamp(timestampConfig).defaultNow().notNull(),
    payloadSummary: jsonb().$type<Record<string, unknown>>(),
    workspaceId: bigintAsString().references(() => workspaceModel.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    uniqueIndex("PaymentWebhookEvent_provider_eventId_key").on(
      table.provider,
      table.providerEventId,
    ),
    index("PaymentWebhookEvent_paymentId_idx").using(
      "btree",
      table.paymentId.asc().nullsLast(),
    ),
  ],
)
