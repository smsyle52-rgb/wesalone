import { Router, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import type { AuthenticatedRequest } from "../../lib/types";
import { adjustInventory } from "./inventory-consumption.service";
import { expireInventoryReservations } from "./inventory-reservation.service";
import { CommerceConflictError } from "./commerce.constants";
import {
  optionalSingleStringParameter,
  requestIdOrFallback,
  singleStringParameter,
} from "./request-values";

const router = Router();
router.use(requireSession);

const locationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(["warehouse", "branch", "showroom", "point_of_sale", "virtual"]).default("warehouse"),
  isDefault: z.boolean().default(false),
});

const adjustmentSchema = z.object({
  adjustment: z.number().int().refine((value) => value !== 0),
  reason: z.string().trim().min(3).max(500),
  movementType: z.enum(["Initial", "Adjustment", "Incoming", "Damage"]).default("Adjustment"),
  idempotencyKey: z.string().trim().min(8).max(200),
});

function correlationId(req: AuthenticatedRequest): string {
  return requestIdOrFallback(
    req.id,
    req.header("x-correlation-id") || crypto.randomUUID(),
  );
}

function handleCommerceError(error: unknown, res: Response) {
  if (error instanceof CommerceConflictError) {
    res.status(409).json({ error: error.message, code: error.code });
    return;
  }
  throw error;
}

router.get("/locations", requirePermission("inventory:read"), async (req: AuthenticatedRequest, res: Response) => {
  const result = await pool.query(
    `SELECT id, name, type, is_default AS "isDefault", is_active AS "isActive",
            metadata, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM stock_locations WHERE workspace_id = $1 ORDER BY is_default DESC, name ASC`,
    [req.sessionUser.activeWorkspaceId],
  );
  res.json({ locations: result.rows });
});

router.post("/locations", requirePermission("inventory:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = locationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات الموقع غير صحيحة" });
    return;
  }
  const { activeWorkspaceId, userId } = req.sessionUser;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (parsed.data.isDefault) {
      await client.query("UPDATE stock_locations SET is_default = false WHERE workspace_id = $1", [activeWorkspaceId]);
    }
    const result = await client.query(
      `INSERT INTO stock_locations (workspace_id, name, type, is_default)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, type, is_default AS "isDefault", is_active AS "isActive"`,
      [activeWorkspaceId, parsed.data.name, parsed.data.type, parsed.data.isDefault],
    );
    await client.query("COMMIT");
    const location = result.rows[0];
    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      workspaceId: activeWorkspaceId,
      action: "create",
      entityType: "stock_location",
      entityId: location.id,
      entityLabel: location.name,
      newData: { ...parsed.data, createdBy: userId },
    });
    res.status(201).json({ location });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.get("/levels", requirePermission("inventory:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const locationIdResult = optionalSingleStringParameter(req.query.locationId);
  const productIdResult = optionalSingleStringParameter(req.query.productId);
  if (!locationIdResult.ok || !productIdResult.ok) {
    res.status(400).json({
      error: "يجب أن تكون معاملات locationId وproductId قيماً مفردة وصحيحة",
      code: "INVALID_QUERY_PARAMETER",
    });
    return;
  }
  const locationId = locationIdResult.value;
  const productId = productIdResult.value;
  const lowStockOnly = req.query.lowStock === "true";
  const result = await pool.query(
    `SELECT l.id, l.product_variant_id AS "productVariantId", l.location_id AS "locationId",
            l.on_hand AS "onHand", l.reserved, l.incoming, l.available,
            v.product_id AS "productId", v.title AS "variantTitle", v.sku, v.barcode,
            v.low_stock_threshold AS "lowStockThreshold", p.name AS "productName",
            s.name AS "locationName", s.type AS "locationType"
     FROM inventory_stock_levels l
     JOIN product_variants v ON v.id = l.product_variant_id AND v.workspace_id = l.workspace_id
     JOIN inventory_products p ON p.id = v.product_id AND p.workspace_id = l.workspace_id
     JOIN stock_locations s ON s.id = l.location_id AND s.workspace_id = l.workspace_id
     WHERE l.workspace_id = $1
       AND ($2::uuid IS NULL OR l.location_id = $2)
       AND ($3::uuid IS NULL OR v.product_id = $3)
       AND ($4::boolean = false OR l.available <= v.low_stock_threshold)
     ORDER BY p.name, v.title, s.name`,
    [activeWorkspaceId, locationId, productId, lowStockOnly],
  );
  res.json({ levels: result.rows });
});

router.post("/levels/:id/adjust", requirePermission("inventory:adjust"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = adjustmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات التعديل غير صحيحة" });
    return;
  }
  const { activeWorkspaceId, userId } = req.sessionUser;
  const levelIdResult = singleStringParameter(req.params.id);
  if (!levelIdResult.ok) {
    res.status(400).json({ error: "معرف سجل المخزون يجب أن يكون قيمة مفردة وصحيحة", code: "INVALID_ROUTE_PARAMETER" });
    return;
  }
  const levelId = levelIdResult.value;
  const level = await pool.query<{ product_variant_id: string; location_id: string }>(
    `SELECT product_variant_id, location_id FROM inventory_stock_levels
     WHERE id = $1 AND workspace_id = $2`,
    [levelId, activeWorkspaceId],
  );
  const stock = level.rows[0];
  if (!stock) {
    res.status(404).json({ error: "سجل المخزون غير موجود" });
    return;
  }
  try {
    const result = await adjustInventory({
      workspaceId: activeWorkspaceId,
      productVariantId: stock.product_variant_id,
      locationId: stock.location_id,
      adjustment: parsed.data.adjustment,
      reason: parsed.data.reason,
      movementType: parsed.data.movementType,
      userId,
      correlationId: correlationId(req),
      idempotencyKey: parsed.data.idempotencyKey,
    });
    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      workspaceId: activeWorkspaceId,
      action: "update",
      severity: "warning",
      entityType: "inventory_stock_level",
      entityId: levelId,
      newData: parsed.data,
    });
    res.json({ stock: result });
  } catch (error) {
    handleCommerceError(error, res);
  }
});

router.get("/movements", requirePermission("inventory:read"), async (req: AuthenticatedRequest, res: Response) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const result = await pool.query(
    `SELECT m.id, m.product_variant_id AS "productVariantId", m.location_id AS "locationId",
            m.quantity, m.movement_type AS "movementType", m.reason, m.order_id AS "orderId",
            m.correlation_id AS "correlationId", m.created_at AS "createdAt",
            p.name AS "productName", v.title AS "variantTitle", s.name AS "locationName"
     FROM inventory_movements m
     JOIN product_variants v ON v.id = m.product_variant_id AND v.workspace_id = m.workspace_id
     JOIN inventory_products p ON p.id = v.product_id AND p.workspace_id = m.workspace_id
     JOIN stock_locations s ON s.id = m.location_id AND s.workspace_id = m.workspace_id
     WHERE m.workspace_id = $1 ORDER BY m.created_at DESC LIMIT $2`,
    [req.sessionUser.activeWorkspaceId, limit],
  );
  res.json({ movements: result.rows });
});

router.post("/reservations/expire", requirePermission("inventory:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const result = await expireInventoryReservations(req.sessionUser.activeWorkspaceId, req.sessionUser.userId);
  res.json(result);
});

export default router;
