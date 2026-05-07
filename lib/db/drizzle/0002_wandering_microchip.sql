CREATE TABLE "dead_letter_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"provider" text,
	"reason" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"key" text NOT NULL,
	"scope" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"response_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inbound_event_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"webhook_event_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_error_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" uuid,
	"severity" text NOT NULL,
	"error_code" text,
	"message" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_health_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" uuid,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latency_ms" integer,
	"message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" uuid,
	"channel_account_id" uuid,
	"conversation_id" uuid,
	"message_id" uuid,
	"destination" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"external_account_id" text,
	"external_business_id" text,
	"external_phone_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"outbox_message_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"request_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_payload" jsonb,
	"status_code" integer,
	"status" text NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_secret_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider_account_id" uuid NOT NULL,
	"secret_key" text NOT NULL,
	"secret_ref" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"provider" text NOT NULL,
	"provider_account_id" uuid,
	"event_type" text NOT NULL,
	"external_event_id" text,
	"idempotency_key" text NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"status" text DEFAULT 'received' NOT NULL,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dead_letter_events" ADD CONSTRAINT "dead_letter_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_event_links" ADD CONSTRAINT "inbound_event_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_event_links" ADD CONSTRAINT "inbound_event_links_webhook_event_id_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."webhook_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_error_events" ADD CONSTRAINT "integration_error_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_error_events" ADD CONSTRAINT "integration_error_events_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_health_checks" ADD CONSTRAINT "integration_health_checks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_health_checks" ADD CONSTRAINT "integration_health_checks_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_delivery_attempts" ADD CONSTRAINT "provider_delivery_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_delivery_attempts" ADD CONSTRAINT "provider_delivery_attempts_outbox_message_id_outbox_messages_id_fk" FOREIGN KEY ("outbox_message_id") REFERENCES "public"."outbox_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_secret_refs" ADD CONSTRAINT "provider_secret_refs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_secret_refs" ADD CONSTRAINT "provider_secret_refs_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_secret_refs" ADD CONSTRAINT "provider_secret_refs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dead_letter_events_workspace" ON "dead_letter_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_dead_letter_events_source" ON "dead_letter_events" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "idx_dead_letter_events_created_at" ON "dead_letter_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_idempotency_keys_scope_key" ON "idempotency_keys" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_workspace" ON "idempotency_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_status" ON "idempotency_keys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_expires_at" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_inbound_event_links_workspace" ON "inbound_event_links" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_inbound_event_links_webhook" ON "inbound_event_links" USING btree ("webhook_event_id");--> statement-breakpoint
CREATE INDEX "idx_inbound_event_links_entity" ON "inbound_event_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_integration_error_events_workspace" ON "integration_error_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_integration_error_events_provider" ON "integration_error_events" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_integration_error_events_created_at" ON "integration_error_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_integration_health_workspace" ON "integration_health_checks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_integration_health_provider" ON "integration_health_checks" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_integration_health_account" ON "integration_health_checks" USING btree ("provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_outbox_messages_workspace_idempotency" ON "outbox_messages" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_outbox_messages_workspace" ON "outbox_messages" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_outbox_messages_status" ON "outbox_messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_outbox_messages_provider" ON "outbox_messages" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_outbox_messages_scheduled_at" ON "outbox_messages" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_provider_accounts_workspace" ON "provider_accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_provider_accounts_provider" ON "provider_accounts" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_provider_accounts_status" ON "provider_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_provider_delivery_attempts_workspace" ON "provider_delivery_attempts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_provider_delivery_attempts_outbox" ON "provider_delivery_attempts" USING btree ("outbox_message_id");--> statement-breakpoint
CREATE INDEX "idx_provider_secret_refs_workspace" ON "provider_secret_refs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_provider_secret_refs_account" ON "provider_secret_refs" USING btree ("provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_webhook_events_provider_idempotency" ON "webhook_events" USING btree ("provider","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_webhook_events_workspace" ON "webhook_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_events_account" ON "webhook_events" USING btree ("provider_account_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_events_status" ON "webhook_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_webhook_events_received_at" ON "webhook_events" USING btree ("received_at");