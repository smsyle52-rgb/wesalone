import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db, channelAccountsTable } from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import type { AuthenticatedRequest } from "../../lib/types";
import { logger } from "../../lib/logger";
import { checkLimit } from "../../services/billing";

const router = Router();
router.use(requireSession);

const CHANNEL_CATALOG = [
  { type: "whatsapp_manual", label: "واتساب يدوي", globalStatus: "active", description: "إرسال رسائل يدوياً عبر واتساب" },
  { type: "website_widget", label: "ويدجت الموقع", globalStatus: "active", description: "دردشة مباشرة من موقعك الإلكتروني" },
  { type: "whatsapp_api", label: "واتساب API", globalStatus: "pending_meta_review", description: "تكامل مباشر مع واتساب — قيد مراجعة Meta", disabledReason: "هذه الخدمة قيد مراجعة Meta وستتوفر قريباً" },
  { type: "telegram", label: "تيليغرام", globalStatus: "coming_soon", description: "سيتم إضافته قريباً", disabledReason: "سيتم تفعيل تيليغرام في إصدار قادم" },
  { type: "instagram", label: "إنستغرام", globalStatus: "coming_soon", description: "سيتم إضافته قريباً", disabledReason: "سيتم تفعيل إنستغرام في إصدار قادم" },
  { type: "messenger", label: "ماسنجر", globalStatus: "coming_soon", description: "سيتم إضافته قريباً", disabledReason: "سيتم تفعيل ماسنجر في إصدار قادم" },
  { type: "voice", label: "صوتي", globalStatus: "coming_soon", description: "سيتم إضافته قريباً", disabledReason: "سيتم تفعيل القناة الصوتية في إصدار قادم" },
];

const createAccountSchema = z.object({
  channelType: z.enum(["whatsapp_manual", "website_widget", "whatsapp_api", "telegram", "instagram", "messenger", "voice"]),
  name: z.string().min(1, "الاسم مطلوب").max(120),
  displayName: z.string().min(1, "الاسم المعروض مطلوب").max(120),
  status: z.enum(["active", "pending_meta_review", "disabled", "coming_soon"]).optional(),
  providerConfig: z.record(z.unknown()).optional(),
});

const updateAccountSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  displayName: z.string().min(1).max(120).optional(),
  status: z.enum(["active", "pending_meta_review", "disabled", "coming_soon"]).optional(),
  providerConfig: z.record(z.unknown()).optional(),
});

router.get("/catalog", requirePermission("channels:read"), (_req, res: Response) => {
  res.json({ catalog: CHANNEL_CATALOG });
});

router.get("/accounts", requirePermission("channels:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const accounts = await db
    .select()
    .from(channelAccountsTable)
    .where(eq(channelAccountsTable.workspaceId, activeWorkspaceId));

  const catalogWithAccounts = CHANNEL_CATALOG.map((cat) => ({
    ...cat,
    accounts: accounts.filter((a) => a.channelType === cat.type),
  }));

  res.json({ accounts, catalog: catalogWithAccounts });
});

router.post("/accounts", requirePermission("channels:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const { activeWorkspaceId, userId } = req.sessionUser;
  const { channelType, name, displayName, providerConfig } = parsed.data;

  const catalogEntry = CHANNEL_CATALOG.find((c) => c.type === channelType);
  const status = parsed.data.status ?? (catalogEntry?.globalStatus as string) ?? "active";

  try {
    const channelLimit = await checkLimit(activeWorkspaceId, "channels");
    if (!channelLimit.allowed) {
      res.status(402).json({
        error: "وصلت حد باقتك لعدد القنوات. يمكنك ترقية الباقة لربط قنوات إضافية.",
        code: "plan_limit_reached",
        limit: channelLimit,
      });
      return;
    }

    const [account] = await db.insert(channelAccountsTable).values({
      workspaceId: activeWorkspaceId,
      channelType,
      name,
      displayName,
      status,
      providerConfig: providerConfig ?? null,
      createdBy: userId,
    }).returning();

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "create",
      severity: "info",
      entityType: "channel_account",
      entityId: account.id,
      entityLabel: `${channelType}: ${name}`,
      newData: { channelType, name, status },
    });

    res.status(201).json({ account });
  } catch (err) {
    logger.error({ err }, "Failed to create channel account");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

router.get("/accounts/:id", requirePermission("channels:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const [account] = await db
    .select()
    .from(channelAccountsTable)
    .where(and(
      eq(channelAccountsTable.id, req.params.id as string),
      eq(channelAccountsTable.workspaceId, activeWorkspaceId)
    ))
    .limit(1);

  if (!account) { res.status(404).json({ error: "حساب القناة غير موجود" }); return; }
  res.json({ account });
});

router.patch("/accounts/:id", requirePermission("channels:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const { activeWorkspaceId } = req.sessionUser;
  const [existing] = await db
    .select()
    .from(channelAccountsTable)
    .where(and(
      eq(channelAccountsTable.id, req.params.id as string),
      eq(channelAccountsTable.workspaceId, activeWorkspaceId)
    ))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "حساب القناة غير موجود" }); return; }

  const updates: Partial<typeof existing> = {
    updatedAt: new Date(),
    ...(parsed.data.name !== undefined && { name: parsed.data.name }),
    ...(parsed.data.displayName !== undefined && { displayName: parsed.data.displayName }),
    ...(parsed.data.status !== undefined && { status: parsed.data.status }),
    ...(parsed.data.providerConfig !== undefined && { providerConfig: parsed.data.providerConfig }),
  };

  const [account] = await db
    .update(channelAccountsTable)
    .set(updates)
    .where(eq(channelAccountsTable.id, existing.id))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update",
    severity: "info",
    entityType: "channel_account",
    entityId: account.id,
    entityLabel: account.name,
    newData: parsed.data,
  });

  res.json({ account });
});

export default router;
