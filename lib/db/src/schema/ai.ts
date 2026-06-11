import { index, pgTable, text, timestamp, uuid, integer, jsonb, boolean, numeric, date } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { conversationsTable, messagesTable } from "./conversations";

export const AI_AGENT_TYPES = ["support", "sales", "followup", "summarizer", "classifier", "reports", "collections"] as const;
export type AiAgentType = (typeof AI_AGENT_TYPES)[number];

export const AI_AGENT_STATUSES = ["active", "disabled"] as const;
export type AiAgentStatus = (typeof AI_AGENT_STATUSES)[number];

export const AI_MODELS = ["gemini_flash", "gemini_flash_lite", "gemini_pro", "mock"] as const;
export type AiModel = (typeof AI_MODELS)[number];

export const AI_DIALECTS = ["standard_arabic", "yemeni_light", "yemeni_business"] as const;
export type AiDialect = (typeof AI_DIALECTS)[number];

export const AI_TASK_TYPES = ["summarize", "classify", "draft_reply", "extract", "suggest_action", "report"] as const;
export type AiTaskType = (typeof AI_TASK_TYPES)[number];

export const AI_INPUT_TYPES = ["conversation", "message", "contact", "ticket", "order", "payment", "knowledge_search", "manual"] as const;
export type AiInputType = (typeof AI_INPUT_TYPES)[number];

export const AI_RUN_STATUSES = ["queued", "running", "succeeded", "failed", "blocked"] as const;
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

