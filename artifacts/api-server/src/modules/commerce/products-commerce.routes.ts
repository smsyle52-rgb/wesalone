import { Router, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import type { AuthenticatedRequest } from "../../lib/types";

const router = Router();
router.use(requireSession);

const variantSchema = z.object({
  title: z.string().trim().min(1).max(160).default("افتراضي"),
  sku: z.string().trim().max(100).optional().nullable(),
  barcode: z.string().trim().max(100).optional().nullable(),
  optionValues: z.record(z.string().max(80), z.string().max(120)).default({}),
  price: z.number().min(0),
  cost: z.number().min(0).optional().nullable(),
  currency: z.enum(["YER", "SAR", "USD"]).default("YER"),
  lowStockThreshold: z.number().int().min(0).default(0),
  initialStock: z.number().int().min(0).default(0),
  locationId: z.string().uuid().optional(),
});

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(3000).optional().nullable(),
  images: z.array(z.string().url().max(2000)).max(12).default([]),
  status: z.enum(["active", "archived"]).default("active"),
  unit: z.string().trim().max(50).optional().nullable(),
  deliveryPolicy: z.enum(["all", "local", "pickup_only"]).default("all"),
  variants: z.array(variantSchema).min(1).max(100),
});

const updateVariantSchema = variantSchema.omit({ initialStock: true, locationId: true }).partial();

async function ensureDefaultLocation(client: import("pg").PoolClient, workspaceId: string) {
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM stock_locations WHERE workspace_id = $1 AND is_default = true LIMIT 1 FOR UPDATE",
    [workspaceId],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await client.query<{ id: string }>(
    `INSERT INTO stock_locations (workspace_id, name, type, is_default)
     VALUES ($1, 'الموقع الافتراضي', 'virtual', true) RETURNING id`,
    [workspaceId],
  );
  return created.rows[0]!.id;
}

router.get("/", requirePermission("products:read"), async (req: AuthenticatedRequest, res: Response) => {
  const includeArchived = req.query.archived === "true";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const result = await pool.query(
    `SELECT p.id, p.name, p.description, p.images, p.image_url AS "imageUrl", p.status,
            p.unit, p.delivery_policy AS "deliveryPolicy", p.created_at AS "createdAt",
            p.updated_at AS "updatedAt", p.is_archived AS "isArchived",
            COUNT(DISTINCT v.id)::int AS "variantCount",
            COALESCE(SUM(DISTINCT l.available), 0)::int AS available,
            MIN(v.price) AS "minimumPrice", MAX(v.price) AS "maximumPrice",
            MIN(v.currency) AS currency
     FROM inventory_products p
     LEFT JOIN product_variants v ON v.product_id = p.id AND v.workspace_id = p.workspace_id AND v.status = 'active'
     LEFT JOIN inventory_stock_levels l ON l.product_variant_id = v.id AND l.workspace_id = p.workspace_id
     WHERE p.workspace_id = $1
       AND ($2::boolean OR (p.is_archived = false AND p.status <> 'archived'))
       AND ($3::text = '' OR p.name ILIKE '%' || $3 || '%')
     GROUP BY p.id ORDER BY p.name ASC`,
    [req.sessionUser.activeWorkspaceId, includeArchived, search],
  );
  res.json({ products: result.rows });
});

