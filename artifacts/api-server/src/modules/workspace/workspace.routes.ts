import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  workspacesTable,
  featureFlagsTable,
  subscriptionsTable,
  plansTable,
  paymentMethodsTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import type { AuthenticatedRequest } from "../../lib/types";
import { logger } from "../../lib/logger";

const router = Router();

router.use(requireSession);

router.get("/", requirePermission("settings:read"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const [workspace] = await db
      .select()
      .from(workspacesTable)
      .where(eq(workspacesTable.id, authReq.sessionUser.activeWorkspaceId))
      .limit(1);

    if (!workspace) {
      res.status(404).json({ error: "المنشأة غير موجودة" });
      return;
    }

    res.json({ workspace });
  } catch (err) {
    logger.error({ err }, "Failed to get workspace");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(2, "اسم المنشأة يجب أن يكون على الأقل حرفين").max(100).optional(),
});

router.patch("/", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const parsed = updateWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  try {
    const [existing] = await db.select()
      .from(workspacesTable)
      .where(eq(workspacesTable.id, authReq.sessionUser.activeWorkspaceId))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "المنشأة غير موجودة" }); return; }

    const updates: Record<string, unknown> = {};
    if (parsed.data.name) updates.name = parsed.data.name;

    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "لا توجد تغييرات للحفظ" });
      return;
    }

    const [workspace] = await db.update(workspacesTable)
      .set(updates)
      .where(eq(workspacesTable.id, authReq.sessionUser.activeWorkspaceId))
      .returning();

    await createAuditLog({
      ...auditFromRequest(req, authReq.sessionUser),
      action: "workspace_update",
      severity: "warning",
      entityType: "workspace",
      entityId: existing.id,
      entityLabel: existing.name,
      oldData: { name: existing.name },
      newData: updates,
    });

    res.json({ workspace });
  } catch (err) {
    logger.error({ err }, "Failed to update workspace");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

router.get("/flags", requirePermission("settings:read"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const flags = await db
      .select()
      .from(featureFlagsTable)
      .where(eq(featureFlagsTable.workspaceId, authReq.sessionUser.activeWorkspaceId));

    const flagMap: Record<string, boolean> = {};
    for (const flag of flags) {
      flagMap[flag.flagKey] = flag.isEnabled;
    }

    res.json({ flags: flagMap });
  } catch (err) {
    logger.error({ err }, "Failed to get feature flags");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

router.get("/payment-methods", requirePermission("payments:read"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const methods = await db.select()
      .from(paymentMethodsTable)
      .where(eq(paymentMethodsTable.workspaceId, authReq.sessionUser.activeWorkspaceId))
      .orderBy(paymentMethodsTable.sortOrder);

    res.json({ methods });
  } catch (err) {
    logger.error({ err }, "Failed to get payment methods");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

router.get("/usage", requirePermission("settings:read"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const [subscription] = await db
      .select({
        status: subscriptionsTable.status,
        trialEndsAt: subscriptionsTable.trialEndsAt,
        planName: plansTable.name,
        planSlug: plansTable.slug,
        limits: plansTable.limits,
        features: plansTable.features,
      })
      .from(subscriptionsTable)
      .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
      .where(eq(subscriptionsTable.workspaceId, authReq.sessionUser.activeWorkspaceId))
      .limit(1);

    res.json({ subscription: subscription ?? null });
  } catch (err) {
    logger.error({ err }, "Failed to get usage");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

export default router;
