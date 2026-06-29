import { createHash, randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  workspacesTable,
  featureFlagsTable,
  subscriptionsTable,
  plansTable,
  paymentMethodsTable,
  paymentSubmissionsTable,
  notificationPreferencesTable,
  notificationsTable,
  apiKeysTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import type { AuthenticatedRequest } from "../../lib/types";
import { logger } from "../../lib/logger";
import { getActiveSubscription, getDisplayPrice, getLimitWarnings, getPointsStatus, getUsageSnapshot, type BillingCurrency } from "../../services/billing";

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
  settings: z.object({
    sector_key: z.string().trim().min(2).max(80).optional(),
    sector_note: z.string().trim().max(1000).optional(),
    governorate: z.string().trim().max(80).optional(),
    district: z.string().trim().max(120).optional(),
    onboarding_completed: z.boolean().optional(),
  }).optional(),
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

const deactivateWorkspaceSchema = z.object({
  confirmationName: z.string().min(2).max(120),
  reason: z.string().max(500).optional().nullable(),
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
    if (parsed.data.settings) {
      const currentSettings = existing.settings && typeof existing.settings === "object" && !Array.isArray(existing.settings)
        ? existing.settings as Record<string, unknown>
        : {};
      updates.settings = { ...currentSettings, ...parsed.data.settings };
    }

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
    const workspaceId = authReq.sessionUser.activeWorkspaceId;
    const [subscription, usage, limitWarnings, points] = await Promise.all([
      getActiveSubscription(workspaceId),
      getUsageSnapshot(workspaceId),
      getLimitWarnings(workspaceId),
      getPointsStatus(workspaceId),
    ]);

    res.json({ subscription, usage, limitWarnings, points });
  } catch (err) {
    logger.error({ err }, "Failed to get usage");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

router.post("/deactivate", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const parsed = deactivateWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const [existing] = await db.select()
    .from(workspacesTable)
    .where(eq(workspacesTable.id, authReq.sessionUser.activeWorkspaceId))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "مساحة العمل غير موجودة" });
    return;
  }

  if (parsed.data.confirmationName.trim() !== existing.name) {
    res.status(400).json({ error: "اكتب اسم مساحة العمل كما هو لتأكيد التعطيل" });
    return;
  }

  const [workspace] = await db.update(workspacesTable)
    .set({
      status: "deactivated",
      deactivatedAt: new Date(),
      deactivatedBy: authReq.sessionUser.userId,
      deactivationReason: parsed.data.reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(workspacesTable.id, existing.id))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, authReq.sessionUser),
    action: "update",
    severity: "critical",
    entityType: "workspace",
    entityId: existing.id,
    entityLabel: existing.name,
    oldData: { status: existing.status },
    newData: { status: "deactivated", reason: parsed.data.reason ?? null },
  });

  res.json({ workspace });
});