router.post("/", requirePermission("products:create"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات المنتج غير صحيحة" });
    return;
  }
  const { activeWorkspaceId, userId } = req.sessionUser;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const defaultLocationId = await ensureDefaultLocation(client, activeWorkspaceId);
    const firstVariant = parsed.data.variants[0]!;
    const productResult = await client.query<{ id: string }>(
      `INSERT INTO inventory_products
       (workspace_id, name, description, images, image_url, status, is_archived, unit,
        delivery_policy, price, currency, sku, barcode, cost, low_stock_threshold)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [activeWorkspaceId, parsed.data.name, parsed.data.description ?? null,
        JSON.stringify(parsed.data.images), parsed.data.images[0] ?? null, parsed.data.status,
        parsed.data.status === "archived", parsed.data.unit ?? null, parsed.data.deliveryPolicy,
        firstVariant.price, firstVariant.currency, firstVariant.sku ?? null,
        firstVariant.barcode ?? null, firstVariant.cost ?? null, firstVariant.lowStockThreshold],
    );
    const productId = productResult.rows[0]!.id;
    const variants: Array<Record<string, unknown>> = [];

    for (let index = 0; index < parsed.data.variants.length; index += 1) {
      const variant = parsed.data.variants[index]!;
      const locationId = variant.locationId ?? defaultLocationId;
      const location = await client.query(
        "SELECT id FROM stock_locations WHERE id = $1 AND workspace_id = $2 AND is_active = true",
        [locationId, activeWorkspaceId],
      );
      if (!location.rowCount) throw new Error("LOCATION_NOT_FOUND");

      const variantResult = await client.query<{ id: string; title: string; sku: string | null; barcode: string | null }>(
        `INSERT INTO product_variants
         (workspace_id, product_id, title, sku, barcode, option_values, price, cost, currency,
          low_stock_threshold, is_default, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active')
         RETURNING id, title, sku, barcode`,
        [activeWorkspaceId, productId, variant.title, variant.sku ?? null, variant.barcode ?? null,
          JSON.stringify(variant.optionValues), variant.price, variant.cost ?? null,
          variant.currency, variant.lowStockThreshold, index === 0],
      );
      const createdVariant = variantResult.rows[0]!;
      const levelResult = await client.query<{ id: string; available: number }>(
        `INSERT INTO inventory_stock_levels
         (workspace_id, product_variant_id, location_id, on_hand, reserved, incoming)
         VALUES ($1,$2,$3,$4,0,0)
         RETURNING id, available`,
        [activeWorkspaceId, createdVariant.id, locationId, variant.initialStock],
      );
      if (variant.initialStock > 0) {
        await client.query(
          `INSERT INTO inventory_movements
           (workspace_id, product_variant_id, location_id, quantity, movement_type, reason,
            created_by, correlation_id, idempotency_key)
           VALUES ($1,$2,$3,$4,'Initial','رصيد افتتاحي للمتغير',$5,$6,$7)`,
          [activeWorkspaceId, createdVariant.id, locationId, variant.initialStock, userId,
            req.id || crypto.randomUUID(), `initial:${createdVariant.id}:${locationId}`],
        );
      }
      variants.push({ ...createdVariant, locationId, stockLevelId: levelResult.rows[0]!.id, available: levelResult.rows[0]!.available });
    }

    await client.query("COMMIT");
    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      workspaceId: activeWorkspaceId,
      action: "products_create",
      entityType: "product",
      entityId: productId,
      entityLabel: parsed.data.name,
      newData: { variantCount: variants.length, status: parsed.data.status },
    });
    res.status(201).json({ product: { id: productId, ...parsed.data, variants } });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && error.message === "LOCATION_NOT_FOUND") {
      res.status(404).json({ error: "موقع المخزون غير موجود في مساحة العمل" });
      return;
    }
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "SKU أو Barcode مستخدم مسبقًا داخل مساحة العمل", code: "DUPLICATE_IDENTIFIER" });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
});

router.get("/:productId/variants", requirePermission("products:read"), async (req: AuthenticatedRequest, res: Response) => {
  const result = await pool.query(
    `SELECT v.id, v.product_id AS "productId", v.title, v.sku, v.barcode,
            v.option_values AS "optionValues", v.price, v.cost, v.currency,
            v.low_stock_threshold AS "lowStockThreshold", v.is_default AS "isDefault", v.status,
            COALESCE(SUM(l.available), 0)::int AS available
     FROM product_variants v
     LEFT JOIN inventory_stock_levels l ON l.product_variant_id = v.id AND l.workspace_id = v.workspace_id
     WHERE v.workspace_id = $1 AND v.product_id = $2
     GROUP BY v.id ORDER BY v.is_default DESC, v.created_at ASC`,
    [req.sessionUser.activeWorkspaceId, req.params.productId],
  );
  res.json({ variants: result.rows });
});

router.post("/:productId/variants", requirePermission("products:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = variantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات المتغير غير صحيحة" });
    return;
  }
  const { activeWorkspaceId, userId } = req.sessionUser;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const product = await client.query(
      "SELECT id FROM inventory_products WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
      [req.params.productId, activeWorkspaceId],
    );
    if (!product.rowCount) throw new Error("PRODUCT_NOT_FOUND");
    const locationId = parsed.data.locationId ?? await ensureDefaultLocation(client, activeWorkspaceId);
    const location = await client.query(
      "SELECT id FROM stock_locations WHERE id = $1 AND workspace_id = $2 AND is_active = true",
      [locationId, activeWorkspaceId],
    );
    if (!location.rowCount) throw new Error("LOCATION_NOT_FOUND");
    const created = await client.query(
      `INSERT INTO product_variants
       (workspace_id, product_id, title, sku, barcode, option_values, price, cost, currency, low_stock_threshold)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [activeWorkspaceId, req.params.productId, parsed.data.title, parsed.data.sku ?? null,
        parsed.data.barcode ?? null, JSON.stringify(parsed.data.optionValues), parsed.data.price,
        parsed.data.cost ?? null, parsed.data.currency, parsed.data.lowStockThreshold],
    );
    const variant = created.rows[0];
    await client.query(
      `INSERT INTO inventory_stock_levels
       (workspace_id, product_variant_id, location_id, on_hand, reserved, incoming)
       VALUES ($1,$2,$3,$4,0,0)`,
      [activeWorkspaceId, variant.id, locationId, parsed.data.initialStock],
    );
    if (parsed.data.initialStock > 0) {
      await client.query(
        `INSERT INTO inventory_movements
         (workspace_id, product_variant_id, location_id, quantity, movement_type, reason,
          created_by, correlation_id, idempotency_key)
         VALUES ($1,$2,$3,$4,'Initial','رصيد افتتاحي للمتغير',$5,$6,$7)`,
        [activeWorkspaceId, variant.id, locationId, parsed.data.initialStock, userId,
          req.id || crypto.randomUUID(), `initial:${variant.id}:${locationId}`],
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ variant: { ...variant, locationId } });
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : "";
    if (message === "PRODUCT_NOT_FOUND" || message === "LOCATION_NOT_FOUND") {
      res.status(404).json({ error: message === "PRODUCT_NOT_FOUND" ? "المنتج غير موجود" : "موقع المخزون غير موجود" });
      return;
    }
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "SKU أو Barcode مستخدم مسبقًا", code: "DUPLICATE_IDENTIFIER" });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
});

