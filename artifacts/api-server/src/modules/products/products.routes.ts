import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, ilike, desc, asc } from "drizzle-orm";
import { db, inventoryProductsTable } from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import type { AuthenticatedRequest } from "../../lib/types";
import { parseManagerInventory } from "./manager-import";

const router = Router();
router.use(requireSession);

const DELIVERY_POLICIES = ["all", "local", "pickup_only"] as const;

const createSchema = z.object({
  name: z.string().min(1, "اسم المنتج مطلوب").max(200),
  description: z.string().max(1000).optional().nullable(),
  sku: z.string().max(100).optional().nullable(),
  price: z.number().min(0).default(0),
  currency: z.enum(["YER", "SAR", "USD"]).default("YER"),
  unit: z.string().max(50).optional().nullable(),
  imageUrl: z.string().url("رابط الصورة غير صحيح").max(2000).optional().nullable(),
  quantityAvailable: z.number().int().min(0).optional().nullable(),
  deliveryPolicy: z.enum(DELIVERY_POLICIES).default("all"),
});

const updateSchema = createSchema.partial();

const quantitySchema = z.object({
  adjustment: z.number().int().refine((n) => n !== 0, { message: "التعديل يجب أن يكون غير صفر" }),
});

// GET /api/products
router.get("/", requirePermission("products:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const search = typeof req.query.search === "string" ? req.query.search : "";
  const includeArchived = req.query.archived === "true";

  const rows = await db.select()
    .from(inventoryProductsTable)
    .where(and(
      eq(inventoryProductsTable.workspaceId, activeWorkspaceId),
      includeArchived ? undefined : eq(inventoryProductsTable.isArchived, false),
      search ? ilike(inventoryProductsTable.name, `%${search}%`) : undefined,
    ))
    .orderBy(asc(inventoryProductsTable.name));

  res.json({ products: rows });
});

// POST /api/products
router.post("/", requirePermission("products:create"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const { activeWorkspaceId } = req.sessionUser;
  const data = parsed.data;

  const [product] = await db.insert(inventoryProductsTable).values({
    workspaceId: activeWorkspaceId,
    name: data.name,
    description: data.description ?? null,
    sku: data.sku ?? null,
    price: String(data.price),
    currency: data.currency,
    unit: data.unit ?? null,
    imageUrl: data.imageUrl ?? null,
    quantityAvailable: data.quantityAvailable ?? null,
    deliveryPolicy: data.deliveryPolicy,
  }).returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    workspaceId: activeWorkspaceId,
    action: "products_create",
    entityType: "product",
    entityId: product.id,
    entityLabel: data.name,
    newData: data,
  });

  res.status(201).json({ product });
});

// POST /api/products/import — استيراد مخزون من Manager (نصّ مُلصَق CSV/TSV) → upsert منتجات وصال.
// المطابقة للتحديث: بالكود (sku) إن وُجد وإلّا بالاسم — فإعادة الاستيراد تُحدّث لا تُكرّر.
const importSchema = z.object({
  text: z.string().min(1, "الصق بيانات المخزون من Manager"),
  currency: z.enum(["YER", "SAR", "USD"]).default("YER"),
});

router.post("/import", requirePermission("products:create"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }
  const { activeWorkspaceId } = req.sessionUser;
  const { text, currency } = parsed.data;

  const result = parseManagerInventory(text);
  if (!result.headerFound) {
    res.status(400).json({ error: "لم أتعرّف على عمود اسم المنتج — تأكّد أنك نسخت صفّ العناوين من Manager أيضاً (Item Name / الاسم)." });
    return;
  }
  if (result.rows.length === 0) {
    res.status(400).json({ error: "لم أجد صفوف منتجات صالحة في المُلصَق." });
    return;
  }
  if (result.rows.length > 2000) {
    res.status(400).json({ error: "الحدّ الأقصى 2000 منتج في الاستيراد الواحد — قسّمه على دفعات." });
    return;
  }

  let created = 0;
  let updated = 0;
  const errors: Array<{ row: number; reason: string }> = [];

  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];
    try {
      const [existing] = await db.select({ id: inventoryProductsTable.id })
        .from(inventoryProductsTable)
        .where(and(
          eq(inventoryProductsTable.workspaceId, activeWorkspaceId),
          row.sku ? eq(inventoryProductsTable.sku, row.sku) : eq(inventoryProductsTable.name, row.name),
        ))
        .limit(1);

      if (existing) {
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (row.sku) updates.name = row.name; // مطابقة بالكود → حدّث الاسم أيضاً إن تغيّر في Manager
        if (row.price !== null) updates.price = String(row.price);
        if (row.cost !== null) updates.cost = String(row.cost);
        if (row.quantityAvailable !== null) updates.quantityAvailable = row.quantityAvailable;
        if (row.unit) updates.unit = row.unit;
        await db.update(inventoryProductsTable)
          .set(updates)
          .where(and(eq(inventoryProductsTable.id, existing.id), eq(inventoryProductsTable.workspaceId, activeWorkspaceId)));
        updated += 1;
      } else {
        await db.insert(inventoryProductsTable).values({
          workspaceId: activeWorkspaceId,
          name: row.name,
          sku: row.sku,
          price: row.price !== null ? String(row.price) : "0",
          cost: row.cost !== null ? String(row.cost) : null,
          currency,
          unit: row.unit,
          quantityAvailable: row.quantityAvailable,
        });
        created += 1;
      }
    } catch {
      errors.push({ row: i + 2, reason: "تعذّر حفظ هذا الصف" }); // +2 = صفّ العنوان + الفهرسة من 1
    }
  }

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    workspaceId: activeWorkspaceId,
    action: "products_import_manager",
    entityType: "product",
    entityId: activeWorkspaceId,
    entityLabel: `Manager import +${created} ~${updated}`,
    newData: { created, updated, skipped: result.skipped, mappedColumns: result.mappedColumns },
  });

  res.json({ ok: true, created, updated, skipped: result.skipped, total: result.rows.length, errors, mappedColumns: result.mappedColumns });
});

