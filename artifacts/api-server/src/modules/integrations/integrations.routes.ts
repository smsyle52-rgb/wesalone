import { Router, type Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { channelAccountsTable, db } from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import type { AuthenticatedRequest } from "../../lib/types";
import { auditFromRequest, createAuditLog } from "../../lib/audit";
import {
  createProviderAccount,
  disableProviderAccount,
  getProviderAccount,
  getWebhookEvent,
  listDeadLetterCount,
  listProviderAccounts,
  listWebhookEvents,
  replayWebhookEventMock,
  updateProviderAccount,
} from "./integrationLedger.service";
import {
  cancelOutboxMessage,
  getOutboxMessage,
  listOutboxMessages,
  retryOutboxMessage,
} from "./outbox.service";
import { listIntegrationHealth } from "./integrationHealth.service";
import {
  integrationProviders,
  providerAccountStatuses,
} from "./integrationTypes";

const router = Router();
router.use(requireSession);

const metadataSchema = z.record(z.unknown()).optional();

const providerAccountCreateSchema = z.object({
  provider: z.enum(integrationProviders),
  displayName: z.string().trim().min(1).max(160),
  status: z.enum(providerAccountStatuses).optional(),
  externalAccountId: z.string().trim().max(200).optional().nullable(),
  externalBusinessId: z.string().trim().max(200).optional().nullable(),
  externalPhoneId: z.string().trim().max(200).optional().nullable(),
  metadata: metadataSchema,
});

const providerAccountUpdateSchema = providerAccountCreateSchema.partial().omit({ provider: true });

function limitFromQuery(value: unknown, fallback = 50) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(100, Math.floor(parsed));
}

function appBaseUrl(req: AuthenticatedRequest) {
  const proto = req.header("x-forwarded-proto") ?? req.protocol;
  const host = req.header("x-forwarded-host") ?? req.header("host");
  return `${proto}://${host}`;
}

function metaRedirectUri(req: AuthenticatedRequest) {
  return process.env.META_REDIRECT_URI ?? `${appBaseUrl(req)}/api/integrations/meta/embedded-signup/callback`;
}

router.get("/provider-accounts", requirePermission("integrations:read"), async (req: AuthenticatedRequest, res: Response) => {
  const accounts = await listProviderAccounts(req.sessionUser.activeWorkspaceId);
  const deadLetterCount = await listDeadLetterCount(req.sessionUser.activeWorkspaceId);
  res.json({ accounts, deadLetterCount });
});

router.post("/provider-accounts", requirePermission("integrations:create"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = providerAccountCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات حساب المزود غير صالحة", details: parsed.error.flatten() });
    return;
  }

  const account = await createProviderAccount({
    ...parsed.data,
    workspaceId: req.sessionUser.activeWorkspaceId,
    createdBy: req.sessionUser.userId,
    metadata: parsed.data.metadata ?? {},
  });

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "provider_account_create",
    entityType: "provider_account",
    entityId: account.id,
    entityLabel: account.displayName,
    newData: { provider: account.provider, status: account.status },
  });

  res.status(201).json({ account });
});

router.patch("/provider-accounts/:id", requirePermission("integrations:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = providerAccountUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات حساب المزود غير صالحة", details: parsed.error.flatten() });
    return;
  }

  const existing = await getProviderAccount(req.sessionUser.activeWorkspaceId, String(req.params.id));
  if (!existing) {
    res.status(404).json({ error: "حساب المزود غير موجود" });
    return;
  }

  const account = await updateProviderAccount({
    ...parsed.data,
    workspaceId: req.sessionUser.activeWorkspaceId,
    id: existing.id,
  });

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "provider_account_update",
    entityType: "provider_account",
    entityId: existing.id,
    entityLabel: account?.displayName ?? existing.displayName,
    oldData: { status: existing.status, displayName: existing.displayName },
    newData: parsed.data,
  });

  res.json({ account });
});

