import { Router, type Response } from "express";
import { z } from "zod";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { emitWorkspaceEvent } from "../../lib/events";
import { logger } from "../../lib/logger";
import type { AuthenticatedRequest } from "../../lib/types";
import { requestIdOrFallback } from "./request-values";
import {
  createOrderDraft,
  OrderReferenceConflictError,
  OrderReferenceNotFoundError,
  type CommerceCommandContext,
} from "./application/create-order-draft";

const router = Router();
router.use(requireSession);

const createSchema = z.object({
  contactId: z.string().uuid().optional().nullable(),
  conversationId: z.string().uuid().optional().nullable(),
  opportunityId: z.string().uuid().optional().nullable(),
  sourceMessageId: z.string().uuid().optional().nullable(),
  assignedMembershipId: z.string().uuid().optional().nullable(),
  channel: z.enum(["manual", "whatsapp", "phone", "website", "walk_in"]).default("manual"),
  currency: z.enum(["YER", "SAR", "USD"]).default("YER"),
  discount: z.number().min(0).default(0),
  notes: z.string().max(3000).optional().nullable(),
  deliveryType: z.enum(["pickup", "local", "shipping"]).default("pickup"),
  deliveryAgentPhone: z.string().max(30).optional().nullable(),
  carrierName: z.string().max(120).optional().nullable(),
  carrierPhone: z.string().max(30).optional().nullable(),
  deliveryReceiptUrl: z.string().url().max(2000).optional().nullable(),
  deliveryAddress: z.string().max(500).optional().nullable(),
  deliveryFee: z.number().min(0).default(0),
  codEnabled: z.boolean().default(false),
});

router.post("/", requirePermission("orders:create"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات الطلب غير صحيحة" });
    return;
  }

  const context: CommerceCommandContext = {
    workspaceId: req.sessionUser.activeWorkspaceId,
    actorUserId: req.sessionUser.userId,
    actorMembershipId: req.sessionUser.activeMembershipId,
    actorLabel: req.sessionUser.name,
    requestId: req.header("x-request-id") ?? requestIdOrFallback(req.id, crypto.randomUUID()),
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };

  try {
    const result = await createOrderDraft(parsed.data, context);

    try {
      emitWorkspaceEvent(result.realtimeEvent);
    } catch (error) {
      logger.warn(
        { error, orderId: result.order.id, workspaceId: context.workspaceId },
        "Failed to emit order.created realtime event after commit",
      );
    }

    res.status(201).json({ order: result.order });
  } catch (error) {
    if (error instanceof OrderReferenceConflictError) {
      res.status(409).json({
        error: "مراجع الطلب غير متوافقة",
        code: error.code,
        field: error.field,
      });
      return;
    }
    if (error instanceof OrderReferenceNotFoundError) {
      res.status(404).json({
        error: "أحد المراجع لا ينتمي لمساحة العمل",
        code: error.code,
        field: error.field,
      });
      return;
    }
    throw error;
  }
});

export default router;
