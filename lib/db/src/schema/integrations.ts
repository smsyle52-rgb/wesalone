import {
  index,
  integer,
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { channelAccountsTable, conversationsTable, messagesTable } from "./conversations";
import { outboxEventsTable } from "./outbox";

export const providerAccountsTable = pgTable(
  "provider_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("draft"),
    externalAccountId: text("external_account_id"),
    externalBusinessId: text("external_business_id"),
    externalPhoneId: text("external_phone_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_provider_accounts_workspace").on(table.workspaceId),
    index("idx_provider_accounts_provider").on(table.provider),
    index("idx_provider_accounts_status").on(table.status),
  ],
);

export const providerSecretRefsTable = pgTable(
  "provider_secret_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    providerAccountId: uuid("provider_account_id")
      .notNull()
      .references(() => providerAccountsTable.id, { onDelete: "cascade" }),
    secretKey: text("secret_key").notNull(),
    secretRef: text("secret_ref").notNull(),
    status: text("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_provider_secret_refs_workspace").on(table.workspaceId),
    index("idx_provider_secret_refs_account").on(table.providerAccountId),
  ],
);

export const webhookEventsTable = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspacesTable.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    providerAccountId: uuid("provider_account_id").references(() => providerAccountsTable.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    externalEventId: text("external_event_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    correlationId: uuid("correlation_id"),
    headers: jsonb("headers").notNull().default({}),
    payload: jsonb("payload").notNull().default({}),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    status: text("status").notNull().default("received"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("uq_webhook_events_provider_idempotency").on(table.provider, table.idempotencyKey),
    index("idx_webhook_events_workspace").on(table.workspaceId),
    index("idx_webhook_events_account").on(table.providerAccountId),
    index("idx_webhook_events_status").on(table.status),
    index("idx_webhook_events_received_at").on(table.receivedAt),
    index("idx_webhook_events_correlation").on(table.correlationId),
  ],
);

export const inboundEventLinksTable = pgTable(
  "inbound_event_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    webhookEventId: uuid("webhook_event_id")
      .notNull()
      .references(() => webhookEventsTable.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_inbound_event_links_workspace").on(table.workspaceId),
    index("idx_inbound_event_links_webhook").on(table.webhookEventId),
    index("idx_inbound_event_links_entity").on(table.entityType, table.entityId),
  ],
);

export const outboxMessagesTable = pgTable(
  "outbox_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: uuid("provider_account_id").references(() => providerAccountsTable.id, { onDelete: "set null" }),
    channelAccountId: uuid("channel_account_id").references(() => channelAccountsTable.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversationsTable.id, { onDelete: "set null" }),
    messageId: uuid("message_id").references(() => messagesTable.id, { onDelete: "set null" }),
    destination: text("destination").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_outbox_messages_workspace_idempotency").on(table.workspaceId, table.idempotencyKey),
    index("idx_outbox_messages_workspace").on(table.workspaceId),
    index("idx_outbox_messages_status").on(table.status),
    index("idx_outbox_msgs_status").on(table.status, table.nextAttemptAt),
    index("idx_outbox_messages_provider").on(table.provider),
    index("idx_outbox_messages_scheduled_at").on(table.scheduledAt),
  ],
);

export const providerDeliveryAttemptsTable = pgTable(
  "provider_delivery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    // Nullable: outbox_messages is deprecated (zero live writers, see W8-T1 proof) and is never
    // populated by new attempts. New rows key off outboxEventId, the live outbox model (W4-T1).
    outboxMessageId: uuid("outbox_message_id").references(() => outboxMessagesTable.id, { onDelete: "cascade" }),
    outboxEventId: uuid("outbox_event_id").references(() => outboxEventsTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    requestPayload: jsonb("request_payload").notNull().default({}),
    responsePayload: jsonb("response_payload"),
    statusCode: integer("status_code"),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_provider_delivery_attempts_workspace").on(table.workspaceId),
    index("idx_provider_delivery_attempts_outbox").on(table.outboxMessageId),
    index("idx_provider_delivery_attempts_outbox_event").on(table.outboxEventId),
  ],
);