router.patch("/variants/:variantId", requirePermission("products:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateVariantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات المتغير غير صحيحة" });
    return;
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  const mapping: Record<string, string> = {
    title: "title", sku: "sku", barcode: "barcode", optionValues: "option_values",
    price: "price", cost: "cost", currency: "currency", lowStockThreshold: "low_stock_threshold",
  };
  for (const [key, column] of Object.entries(mapping)) {
    const value = parsed.data[key as keyof typeof parsed.data];
    if (value !== undefined) {
      values.push(key === "optionValues" ? JSON.stringify(value) : value);
      fields.push(`${column} = $${values.length}`);
    }
  }
  if (!fields.length) {
    res.status(400).json({ error: "لا توجد تغييرات" });
    return;
  }
  values.push(req.params.variantId, req.sessionUser.activeWorkspaceId);
  try {
    const result = await pool.query(
      `UPDATE product_variants SET ${fields.join(", ")}, updated_at = now()
       WHERE id = $${values.length - 1} AND workspace_id = $${values.length}
       RETURNING *`,
      values,
    );
    if (!result.rowCount) {
      res.status(404).json({ error: "المتغير غير موجود" });
      return;
    }
    res.json({ variant: result.rows[0] });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "SKU أو Barcode مستخدم مسبقًا", code: "DUPLICATE_IDENTIFIER" });
      return;
    }
    throw error;
  }
});

export default router;
