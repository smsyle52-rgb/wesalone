import { Router, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { publishDomainEvent } from "../../lib/events";
import type { AuthenticatedRequest } from "../../lib/types";

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

async function ensureWorkspaceEntity(
  client: import("pg").PoolClient,
  table: "contacts" | "conversations" | "opportunities" | "workspace_memberships",
  id: string | null | undefined,
  workspaceId: string,
) {
  if (!id) return;
  const result = await client.query(`SELECT id FROM ${table} WHERE id = $1 AND workspace_id = $2 LIMIT 1`, [id, workspaceId]);
  if (!result.rowCount) throw new Error(`INVALID_${table.toUpperCase()}`);
}

router.post("/", requirePermission("orders:create"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات الطلب غير صحيحة" });
    return;
  }
  const { activeWorkspaceId, userId } = req.sessionUser;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureWorkspaceEntity(client, "contacts", parsed.data.contactId, activeWorkspaceId);
    await ensureWorkspaceEntity(client, "conversations", parsed.data.conversationId, activeWorkspaceId);
    await ensureWorkspaceEntity(client, "opportunities", parsed.data.opportunityId, activeWorkspaceId);
    await ensureWorkspaceEntity(client, "workspace_memberships", parsed.data.assignedMembershipId, activeWorkspaceId);

    const orderNumber = `ORD-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const result = await client.query(
      `INSERT INTO orders
       (workspace_id, order_number, status, payment_status, channel, contact_id, conversation_id,
        opportunity_id, source_message_id, assigned_membership_id, total_amount, paid_amount,
        discount, currency, notes, delivery_type, delivery_status, delivery_agent_phone,
        carrier_name, carrier_phone, delivery_receipt_url, delivery_address, delivery_fee,
        cod_enabled, created_by)
       VALUES ($1,$2,'Draft','Unpaid',$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING id, order_number AS "orderNumber", status, payment_status AS "paymentStatus",
                 channel, contact_id AS "contactId", conversation_id AS "conversationId",
                 assigned_membership_id AS "assignedMembershipId", total_amount AS "totalAmount",
                 paid_amount AS "paidAmount", discount, currency, notes,
                 delivery_type AS "deliveryType", delivery_status AS "deliveryStatus",
                 delivery_fee AS "deliveryFee", cod_enabled AS "codEnabled", created_at AS "createdAt"`,
      [activeWorkspaceId, orderNumber, parsed.data.channel, parsed.data.contactId ?? null,
        parsed.data.conversationId ?? null, parsed.data.opportunityId ?? null,
        parsed.data.sourceMessageId ?? null, parsed.data.assignedMembershipId ?? null,
        parsed.data.deliveryFee, parsed.data.discount, parsed.data.currency, parsed.data.notes ?? null,
        parsed.data.deliveryType,
        parsed.data.deliveryType === "pickup" ? null : "preparing",
        parsed.data.deliveryAgentPhone ?? null, parsed.data.carrierName ?? null,
        parsed.data.carrierPhone ?? null, parsed.data.deliveryReceiptUrl ?? null,
        parsed.data.deliveryAddress ?? null, parsed.data.deliveryFee,
        parsed.data.codEnabled, userId],
    );
    await client.query("COMMIT");
    const order = result.rows[0];
    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      workspaceId: activeWorkspaceId,
      action: "create",
      entityType: "order",
      entityId: order.id,
      entityLabel: order.orderNumber,
      newData: { status: "Draft", contactId: parsed.data.contactId, conversationId: parsed.data.conversationId, assignedMembershipId: parsed.data.assignedMembershipId },
    });
    await publishDomainEvent({
      eventType: "order.created",
      entityType: "order",
      entityId: order.id,
      payload: { orderNumber, status: "Draft", contactId: parsed.data.contactId, conversationId: parsed.data.conversationId, channel: parsed.data.channel },
      sessionUser: req.sessionUser,
    });
    res.status(201).json({ order });
  } catch (error) {
    await client.query("ROLLBACK");
    const code = error instanceof Error ? error.message : "";
    if (code.startsWith("INVALID_")) {
      res.status(404).json({ error: "أحد المراجع لا ينتمي لمساحة العمل", code });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
});

export default router;