// GET /api/products/:id
router.get("/:id", requirePermission("products:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const [product] = await db.select()
    .from(inventoryProductsTable)
    .where(and(
      eq(inventoryProductsTable.id, req.params.id as string),
      eq(inventoryProductsTable.workspaceId, activeWorkspaceId),
    ))
    .limit(1);

  if (!product) { res.status(404).json({ error: "المنتج غير موجود" }); return; }
  res.json({ product });
});

// PATCH /api/products/:id
router.patch("/:id", requirePermission("products:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const { activeWorkspaceId } = req.sessionUser;
  const [existing] = await db.select({ id: inventoryProductsTable.id, name: inventoryProductsTable.name })
    .from(inventoryProductsTable)
    .where(and(eq(inventoryProductsTable.id, req.params.id as string), eq(inventoryProductsTable.workspaceId, activeWorkspaceId)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "المنتج غير موجود" }); return; }

  const data = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.sku !== undefined) updates.sku = data.sku;
  if (data.price !== undefined) updates.price = String(data.price);
  if (data.currency !== undefined) updates.currency = data.currency;
  if (data.unit !== undefined) updates.unit = data.unit;
  if (data.imageUrl !== undefined) updates.imageUrl = data.imageUrl;
  if (data.quantityAvailable !== undefined) updates.quantityAvailable = data.quantityAvailable;
  if (data.deliveryPolicy !== undefined) updates.deliveryPolicy = data.deliveryPolicy;

  const [product] = await db.update(inventoryProductsTable)
    .set(updates)
    .where(and(eq(inventoryProductsTable.id, existing.id), eq(inventoryProductsTable.workspaceId, activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    workspaceId: activeWorkspaceId,
    action: "products_update",
    entityType: "product",
    entityId: existing.id,
    entityLabel: existing.name,
    newData: data,
  });

  res.json({ product });
});

// PATCH /api/products/:id/quantity â€” طھط¹ط¯ظٹظ„ ط§ظ„ظƒظ…ظٹط© ط§ظ„ظ…طھط§ط­ط© (+/-)
router.patch("/:id/quantity", requirePermission("products:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = quantitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const { activeWorkspaceId } = req.sessionUser;
  const [existing] = await db.select()
    .from(inventoryProductsTable)
    .where(and(eq(inventoryProductsTable.id, req.params.id as string), eq(inventoryProductsTable.workspaceId, activeWorkspaceId)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "المنتج غير موجود" }); return; }
  if (existing.quantityAvailable === null) {
    res.status(400).json({ error: "المنتج غير محدود الكمية — عيّن كمية أولاً قبل التعديل" });
    return;
  }

  const newQty = Math.max(0, existing.quantityAvailable + parsed.data.adjustment);
  const [product] = await db.update(inventoryProductsTable)
    .set({ quantityAvailable: newQty, updatedAt: new Date() })
    .where(and(eq(inventoryProductsTable.id, existing.id), eq(inventoryProductsTable.workspaceId, activeWorkspaceId)))
    .returning();

  res.json({ product });
});

// DELETE /api/products/:id â€” ط£ط±ط´ظپط© (soft delete)
router.delete("/:id", requirePermission("products:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const [existing] = await db.select({ id: inventoryProductsTable.id, name: inventoryProductsTable.name })
    .from(inventoryProductsTable)
    .where(and(eq(inventoryProductsTable.id, req.params.id as string), eq(inventoryProductsTable.workspaceId, activeWorkspaceId)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "المنتج غير موجود" }); return; }

  await db.update(inventoryProductsTable)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(and(eq(inventoryProductsTable.id, existing.id), eq(inventoryProductsTable.workspaceId, activeWorkspaceId)));

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    workspaceId: activeWorkspaceId,
    action: "products_delete",
    entityType: "product",
    entityId: existing.id,
    entityLabel: existing.name,
    newData: { archived: true },
  });

  res.json({ success: true });
});

export default router;
