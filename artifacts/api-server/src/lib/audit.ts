import { db, auditLogsTable } from "@workspace/db";
import type { Request } from "express";
import type { SessionUser } from "./types";
import { logger } from "./logger";

/**
 * APPEND-ONLY GUARD — DO NOT add update or delete operations on audit_logs.
 *
 * The service layer enforces append-only by never calling UPDATE or DELETE
 * on auditLogsTable. In Cloud SQL production, add a PostgreSQL trigger:
 *
 *   CREATE OR REPLACE RULE no_update_audit AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
 *   CREATE OR REPLACE RULE no_delete_audit AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
 *
 * Or use RLS + a write-only service account that has INSERT but no UPDATE/DELETE.
 * There are no routes in audit.routes.ts that allow modifying or deleting logs.
 */

export type AuditAction =
  | "create" | "update" | "delete"
  | "login" | "logout" | "login_failed"
  | "invite" | "suspend" | "activate"
  | "assign_role" | "remove_role"
  | "confirm" | "reject"
  | "switch_workspace" | "workspace_update"
  | "register"
  | "user_password_change"
  | "payment_method_create" | "payment_method_update" | "payment_method_activate" | "payment_method_deactivate"
  | "exchange_rate_create" | "exchange_rate_update"
  | "debt_create" | "debt_update" | "debt_status_change" | "debt_cancel" | "debt_write_off"
  | "collection_note_create" | "collection_note_update" | "collection_note_delete"
  | "knowledge_base_create" | "knowledge_base_update" | "knowledge_base_archive"
  | "knowledge_source_create" | "knowledge_source_update" | "knowledge_source_archive"
  | "knowledge_document_create" | "knowledge_document_update" | "knowledge_document_archive" | "knowledge_document_rechunk"
  | "faq_create" | "faq_update" | "faq_archive"
  | "ai_agent_create" | "ai_agent_update" | "ai_agent_disable" | "ai_agent_duplicate" | "ai_agent_delete"
  | "ai_run_create" | "ai_run_blocked"
  | "ai_approval_requested" | "ai_approval_approved" | "ai_approval_rejected"
  | "ai_feedback_create"
  | "report_definition_create" | "report_definition_update" | "report_definition_delete"
  | "report_generate"
  | "provider_account_create" | "provider_account_update" | "provider_account_disable"
  | "meta_whatsapp_connected"
  | "webhook_event_replay"
  | "outbox_retry" | "outbox_cancel"
  | "integration_health_update"
  | "template_create" | "template_update" | "template_delete" | "template_duplicate" | "template_submit" | "template_sync"
  | "broadcast_create" | "broadcast_update" | "broadcast_start" | "broadcast_cancel"
  | "automation_create" | "automation_update" | "automation_delete" | "automation_activate" | "automation_pause" | "automation_test_run";

export type AuditSeverity = "info" | "warning" | "critical";

interface AuditParams {
  workspaceId?: string | null;
  actorType: "user" | "system" | "ai" | "automation" | "webhook";
  actorId?: string | null;
  actorLabel?: string | null;
  action: AuditAction;
  severity?: AuditSeverity;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function createAuditLog(params: AuditParams): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      workspaceId: params.workspaceId ?? null,
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      actorLabel: params.actorLabel ?? null,
      action: params.action,
      severity: params.severity ?? "info",
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      entityLabel: params.entityLabel ?? null,
      oldData: params.oldData ?? null,
      newData: params.newData ?? null,
      requestId: params.requestId ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to write audit log");
  }
}

export function auditFromRequest(req: Request, user: SessionUser): Omit<AuditParams, "action" | "entityType"> {
  return {
    workspaceId: user.activeWorkspaceId,
    actorType: "user",
    actorId: user.userId,
    actorLabel: user.name,
    requestId: req.headers["x-request-id"] as string ?? null,
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  };
}
