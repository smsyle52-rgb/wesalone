import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, asc, count } from "drizzle-orm";
import { db, paymentMethodsTable, paymentsTable } from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import type { AuthenticatedRequest } from "../../lib/types";
import { logger } from "../../lib/logger";

const router = Router();
router.use(requireSession);

const createSchema = z.object({
  slug: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/, "الـ slug يجب أن يحتوي على أحرف صغيرة وأرقام وشرطات سفلية فقط"),
  labelAr: z.string().min(1, "الاسم العربي مطلوب").max(100),
  labelEn: z.string().max(100).optional(),
  requiresReference: z.boolean().default(false),
  requiresReceipt: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
});

const updateSchema = createSchema.partial().omit({ slug: true }).extend({
  isActive: z.boolean().optional(),
});

router.get("/", requirePermission("payments:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const includeInactive = req.query.includeInactive === "true";

  const conditions = [eq(paymentMethodsTable.workspaceId, activeWorkspaceId)];
  if (!includeInactive) conditions.push(eq(paymentMethodsTable.isActive, true));

  const methods = await db.select().from(paymentMethodsTable)
    .where(and(...conditions))
    .orderBy(asc(paymentMethodsTable.sortOrder), asc(paymentMethodsTable.createdAt));

  res.json({ methods });
});

router.post("/", requirePermission("settings:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const { activeWorkspaceId } = req.sessionUser;

  try {
    const [existing] = await db.select({ id: paymentMethodsTable.id }).from(paymentMethodsTable)
      .where(and(eq(paymentMethodsTable.slug, parsed.data.slug), eq(paymentMethodsTable.workspaceId, activeWorkspaceId)))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "يوجد طريقة دفع بهذا الاسم المختصر بالفعل" }); return;
    }

    const [method] = await db.insert(paymentMethodsTable).values({
      workspaceId: activeWorkspaceId,
      slug: parsed.data.slug,
      labelAr: parsed.data.labelAr,
      labelEn: parsed.data.labelEn ?? null,
      requiresReference: parsed.data.requiresReference,
      requiresReceipt: parsed.data.requiresReceipt,
      sortOrder: parsed.data.sortOrder,
      config: {},
    }).returning();

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "payment_method_create", severity: "info", entityType: "payment_method",
      entityId: method.id, entityLabel: method.labelAr,
      newData: { slug: method.slug, labelAr: method.labelAr },
    });

    res.status(201).json({ method });
  } catch (err) {
    logger.error({ err }, "Failed to create payment method");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

router.patch("/:id", requirePermission("settings:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const { activeWorkspaceId } = req.sessionUser;

  const [existing] = await db.select().from(paymentMethodsTable)
    .where(and(eq(paymentMethodsTable.id, req.params.id as string), eq(paymentMethodsTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "طريقة الدفع غير موجودة" }); return; }

  const setData = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  ) as Partial<typeof parsed.data>;
  if (Object.keys(setData).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" }); return;
  }

  const [method] = await db.update(paymentMethodsTable).set(setData)
    .where(and(eq(paymentMethodsTable.id, req.params.id as string), eq(paymentMethodsTable.workspaceId, activeWorkspaceId)))
    .returning();

  const action = parsed.data.isActive === true && !existing.isActive
    ? "payment_method_activate"
    : "payment_method_update";

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action, severity: "info", entityType: "payment_method",
    entityId: method.id, entityLabel: method.labelAr, newData: parsed.data,
  });

  res.json({ method });
});

router.patch("/:id/deactivate", requirePermission("settings:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;

  const [existing] = await db.select({ id: paymentMethodsTable.id, labelAr: paymentMethodsTable.labelAr })
    .from(paymentMethodsTable)
    .where(and(eq(paymentMethodsTable.id, req.params.id as string), eq(paymentMethodsTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "طريقة الدفع غير موجودة" }); return; }

  const [{ usageCount }] = await db.select({ usageCount: count() }).from(paymentsTable)
    .where(eq(paymentsTable.paymentMethodId, existing.id));

  const [method] = await db.update(paymentMethodsTable).set({ isActive: false })
    .where(and(eq(paymentMethodsTable.id, req.params.id as string), eq(paymentMethodsTable.workspaceId, activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "payment_method_deactivate", severity: "warning", entityType: "payment_method",
    entityId: method.id, entityLabel: method.labelAr,
    oldData: { isActive: true }, newData: { isActive: false, paymentCount: Number(usageCount) },
  });

  res.json({ method, paymentCount: Number(usageCount) });
});

export default router;