export const integrationHealthChecksTable = pgTable(
  "integration_health_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: uuid("provider_account_id").references(() => providerAccountsTable.id, { onDelete: "set null" }),
    status: text("status").notNull().default("unknown"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull().defaultNow(),
    latencyMs: integer("latency_ms"),
    message: text("message"),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => [
    index("idx_integration_health_workspace").on(table.workspaceId),
    index("idx_integration_health_provider").on(table.provider),
    index("idx_integration_health_account").on(table.providerAccountId),
  ],
);

export const integrationErrorEventsTable = pgTable(
  "integration_error_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: uuid("provider_account_id").references(() => providerAccountsTable.id, { onDelete: "set null" }),
    severity: text("severity").notNull(),
    errorCode: text("error_code"),
    message: text("message").notNull(),
    payload: jsonb("payload").notNull().default({}),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_integration_error_events_workspace").on(table.workspaceId),
    index("idx_integration_error_events_provider").on(table.provider),
    index("idx_integration_error_events_created_at").on(table.createdAt),
  ],
);

export const idempotencyKeysTable = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    scope: text("scope").notNull(),
    method: text("method"),
    path: text("path"),
    status: text("status").notNull().default("processing"),
    responseHash: text("response_hash"),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_idempotency_keys_scope_key").on(table.scope, table.key),
    uniqueIndex("uq_idempotency_keys_workspace_key").on(table.workspaceId, table.key),
    index("idx_idempotency_keys_workspace").on(table.workspaceId),
    index("idx_idempotency_keys_status").on(table.status),
    index("idx_idempotency_keys_expires_at").on(table.expiresAt),
    index("idx_idempotency_expires").on(table.expiresAt),
  ],
);

export const metaMobileSignupAttemptsTable = pgTable(
  "meta_mobile_signup_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signupAttemptId: text("signup_attempt_id").notNull(),
    nonceHash: text("nonce_hash").notNull(),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    configKey: text("config_key").notNull(),
    configId: text("config_id").notNull(),
    returnTo: text("return_to").notNull(),
    status: text("status").notNull().default("pending"),
    checkpoint: text("checkpoint").notNull().default("pending"),
    claimToken: text("claim_token"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    encryptedTokenRef: text("encrypted_token_ref"),
    discoveredOptions: jsonb("discovered_options"),
    channelAccountId: uuid("channel_account_id").references(() => channelAccountsTable.id, { onDelete: "set null" }),
    resultReady: boolean("result_ready").notNull().default(false),
    retryCount: integer("retry_count").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_meta_mobile_signup_attempt_id").on(table.signupAttemptId),
    uniqueIndex("uq_meta_mobile_signup_nonce_hash").on(table.nonceHash),
    index("idx_meta_mobile_signup_workspace_status").on(table.workspaceId, table.status),
    index("idx_meta_mobile_signup_lease").on(table.leaseExpiresAt),
    index("idx_meta_mobile_signup_expires").on(table.expiresAt),
  ],
);

export const deadLetterEventsTable = pgTable(
  "dead_letter_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspacesTable.id, { onDelete: "set null" }),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    provider: text("provider"),
    reason: text("reason").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_dead_letter_events_workspace").on(table.workspaceId),
    index("idx_dead_letter_events_source").on(table.sourceType, table.sourceId),
    index("idx_dead_letter_events_created_at").on(table.createdAt),
  ],
);

export type ProviderAccount = typeof providerAccountsTable.$inferSelect;
export type InsertProviderAccount = typeof providerAccountsTable.$inferInsert;
export type ProviderSecretRef = typeof providerSecretRefsTable.$inferSelect;
export type WebhookEvent = typeof webhookEventsTable.$inferSelect;
export type InsertWebhookEvent = typeof webhookEventsTable.$inferInsert;
export type InboundEventLink = typeof inboundEventLinksTable.$inferSelect;
export type OutboxMessage = typeof outboxMessagesTable.$inferSelect;
export type InsertOutboxMessage = typeof outboxMessagesTable.$inferInsert;
export type ProviderDeliveryAttempt = typeof providerDeliveryAttemptsTable.$inferSelect;
export type IntegrationHealthCheck = typeof integrationHealthChecksTable.$inferSelect;
export type IntegrationErrorEvent = typeof integrationErrorEventsTable.$inferSelect;
export type IdempotencyKey = typeof idempotencyKeysTable.$inferSelect;
export type DeadLetterEvent = typeof deadLetterEventsTable.$inferSelect;
