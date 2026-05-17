import { createHash, randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  workspacesTable,
  featureFlagsTable,
  subscriptionsTable,
  plansTable,
  paymentMethodsTable,
  notificationPreferencesTable,
  apiKeysTable,
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

const notificationPreferenceSchema = z.object({
  preferences: z.array(z.object({
    channel: z.enum(["email", "in_app"]),
    events: z.array(z.string().min(1).max(80)).max(50),
  })).max(4),
});

const apiKeySchema = z.object({
  label: z.string().min(2).max(120),
  scopes: z.array(z.string().min(1).max(80)).default(["read"]),
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

router.get("/notification-preferences", requirePermission("settings:read"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const preferences = await db.select()
    .from(notificationPreferencesTable)
    .where(and(
      eq(notificationPreferencesTable.workspaceId, authReq.sessionUser.activeWorkspaceId),
      eq(notificationPreferencesTable.userId, authReq.sessionUser.userId),
    ));
  res.json({ preferences });
});

router.put("/notification-preferences", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const parsed = notificationPreferenceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }); return; }

  const rows = [];
  for (const pref of parsed.data.preferences) {
    const [existing] = await db.select({ id: notificationPreferencesTable.id })
      .from(notificationPreferencesTable)
      .where(and(
        eq(notificationPreferencesTable.workspaceId, authReq.sessionUser.activeWorkspaceId),
        eq(notificationPreferencesTable.userId, authReq.sessionUser.userId),
        eq(notificationPreferencesTable.channel, pref.channel),
      ))
      .limit(1);

    if (existing) {
      const [row] = await db.update(notificationPreferencesTable)
        .set({ events: pref.events, updatedAt: new Date() })
        .where(eq(notificationPreferencesTable.id, existing.id))
        .returning();
      rows.push(row);
    } else {
      const [row] = await db.insert(notificationPreferencesTable).values({
        workspaceId: authReq.sessionUser.activeWorkspaceId,
        userId: authReq.sessionUser.userId,
        channel: pref.channel,
        events: pref.events,
      }).returning();
      rows.push(row);
    }
  }
  res.json({ preferences: rows });
});

router.get("/api-keys", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const apiKeys = await db.select({
    id: apiKeysTable.id,
    label: apiKeysTable.label,
    last4: apiKeysTable.last4,
    scopes: apiKeysTable.scopes,
    lastUsedAt: apiKeysTable.lastUsedAt,
    revokedAt: apiKeysTable.revokedAt,
    createdAt: apiKeysTable.createdAt,
  })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.workspaceId, authReq.sessionUser.activeWorkspaceId));
  res.json({ apiKeys });
});

router.post("/api-keys", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const parsed = apiKeySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }); return; }

  const rawKey = `kh_${randomBytes(24).toString("base64url")}`;
  const [row] = await db.insert(apiKeysTable).values({
    workspaceId: authReq.sessionUser.activeWorkspaceId,
    label: parsed.data.label,
    scopes: parsed.data.scopes,
    hashedKey: createHash("sha256").update(rawKey).digest("hex"),
    last4: rawKey.slice(-4),
  }).returning({
    id: apiKeysTable.id,
    label: apiKeysTable.label,
    last4: apiKeysTable.last4,
    scopes: apiKeysTable.scopes,
    createdAt: apiKeysTable.createdAt,
  });

  res.status(201).json({ apiKey: row, key: rawKey });
});

router.post("/api-keys/:id/revoke", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const [row] = await db.update(apiKeysTable)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(apiKeysTable.id, req.params.id as string),
      eq(apiKeysTable.workspaceId, authReq.sessionUser.activeWorkspaceId),
      isNull(apiKeysTable.revokedAt),
    ))
    .returning({ id: apiKeysTable.id });
  if (!row) { res.status(404).json({ error: "مفتاح API غير موجود" }); return; }
  res.json({ ok: true });
});

export default router;