router.post("/provider-accounts/:id/disable", requirePermission("integrations:disable"), async (req: AuthenticatedRequest, res: Response) => {
  const existing = await getProviderAccount(req.sessionUser.activeWorkspaceId, String(req.params.id));
  if (!existing) {
    res.status(404).json({ error: "حساب المزود غير موجود" });
    return;
  }

  const account = await disableProviderAccount(req.sessionUser.activeWorkspaceId, existing.id);

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "provider_account_disable",
    entityType: "provider_account",
    entityId: existing.id,
    entityLabel: existing.displayName,
    oldData: { status: existing.status },
    newData: { status: "disabled" },
  });

  res.json({ account });
});

router.get("/webhook-events", requirePermission("integrations:view_events"), async (req: AuthenticatedRequest, res: Response) => {
  const events = await listWebhookEvents(req.sessionUser.activeWorkspaceId, limitFromQuery(req.query.limit));
  res.json({ events });
});

router.get("/webhook-events/:id", requirePermission("integrations:view_events"), async (req: AuthenticatedRequest, res: Response) => {
  const event = await getWebhookEvent(req.sessionUser.activeWorkspaceId, String(req.params.id));
  if (!event) {
    res.status(404).json({ error: "حدث الويبهوك غير موجود" });
    return;
  }
  res.json({ event });
});

router.post("/webhook-events/:id/replay", requirePermission("integrations:replay"), async (req: AuthenticatedRequest, res: Response) => {
  const event = await replayWebhookEventMock(req.sessionUser.activeWorkspaceId, String(req.params.id));
  if (!event) {
    res.status(404).json({ error: "حدث الويبهوك غير موجود" });
    return;
  }

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "webhook_event_replay",
    entityType: "webhook_event",
    entityId: event.id,
    entityLabel: event.eventType,
    newData: { status: event.status, safeReplay: true },
  });

  res.json({ event, message: "تمت إعادة المعالجة بشكل آمن بدون أي اتصال خارجي" });
});

router.get("/outbox", requirePermission("integrations:read"), async (req: AuthenticatedRequest, res: Response) => {
  const messages = await listOutboxMessages(req.sessionUser.activeWorkspaceId, limitFromQuery(req.query.limit));
  res.json({ messages });
});

router.get("/outbox/:id", requirePermission("integrations:read"), async (req: AuthenticatedRequest, res: Response) => {
  const message = await getOutboxMessage(req.sessionUser.activeWorkspaceId, String(req.params.id));
  if (!message) {
    res.status(404).json({ error: "رسالة outbox غير موجودة" });
    return;
  }
  res.json({ message });
});

router.post("/outbox/:id/cancel", requirePermission("integrations:manage_outbox"), async (req: AuthenticatedRequest, res: Response) => {
  const message = await cancelOutboxMessage(req.sessionUser.activeWorkspaceId, String(req.params.id));
  if (!message) {
    res.status(409).json({ error: "لا يمكن إلغاء هذه الرسالة أو أنها غير موجودة" });
    return;
  }

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "outbox_cancel",
    entityType: "outbox_message",
    entityId: message.id,
    entityLabel: message.destination,
    newData: { status: message.status },
  });

  res.json({ message });
});

router.post("/outbox/:id/retry", requirePermission("integrations:manage_outbox"), async (req: AuthenticatedRequest, res: Response) => {
  const message = await retryOutboxMessage(req.sessionUser.activeWorkspaceId, String(req.params.id));
  if (!message) {
    res.status(409).json({ error: "إعادة المحاولة متاحة فقط للرسائل الفاشلة" });
    return;
  }

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "outbox_retry",
    entityType: "outbox_message",
    entityId: message.id,
    entityLabel: message.destination,
    newData: { status: message.status, retryCount: message.retryCount },
  });

  res.json({ message });
});