router.get("/billing", requirePermission("billing:read"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const workspaceId = authReq.sessionUser.activeWorkspaceId;
  const currency = ["USD", "YER", "SAR"].includes(String(req.query.currency))
    ? String(req.query.currency) as BillingCurrency
    : "YER";
  try {
    const [subscription, usage, limitWarnings, points, plansRaw, paymentSubmissions] = await Promise.all([
      getActiveSubscription(workspaceId),
      getUsageSnapshot(workspaceId),
      getLimitWarnings(workspaceId),
      getPointsStatus(workspaceId),
      db.select().from(plansTable).where(eq(plansTable.isActive, true)).orderBy(plansTable.sortOrder),
      db
        .select({
          id: paymentSubmissionsTable.id,
          amountYer: paymentSubmissionsTable.amountYer,
          amountCurrency: paymentSubmissionsTable.amountCurrency,
          paymentMethod: paymentSubmissionsTable.paymentMethod,
          reference: paymentSubmissionsTable.reference,
          receiptNote: paymentSubmissionsTable.receiptNote,
          status: paymentSubmissionsTable.status,
          reviewedAt: paymentSubmissionsTable.reviewedAt,
          createdAt: paymentSubmissionsTable.createdAt,
          planName: plansTable.name,
          planNameAr: plansTable.nameAr,
        })
        .from(paymentSubmissionsTable)
        .innerJoin(plansTable, eq(paymentSubmissionsTable.planId, plansTable.id))
        .where(eq(paymentSubmissionsTable.workspaceId, workspaceId))
        .orderBy(desc(paymentSubmissionsTable.createdAt))
        .limit(20),
    ]);
    const plans = await Promise.all(plansRaw.map(async (plan) => ({
      ...plan,
      displayPriceMonthly: await getDisplayPrice(workspaceId, plan, currency, "monthly"),
      displayPriceAnnual: await getDisplayPrice(workspaceId, plan, currency, "annual"),
    })));

    res.json({
      subscription,
      usage,
      limitWarnings,
      points,
      currency,
      plans,
      paymentSubmissions,
      manualPayment: {
        kuraimi: process.env.BILLING_KURAIMI_ACCOUNT ?? "يتم تزويدك برقم الحساب عند التواصل مع المبيعات",
        jawali: process.env.BILLING_JAWALI_ACCOUNT ?? "يتم تزويدك برقم المحفظة عند التواصل مع المبيعات",
        bank: process.env.BILLING_BANK_ACCOUNT ?? "يتم تزويدك ببيانات التحويل البنكي عند التواصل مع المبيعات",
        cash: "يمكن تنسيق الدفع النقدي مع فريق وصال ون",
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to get billing data");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

const paymentSubmissionSchema = z.object({
  planId: z.string().uuid(),
  amountYer: z.coerce.number().positive(),
  amountCurrency: z.enum(["USD", "YER", "SAR"]).default("YER"),
  exchangeRateSnapshot: z.record(z.unknown()).optional().nullable(),
  paymentMethod: z.enum(["kuraimi", "jawali", "bank_transfer", "cash"]),
  reference: z.string().trim().max(120).optional().nullable(),
  receiptNote: z.string().trim().max(1000).optional().nullable(),
});

router.post("/billing/payment-submissions", requirePermission("billing:manage"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const parsed = paymentSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات طلب الدفع غير صالحة", details: parsed.error.flatten() });
    return;
  }

  const [plan] = await db.select({ id: plansTable.id }).from(plansTable).where(and(eq(plansTable.id, parsed.data.planId), eq(plansTable.isActive, true))).limit(1);
  if (!plan) {
    res.status(404).json({ error: "الباقة غير موجودة" });
    return;
  }

  const [submission] = await db.insert(paymentSubmissionsTable).values({
    workspaceId: authReq.sessionUser.activeWorkspaceId,
    planId: parsed.data.planId,
    amountYer: String(parsed.data.amountYer),
    amountCurrency: parsed.data.amountCurrency,
    exchangeRateSnapshot: parsed.data.exchangeRateSnapshot ?? null,
    paymentMethod: parsed.data.paymentMethod,
    reference: parsed.data.reference ?? null,
    receiptNote: parsed.data.receiptNote ?? null,
    status: "pending",
  }).returning();

  await createAuditLog({
    ...auditFromRequest(req, authReq.sessionUser),
    action: "create",
    severity: "info",
    entityType: "payment_submission",
    entityId: submission.id,
    newData: { planId: parsed.data.planId, amountYer: parsed.data.amountYer, paymentMethod: parsed.data.paymentMethod },
  });

  res.status(201).json({ submission });
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
        .where(and(
          eq(notificationPreferencesTable.id, existing.id),
          eq(notificationPreferencesTable.workspaceId, authReq.sessionUser.activeWorkspaceId),
          eq(notificationPreferencesTable.userId, authReq.sessionUser.userId)
        ))
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

router.get("/notifications", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const workspaceId = authReq.sessionUser.activeWorkspaceId;
  const userId = authReq.sessionUser.userId;

  const [notifications, unreadRows] = await Promise.all([
    db.select()
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.workspaceId, workspaceId),
        eq(notificationsTable.userId, userId),
      ))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(30),
    db.select({ count: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.workspaceId, workspaceId),
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.isRead, false),
      )),
  ]);

  res.json({ notifications, unreadCount: unreadRows[0]?.count ?? 0 });
});

router.post("/notifications/:id/read", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const [notification] = await db.update(notificationsTable)
    .set({ isRead: true })
    .where(and(
      eq(notificationsTable.id, req.params.id as string),
      eq(notificationsTable.workspaceId, authReq.sessionUser.activeWorkspaceId),
      eq(notificationsTable.userId, authReq.sessionUser.userId),
    ))
    .returning({ id: notificationsTable.id });

  if (!notification) {
    res.status(404).json({ error: "التنبيه غير موجود" });
    return;
  }

  res.json({ ok: true });
});

router.post("/notifications/read-all", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  await db.update(notificationsTable)
    .set({ isRead: true })
    .where(and(
      eq(notificationsTable.workspaceId, authReq.sessionUser.activeWorkspaceId),
      eq(notificationsTable.userId, authReq.sessionUser.userId),
      eq(notificationsTable.isRead, false),
    ));

  res.json({ ok: true });
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