export const AI_PROVIDERS = ["vertex", "gemini", "mock"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_SAFETY_STATUSES = ["ok", "blocked", "needs_approval"] as const;
export type AiSafetyStatus = (typeof AI_SAFETY_STATUSES)[number];

export const AI_MESSAGE_ROLES = ["system", "developer", "user", "assistant", "tool"] as const;
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

export const AI_FEEDBACK_RATINGS = ["positive", "negative", "neutral"] as const;
export type AiFeedbackRating = (typeof AI_FEEDBACK_RATINGS)[number];

export const AI_SAFETY_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type AiSafetySeverity = (typeof AI_SAFETY_SEVERITIES)[number];

export const APPROVAL_SOURCE_TYPES = ["ai_run", "workflow", "manual"] as const;
export type ApprovalSourceType = (typeof APPROVAL_SOURCE_TYPES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const AI_VERSION_STATUSES = ["draft", "active", "archived"] as const;
export type AiVersionStatus = (typeof AI_VERSION_STATUSES)[number];

export const AI_CHANNEL_MODES = ["disabled", "suggest_only", "draft_only", "auto"] as const;
export type AiChannelMode = (typeof AI_CHANNEL_MODES)[number];

export const aiAgentsTable = pgTable("ai_agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull().default("support"),
  status: text("status").notNull().default("active"),
  defaultModel: text("default_model").notNull().default("mock"),
  temperature: numeric("temperature", { precision: 4, scale: 2 }).notNull().default("0.30"),
  maxOutputTokens: integer("max_output_tokens").notNull().default(1024),
  knowledgeBaseIds: jsonb("knowledge_base_ids").$type<string[]>().notNull().default([]),
  dialect: text("dialect").notNull().default("standard_arabic"),
  tone: text("tone"),
  channelTone: jsonb("channel_tone").$type<Record<string, string>>().notNull().default({}),
  sectorKey: text("sector_key").notNull().default("services_general"),
  sectorBehaviorOverrides: jsonb("sector_behavior_overrides").$type<Record<string, unknown>>().notNull().default({}),
  trustMode: text("trust_mode").notNull().default("suggest"),
  trustConfidenceThreshold: numeric("trust_confidence_threshold", { precision: 3, scale: 2 }).notNull().default("0.80"),
  trustTopics: jsonb("trust_topics").$type<string[]>().notNull().default([]),
  trustBlocklist: jsonb("trust_blocklist").$type<string[]>().notNull().default([]),
  maxAutoRepliesPerConversation: integer("max_auto_replies_per_conversation").notNull().default(3),
  escalateAfterFailedAuto: integer("escalate_after_failed_auto").notNull().default(1),
  dailyAutoSendQuota: integer("daily_auto_send_quota").notNull().default(200),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const autoReplyDecisionsTable = pgTable(
  "auto_reply_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => aiAgentsTable.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull().references(() => messagesTable.id, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    reason: text("reason").notNull(),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    topicDetected: text("topic_detected"),
    sentMessageId: uuid("sent_message_id").references(() => messagesTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_auto_decisions_conv").on(table.conversationId, table.createdAt),
    index("idx_auto_decisions_ws_day").on(table.workspaceId, table.createdAt),
  ],
);

export const aiAgentVersionsTable = pgTable("ai_agent_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => aiAgentsTable.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull().default(1),
  status: text("status").notNull().default("draft"),
  instructionsSnapshot: jsonb("instructions_snapshot").$type<Record<string, unknown>>().default({}),
  toolsSnapshot: jsonb("tools_snapshot").$type<Record<string, unknown>>().default({}),
  modelConfig: jsonb("model_config").$type<Record<string, unknown>>().default({}),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiAgentInstructionsTable = pgTable("ai_agent_instructions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => aiAgentsTable.id, { onDelete: "cascade" }),
  rolePrompt: text("role_prompt").notNull(),
  businessRules: text("business_rules"),
  forbiddenActions: text("forbidden_actions"),
  escalationRules: text("escalation_rules"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiAgentToolsTable = pgTable("ai_agent_tools", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => aiAgentsTable.id, { onDelete: "cascade" }),
  toolKey: text("tool_key").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiAgentChannelsTable = pgTable("ai_agent_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => aiAgentsTable.id, { onDelete: "cascade" }),
  channelAccountId: uuid("channel_account_id"),
  mode: text("mode").notNull().default("disabled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiRunsTable = pgTable("ai_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => aiAgentsTable.id, { onDelete: "set null" }),
  taskType: text("task_type").notNull(),
  inputType: text("input_type").notNull(),
  inputRefId: uuid("input_ref_id"),
  status: text("status").notNull().default("queued"),
  model: text("model").notNull().default("mock"),
  provider: text("provider").notNull().default("mock"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  estimatedCost: numeric("estimated_cost", { precision: 10, scale: 6 }),
  safetyStatus: text("safety_status").notNull().default("ok"),
  errorMessage: text("error_message"),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const aiMessagesTable = pgTable("ai_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  aiRunId: uuid("ai_run_id").notNull().references(() => aiRunsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiExtractionsTable = pgTable("ai_extractions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  aiRunId: uuid("ai_run_id").notNull().references(() => aiRunsTable.id, { onDelete: "cascade" }),
  extractionType: text("extraction_type").notNull(),
  resultJson: jsonb("result_json").$type<Record<string, unknown>>().default({}),
  confidence: numeric("confidence", { precision: 5, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiUsageTable = pgTable("ai_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  model: text("model").notNull(),
  provider: text("provider").notNull(),
  taskType: text("task_type").notNull(),
  totalRuns: integer("total_runs").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCost: numeric("estimated_cost", { precision: 10, scale: 6 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiFeedbackTable = pgTable("ai_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  aiRunId: uuid("ai_run_id").notNull().references(() => aiRunsTable.id, { onDelete: "cascade" }),
  rating: text("rating").notNull().default("neutral"),
  comment: text("comment"),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiSafetyEventsTable = pgTable("ai_safety_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  aiRunId: uuid("ai_run_id").references(() => aiRunsTable.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  severity: text("severity").notNull().default("medium"),
  blockedAction: text("blocked_action").notNull(),
  reason: text("reason").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  createdBy: uuid("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const learnedAnswersTable = pgTable(
  "learned_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    questionPattern: text("question_pattern").notNull(),
    bestAnswer: text("best_answer").notNull(),
    source: text("source").notNull().default("manual"),
    topicSensitivity: text("topic_sensitivity").notNull().default("simple"),
    status: text("status").notNull().default("pending_review"),
    confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull().default("0.70"),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_learned_answers_ws_status").on(table.workspaceId, table.status),
  ],
);

export const approvalRequestsTable = pgTable("approval_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull().default("ai_run"),
  sourceId: uuid("source_id"),
  actionType: text("action_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  status: text("status").notNull().default("pending"),
  requestedBy: uuid("requested_by").notNull().references(() => usersTable.id),
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  rejectedBy: uuid("rejected_by").references(() => usersTable.id),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type AiAgent = typeof aiAgentsTable.$inferSelect;
export type AutoReplyDecision = typeof autoReplyDecisionsTable.$inferSelect;
export type AiAgentVersion = typeof aiAgentVersionsTable.$inferSelect;
export type AiAgentInstruction = typeof aiAgentInstructionsTable.$inferSelect;
export type AiAgentTool = typeof aiAgentToolsTable.$inferSelect;
export type AiAgentChannel = typeof aiAgentChannelsTable.$inferSelect;
export type AiRun = typeof aiRunsTable.$inferSelect;
export type AiMessage = typeof aiMessagesTable.$inferSelect;
export type AiExtraction = typeof aiExtractionsTable.$inferSelect;
export type AiUsage = typeof aiUsageTable.$inferSelect;
export type AiFeedback = typeof aiFeedbackTable.$inferSelect;
export type AiSafetyEvent = typeof aiSafetyEventsTable.$inferSelect;
export type ApprovalRequest = typeof approvalRequestsTable.$inferSelect;
export type LearnedAnswer = typeof learnedAnswersTable.$inferSelect;