router.get("/health", requirePermission("integrations:read"), async (req: AuthenticatedRequest, res: Response) => {
  const health = await listIntegrationHealth(req.sessionUser.activeWorkspaceId);
  res.json(health);
});

router.get("/meta/embedded-signup/start", requirePermission("integrations:update"), async (req: AuthenticatedRequest, res: Response) => {
  const appId = process.env.META_APP_ID;
  const state = randomBytes(24).toString("hex");
  (req.session as any).metaOAuthState = {
    state,
    workspaceId: req.sessionUser.activeWorkspaceId,
    createdAt: Date.now(),
  };

  if (!appId) {
    res.status(409).json({ ready: false, missing: ["META_APP_ID"], mode: "config_missing" });
    return;
  }

  const redirectUri = metaRedirectUri(req);
  const scopes = ["whatsapp_business_messaging", "whatsapp_business_management", "business_management"];
  const url = new URL(`https://www.facebook.com/${process.env.META_GRAPH_VERSION ?? "v21.0"}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("response_type", "code");

  res.json({ url: url.toString(), state, redirectUri, scopes });
});

router.get("/meta/embedded-signup/callback", requirePermission("integrations:update"), async (req: AuthenticatedRequest, res: Response) => {
  const state = String(req.query.state ?? "");
  const stored = (req.session as any).metaOAuthState;
  if (!stored || stored.state !== state || stored.workspaceId !== req.sessionUser.activeWorkspaceId || Date.now() - stored.createdAt > 15 * 60_000) {
    res.status(403).json({ connected: false, error: "invalid_state" });
    return;
  }

  const wabaId = String(req.query.waba_id ?? process.env.META_WABA_ID ?? "");
  const phoneNumberId = String(req.query.phone_number_id ?? process.env.META_PHONE_NUMBER_ID ?? "");
  const displayPhoneNumber = String(req.query.display_phone_number ?? "");
  const credentialsSecretRef = process.env.META_ACCESS_TOKEN_SECRET_REF ?? null;

  if (!phoneNumberId || !wabaId || !credentialsSecretRef) {
    res.status(202).json({
      connected: false,
      status: "action_required",
      message: "Meta callback received, but WABA/phone or Secret Manager token reference is missing.",
      missing: [
        ...(!wabaId ? ["META_WABA_ID or callback waba_id"] : []),
        ...(!phoneNumberId ? ["META_PHONE_NUMBER_ID or callback phone_number_id"] : []),
        ...(!credentialsSecretRef ? ["META_ACCESS_TOKEN_SECRET_REF"] : []),
      ],
    });
    return;
  }

  const [existing] = await db
    .select()
    .from(channelAccountsTable)
    .where(and(
      eq(channelAccountsTable.workspaceId, req.sessionUser.activeWorkspaceId),
      eq(channelAccountsTable.channelType, "whatsapp"),
    ))
    .limit(1);

  const values = {
    workspaceId: req.sessionUser.activeWorkspaceId,
    channelType: "whatsapp",
    name: "whatsapp",
    displayName: displayPhoneNumber ? `WhatsApp ${displayPhoneNumber}` : "WhatsApp",
    status: "active",
    providerConfig: {
      provider: "meta",
      wabaId,
      phoneNumberId,
      displayPhoneNumber,
      embeddedSignup: true,
      connectedAt: new Date().toISOString(),
    },
    credentialsSecretRef,
    createdBy: req.sessionUser.userId,
    updatedAt: new Date(),
  };

  const [account] = existing
    ? await db.update(channelAccountsTable)
        .set(values)
        .where(eq(channelAccountsTable.id, existing.id))
        .returning()
    : await db.insert(channelAccountsTable).values(values).returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "meta_whatsapp_connected",
    entityType: "channel_account",
    entityId: account.id,
    entityLabel: account.displayName,
    newData: { provider: "meta", phoneNumberId, wabaId, credentialsSecretRef },
  });

  res.json({ connected: true, accountId: account.id, status: account.status });
});

export default router;
