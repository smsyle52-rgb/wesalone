import { db, aiRunsTable, aiSafetyEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const BLOCKED_ACTIONS = new Set([
  "payment.confirm",
  "payment.reject",
  "payment.update_status",
  "payment.refund",
  "debt.write_off",
  "debt.cancel",
  "role.change",
  "role.assign",
  "role.remove",
  "user.invite",
  "user.suspend",
  "user.delete",
  "integration.activate",
  "integration.deactivate",
  "message.auto_send",
  "message.send",
  "data.delete",
  "data.bulk_delete",
  "order.cancel",
  "webhook.activate",
  "whatsapp.send",
  "email.send",
  "sms.send",
]);

export function isActionBlocked(actionType: string): boolean {
  const lower = actionType.toLowerCase();
  if (BLOCKED_ACTIONS.has(lower)) return true;
  for (const blocked of BLOCKED_ACTIONS) {
    if (lower.includes(blocked) || blocked.includes(lower)) return true;
  }
  return false;
}

export interface SafetyCheckResult {
  blocked: boolean;
  reason?: string;
  severity?: "low" | "medium" | "high" | "critical";
}

export function checkActionSafety(actionType: string): SafetyCheckResult {
  if (!isActionBlocked(actionType)) {
    return { blocked: false };
  }

  const isFinancial = actionType.includes("payment") || actionType.includes("debt") || actionType.includes("order.cancel");
  const isAuth = actionType.includes("role") || actionType.includes("user") || actionType.includes("integration");
  const isSend = actionType.includes("send") || actionType.includes("whatsapp") || actionType.includes("email");
  const isDelete = actionType.includes("delete");

  const severity = isFinancial || isAuth ? "critical"
    : isSend ? "high"
    : isDelete ? "high"
    : "medium";

  return {
    blocked: true,
    reason: "تم منع هذا الإجراء لأنه يتطلب اعتماداً بشرياً أو غير مسموح للذكاء الاصطناعي",
    severity,
  };
}

export async function recordSafetyBlock(params: {
  workspaceId: string;
  aiRunId?: string | null;
  blockedAction: string;
  reason: string;
  severity: "low" | "medium" | "high" | "critical";
  payload?: Record<string, unknown>;
  createdBy?: string | null;
}): Promise<void> {
  try {
    await db.insert(aiSafetyEventsTable).values({
      workspaceId: params.workspaceId,
      aiRunId: params.aiRunId ?? null,
      eventType: "blocked_action",
      severity: params.severity,
      blockedAction: params.blockedAction,
      reason: params.reason,
      payload: params.payload ?? {},
      createdBy: params.createdBy ?? null,
    });

    if (params.aiRunId) {
      await db
        .update(aiRunsTable)
        .set({ status: "blocked", safetyStatus: "blocked", completedAt: new Date() })
        .where(eq(aiRunsTable.id, params.aiRunId));
    }
  } catch (err) {
    logger.error({ err }, "Failed to record safety block");
  }
}

export const SAFE_SUGGESTION_TYPES = new Set([
  "create_ticket",
  "create_task",
  "create_followup",
  "create_opportunity",
  "create_order_draft",
  "draft_reply",
]);

export function isSuggestionSafe(actionType: string): boolean {
  return SAFE_SUGGESTION_TYPES.has(actionType);
}
