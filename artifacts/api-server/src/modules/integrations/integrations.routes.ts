import { Router, type Response } from "express";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { catalogSourcesTable, channelAccountsTable, db } from "@workspace/db";
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
import { checkLimit } from "../../services/billing";

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

type MetaPhoneNumber = {
  phone_number_id: string;
  display_number: string;
  verified_name?: string;
};

type MetaChannelOptions = {
  whatsapp_accounts: Array<{
    waba_id: string;
    name: string;
    phone_numbers: MetaPhoneNumber[];
  }>;
  facebook_pages: Array<{
    page_id: string;
    name: string;
  }>;
  instagram_accounts: Array<{
    ig_account_id: string;
    username: string;
    linked_page_id: string;
  }>;
  commerce_catalogs: Array<{
    catalog_id: string;
    name: string;
    business_id?: string;
  }>;
  ad_accounts: Array<{
    ad_account_id: string;
    name: string;
    business_id?: string;
  }>;
};

type MetaTokenRefs = {
  userTokenRef?: string;
  pageTokenRefs: Record<string, string>;
};

function graphVersion() {
  return process.env.META_GRAPH_VERSION ?? "v21.0";
}

function metaEncryptionKey(): Buffer {
  const material = process.env.META_OAUTH_STATE_SECRET ?? process.env.SESSION_SECRET ?? "khadamatak-dev-meta-token-key";
  return createHash("sha256").update(material).digest();
}

function encryptedTokenRef(token: string | null | undefined): string | null {
  if (!token) return process.env.META_ACCESS_TOKEN_SECRET_REF ?? null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", metaEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function sanitizeMetaOptions(options: MetaChannelOptions): MetaChannelOptions {
  return {
    whatsapp_accounts: options.whatsapp_accounts,
    facebook_pages: options.facebook_pages.map((page) => ({ page_id: page.page_id, name: page.name })),
    instagram_accounts: options.instagram_accounts,
    commerce_catalogs: options.commerce_catalogs,
    ad_accounts: options.ad_accounts,
  };
}

async function callMetaGraph(path: string, token: string): Promise<any> {
  const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${path.replace(/^\//, "")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Meta Graph API returned ${response.status}`);
  return response.json();
}

async function exchangeCodeForToken(req: AuthenticatedRequest, code: string): Promise<string | null> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret || !code) return null;

  const url = new URL(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", metaRedirectUri(req));
  url.searchParams.set("code", code);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Meta OAuth exchange returned ${response.status}`);
  const payload: any = await response.json();
  return typeof payload.access_token === "string" ? payload.access_token : null;
}

function fallbackMetaOptions(): { options: MetaChannelOptions; tokenRefs: MetaTokenRefs } {
  const wabaId = process.env.META_WABA_ID ?? "";
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID ?? "";
  const facebookPageId = process.env.META_FACEBOOK_PAGE_ID ?? "";
  const instagramBusinessId = process.env.META_INSTAGRAM_BUSINESS_ID ?? "";
  const catalogId = process.env.META_CATALOG_ID ?? "";
  const adAccountId = process.env.META_AD_ACCOUNT_ID ?? "";

  return {
    options: {
      whatsapp_accounts: wabaId && phoneNumberId ? [{
        waba_id: wabaId,
        name: "WhatsApp Business",
        phone_numbers: [{
          phone_number_id: phoneNumberId,
          display_number: process.env.META_DISPLAY_PHONE_NUMBER ?? "",
          verified_name: process.env.META_VERIFIED_NAME,
        }],
      }] : [],
      facebook_pages: facebookPageId ? [{ page_id: facebookPageId, name: "Facebook Page" }] : [],
      instagram_accounts: instagramBusinessId ? [{
        ig_account_id: instagramBusinessId,
        username: process.env.META_INSTAGRAM_USERNAME ?? "instagram",
        linked_page_id: facebookPageId,
      }] : [],
      commerce_catalogs: catalogId ? [{ catalog_id: catalogId, name: "Meta Catalog" }] : [],
      ad_accounts: adAccountId ? [{ ad_account_id: adAccountId, name: "Meta Ad Account" }] : [],
    },
    tokenRefs: {
      userTokenRef: process.env.META_ACCESS_TOKEN_SECRET_REF ?? undefined,
      pageTokenRefs: facebookPageId && process.env.META_PAGE_ACCESS_TOKEN_SECRET_REF
        ? { [facebookPageId]: process.env.META_PAGE_ACCESS_TOKEN_SECRET_REF }
        : {},
    },
  };
}

async function fetchMetaChannelOptions(userToken: string): Promise<{ options: MetaChannelOptions; tokenRefs: MetaTokenRefs }> {
  const [businesses, pages] = await Promise.all([
    callMetaGraph("me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}},owned_product_catalogs{id,name},owned_ad_accounts{id,name,account_id}", userToken),
    callMetaGraph("me/accounts?fields=id,name,access_token,instagram_business_account{id,username}", userToken),
  ]);

  const whatsappAccounts: MetaChannelOptions["whatsapp_accounts"] = [];
  const commerceCatalogs: MetaChannelOptions["commerce_catalogs"] = [];
  const adAccounts: MetaChannelOptions["ad_accounts"] = [];
  for (const business of businesses?.data ?? []) {
    const businessId = String(business.id ?? "");
    for (const waba of business?.owned_whatsapp_business_accounts?.data ?? []) {
      whatsappAccounts.push({
        waba_id: String(waba.id),
        name: String(waba.name ?? business.name ?? "WhatsApp Business"),
        phone_numbers: (waba.phone_numbers?.data ?? []).map((phone: any) => ({
          phone_number_id: String(phone.id),
          display_number: String(phone.display_phone_number ?? ""),
          verified_name: phone.verified_name ? String(phone.verified_name) : undefined,
        })),
      });
    }
    for (const catalog of business?.owned_product_catalogs?.data ?? []) {
      commerceCatalogs.push({
        catalog_id: String(catalog.id),
        name: String(catalog.name ?? "Meta Catalog"),
        business_id: businessId,
      });
    }
    for (const account of business?.owned_ad_accounts?.data ?? []) {
      adAccounts.push({
        ad_account_id: String(account.id ?? account.account_id),
        name: String(account.name ?? "Meta Ad Account"),
        business_id: businessId,
      });
    }
  }

  const facebookPages: MetaChannelOptions["facebook_pages"] = [];
  const instagramAccounts: MetaChannelOptions["instagram_accounts"] = [];
  const pageTokenRefs: Record<string, string> = {};

  for (const page of pages?.data ?? []) {
    const pageId = String(page.id);
    facebookPages.push({ page_id: pageId, name: String(page.name ?? "Facebook Page") });
    const ref = encryptedTokenRef(typeof page.access_token === "string" ? page.access_token : null);
    if (ref) pageTokenRefs[pageId] = ref;
    if (page.instagram_business_account?.id) {
      instagramAccounts.push({
        ig_account_id: String(page.instagram_business_account.id),
        username: String(page.instagram_business_account.username ?? page.instagram_business_account.id),
        linked_page_id: pageId,
      });
    }
  }

  return {
    options: {
      whatsapp_accounts: whatsappAccounts,
      facebook_pages: facebookPages,
      instagram_accounts: instagramAccounts,
      commerce_catalogs: commerceCatalogs,
      ad_accounts: adAccounts,
    },
    tokenRefs: {
      userTokenRef: encryptedTokenRef(userToken) ?? undefined,
      pageTokenRefs,
    },
  };
}

const metaChannelSelectionSchema = z.object({
  whatsapp_phone_ids: z.array(z.string()).default([]),
  instagram_account_ids: z.array(z.string()).default([]),
  page_ids: z.array(z.string()).default([]),
  catalog_ids: z.array(z.string()).default([]),
  ad_account_ids: z.array(z.string()).default([]),
  waba_id: z.string().optional(),
  access_token: z.string().optional(),
});

function currentMetaSession(req: AuthenticatedRequest): { options: MetaChannelOptions; tokenRefs: MetaTokenRefs } {
  const stored = (req.session as any).metaChannelOptions;
  if (stored?.workspaceId === req.sessionUser.activeWorkspaceId && Date.now() - stored.createdAt < 30 * 60_000) {
    return { options: stored.options, tokenRefs: stored.tokenRefs ?? { pageTokenRefs: {} } };
  }
  return fallbackMetaOptions();
}

async function upsertMetaChannelAccount(params: {
  req: AuthenticatedRequest;
  channelType: "whatsapp" | "instagram" | "messenger";
  name: string;
  displayName: string;
  providerConfig: Record<string, unknown>;
  lookupKey: string;
  lookupValue: string;
  credentialsSecretRef: string | null;
}) {
  const lookupCondition = params.lookupKey === "phone_number_id"
    ? sql`(${channelAccountsTable.providerConfig}->>'phone_number_id' = ${params.lookupValue} OR ${channelAccountsTable.providerConfig}->>'phoneNumberId' = ${params.lookupValue})`
    : sql`${channelAccountsTable.providerConfig}->>${params.lookupKey} = ${params.lookupValue}`;

  const [existing] = await db
    .select()
    .from(channelAccountsTable)
    .where(and(
      eq(channelAccountsTable.workspaceId, params.req.sessionUser.activeWorkspaceId),
      eq(channelAccountsTable.channelType, params.channelType),
      lookupCondition,
    ))
    .limit(1);

  const values = {
    workspaceId: params.req.sessionUser.activeWorkspaceId,
    channelType: params.channelType,
    name: params.name,
    displayName: params.displayName,
    status: "active",
    providerConfig: params.providerConfig,
    credentialsSecretRef: params.credentialsSecretRef,
    createdBy: params.req.sessionUser.userId,
    updatedAt: new Date(),
  };

  const [account] = existing
    ? await db.update(channelAccountsTable).set(values).where(eq(channelAccountsTable.id, existing.id)).returning()
    : await db.insert(channelAccountsTable).values(values).returning();

  await createAuditLog({
    ...auditFromRequest(params.req, params.req.sessionUser),
    action: "meta_channel_connected",
    severity: "info",
    entityType: "channel_account",
    entityId: account.id,
    entityLabel: account.displayName,
    newData: {
      channelType: params.channelType,
      provider: "meta",
      lookupKey: params.lookupKey,
      lookupValue: params.lookupValue,
      tokenStoredAsReference: Boolean(params.credentialsSecretRef),
    },
  });

  return account;
}

async function listPersistedMetaChannelOptions(workspaceId: string): Promise<MetaChannelOptions> {
  const [accounts, sources] = await Promise.all([
    db
    .select()
    .from(channelAccountsTable)
    .where(and(
      eq(channelAccountsTable.workspaceId, workspaceId),
      sql`${channelAccountsTable.channelType} in ('whatsapp', 'instagram', 'messenger')`,
    )),
    db.select().from(catalogSourcesTable).where(eq(catalogSourcesTable.workspaceId, workspaceId)),
  ]);

  const whatsappByWaba = new Map<string, MetaChannelOptions["whatsapp_accounts"][number]>();
  const facebookPages: MetaChannelOptions["facebook_pages"] = [];
  const instagramAccounts: MetaChannelOptions["instagram_accounts"] = [];

  for (const account of accounts) {
    const config = (account.providerConfig ?? {}) as Record<string, unknown>;
    if (account.channelType === "whatsapp") {
      const phoneNumberId = String(config.phone_number_id ?? config.phoneNumberId ?? "");
      if (!phoneNumberId) continue;
      const wabaId = String(config.waba_id ?? config.wabaId ?? "");
      const key = wabaId || account.id;
      if (!whatsappByWaba.has(key)) {
        whatsappByWaba.set(key, { waba_id: wabaId, name: account.displayName, phone_numbers: [] });
      }
      whatsappByWaba.get(key)!.phone_numbers.push({
        phone_number_id: phoneNumberId,
        display_number: String(config.display_number ?? config.displayPhoneNumber ?? phoneNumberId),
        verified_name: typeof config.verified_name === "string" ? config.verified_name : typeof config.verifiedName === "string" ? config.verifiedName : undefined,
      });
    }
    if (account.channelType === "messenger") {
      const pageId = String(config.page_id ?? config.pageId ?? "");
      if (pageId) facebookPages.push({ page_id: pageId, name: account.displayName });
    }
    if (account.channelType === "instagram") {
      const igAccountId = String(config.ig_account_id ?? config.igAccountId ?? "");
      if (igAccountId) {
        instagramAccounts.push({
          ig_account_id: igAccountId,
          username: String(config.username ?? account.displayName),
          linked_page_id: String(config.linked_page_id ?? config.pageId ?? ""),
        });
      }
    }
  }

  return {
    whatsapp_accounts: [...whatsappByWaba.values()],
    facebook_pages: facebookPages,
    instagram_accounts: instagramAccounts,
    commerce_catalogs: sources
      .filter((source) => source.sourceType === "commerce_catalog")
      .map((source) => ({ catalog_id: source.externalId, name: source.name, business_id: typeof source.config.business_id === "string" ? source.config.business_id : undefined })),
    ad_accounts: sources
      .filter((source) => source.sourceType === "ads")
      .map((source) => ({ ad_account_id: source.externalId, name: source.name, business_id: typeof source.config.business_id === "string" ? source.config.business_id : undefined })),
  };
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
  const scopes = [
    "whatsapp_business_messaging",
    "whatsapp_business_management",
    "instagram_basic",
    "instagram_manage_messages",
    "pages_messaging",
    "pages_manage_metadata",
    "pages_show_list",
    "catalog_management",
    "business_management",
    "ads_read",
  ];
  const url = new URL(`https://www.facebook.com/${process.env.META_GRAPH_VERSION ?? "v21.0"}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("response_type", "code");

  res.json({ url: url.toString(), state, redirectUri, scopes, channels: ["whatsapp", "instagram", "messenger", "commerce_catalog", "ads"] });
});

router.get("/meta/embedded-signup/callback", requirePermission("integrations:update"), async (req: AuthenticatedRequest, res: Response) => {
  const state = String(req.query.state ?? "");
  const stored = (req.session as any).metaOAuthState;
  if (!stored || stored.state !== state || stored.workspaceId !== req.sessionUser.activeWorkspaceId || Date.now() - stored.createdAt > 15 * 60_000) {
    res.status(403).json({ connected: false, error: "invalid_state" });
    return;
  }

  const code = String(req.query.code ?? "");
  let channelOptions: { options: MetaChannelOptions; tokenRefs: MetaTokenRefs };

  try {
    const userToken = code ? await exchangeCodeForToken(req, code) : null;
    channelOptions = userToken ? await fetchMetaChannelOptions(userToken) : fallbackMetaOptions();
  } catch (err) {
    req.log?.warn({ err }, "Meta channel discovery failed, falling back to configured environment references");
    channelOptions = fallbackMetaOptions();
  }

  const wabaId = String(req.query.waba_id ?? "");
  const phoneNumberId = String(req.query.phone_number_id ?? "");
  if (wabaId && phoneNumberId && !channelOptions.options.whatsapp_accounts.some((account) => account.waba_id === wabaId)) {
    channelOptions.options.whatsapp_accounts.push({
      waba_id: wabaId,
      name: "WhatsApp Business",
      phone_numbers: [{
        phone_number_id: phoneNumberId,
        display_number: String(req.query.display_phone_number ?? ""),
        verified_name: String(req.query.verified_name ?? ""),
      }],
    });
  }

  (req.session as any).metaChannelOptions = {
    workspaceId: req.sessionUser.activeWorkspaceId,
    options: sanitizeMetaOptions(channelOptions.options),
    tokenRefs: channelOptions.tokenRefs,
    createdAt: Date.now(),
  };

  res.redirect("/integrations/meta/select-channels");
});

router.get("/meta/channels/options", requirePermission("integrations:update"), async (req: AuthenticatedRequest, res: Response) => {
  const stored = (req.session as any).metaChannelOptions;
  const options = stored?.workspaceId === req.sessionUser.activeWorkspaceId && Date.now() - stored.createdAt < 30 * 60_000
    ? stored.options as MetaChannelOptions
    : await listPersistedMetaChannelOptions(req.sessionUser.activeWorkspaceId);
  res.json({ options: sanitizeMetaOptions(options) });
});

router.get("/meta/channels", requirePermission("integrations:read"), async (req: AuthenticatedRequest, res: Response) => {
  const accounts = await db
    .select()
    .from(channelAccountsTable)
    .where(and(
      eq(channelAccountsTable.workspaceId, req.sessionUser.activeWorkspaceId),
      sql`${channelAccountsTable.channelType} in ('whatsapp', 'instagram', 'messenger')`,
    ));

  res.json({
    accounts: accounts.map((account) => ({
      id: account.id,
      channelType: account.channelType,
      name: account.name,
      displayName: account.displayName,
      status: account.status,
      providerConfig: account.providerConfig,
      hasCredentialReference: Boolean(account.credentialsSecretRef),
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    })),
  });
});

router.delete("/channels/:id", requirePermission("integrations:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const [existing] = await db
    .select()
    .from(channelAccountsTable)
    .where(and(
      eq(channelAccountsTable.workspaceId, req.sessionUser.activeWorkspaceId),
      eq(channelAccountsTable.id, String(req.params.id)),
    ))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "القناة غير موجودة" });
    return;
  }

  const [account] = await db
    .update(channelAccountsTable)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(and(
      eq(channelAccountsTable.workspaceId, req.sessionUser.activeWorkspaceId),
      eq(channelAccountsTable.id, existing.id),
    ))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "provider_account_disable",
    severity: "info",
    entityType: "channel_account",
    entityId: existing.id,
    entityLabel: existing.displayName,
    oldData: { status: existing.status },
    newData: { status: "disabled", channelType: existing.channelType },
  });

  res.json({ account });
});

router.post("/meta/channels", requirePermission("integrations:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = metaChannelSelectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات اختيار القنوات غير صالحة", details: parsed.error.flatten() });
    return;
  }

  const { options, tokenRefs } = currentMetaSession(req);
  const created: Array<typeof channelAccountsTable.$inferSelect> = [];
  const createdSources: Array<typeof catalogSourcesTable.$inferSelect> = [];
  const connectedAt = new Date().toISOString();
  const requestedChannelCount =
    parsed.data.whatsapp_phone_ids.length +
    parsed.data.instagram_account_ids.length +
    parsed.data.page_ids.length;
  if (requestedChannelCount > 0) {
    const channelLimit = await checkLimit(req.sessionUser.activeWorkspaceId, "channels");
    if (channelLimit.limit !== null && channelLimit.current + requestedChannelCount > channelLimit.limit) {
      res.status(402).json({
        error: "وصلت حد باقتك لعدد القنوات. اختر قنوات أقل أو قم بترقية الباقة قبل الربط.",
        code: "plan_limit_reached",
        limit: channelLimit,
      });
      return;
    }
  }

  for (const account of options.whatsapp_accounts) {
    for (const phone of account.phone_numbers) {
      if (!parsed.data.whatsapp_phone_ids.includes(phone.phone_number_id)) continue;
      const channel = await upsertMetaChannelAccount({
        req,
        channelType: "whatsapp",
        name: `whatsapp-${phone.phone_number_id}`,
        displayName: phone.display_number ? `WhatsApp ${phone.display_number}` : `WhatsApp ${phone.phone_number_id}`,
        providerConfig: {
          provider: "meta",
          waba_id: account.waba_id,
          phone_number_id: phone.phone_number_id,
          display_number: phone.display_number,
          verified_name: phone.verified_name,
          wabaId: account.waba_id,
          phoneNumberId: phone.phone_number_id,
          displayPhoneNumber: phone.display_number,
          verifiedName: phone.verified_name,
          embeddedSignup: true,
          connectedAt,
        },
        lookupKey: "phoneNumberId",
        lookupValue: phone.phone_number_id,
        credentialsSecretRef: tokenRefs.userTokenRef ?? process.env.META_ACCESS_TOKEN_SECRET_REF ?? null,
      });
      created.push(channel);
    }
  }

  const handledPhoneIds = new Set(created.map((account) => {
    const config = (account.providerConfig ?? {}) as Record<string, unknown>;
    return String(config.phone_number_id ?? config.phoneNumberId ?? "");
  }).filter(Boolean));

  for (const phoneNumberId of parsed.data.whatsapp_phone_ids) {
    if (handledPhoneIds.has(phoneNumberId)) continue;
    const wabaId = parsed.data.waba_id ?? "";
    const tokenRef = tokenRefs.userTokenRef ?? encryptedTokenRef(parsed.data.access_token ?? null);
    const channel = await upsertMetaChannelAccount({
      req,
      channelType: "whatsapp",
      name: phoneNumberId,
      displayName: phoneNumberId,
      providerConfig: {
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
        provider: "meta",
        phoneNumberId,
        wabaId,
      },
      lookupKey: "phone_number_id",
      lookupValue: phoneNumberId,
      credentialsSecretRef: tokenRef ?? null,
    });
    created.push(channel);
    handledPhoneIds.add(phoneNumberId);
  }

  for (const account of options.instagram_accounts) {
    if (!parsed.data.instagram_account_ids.includes(account.ig_account_id)) continue;
    const channel = await upsertMetaChannelAccount({
      req,
      channelType: "instagram",
      name: `instagram-${account.ig_account_id}`,
      displayName: account.username ? `Instagram ${account.username}` : `Instagram ${account.ig_account_id}`,
      providerConfig: {
        provider: "meta",
        igAccountId: account.ig_account_id,
        username: account.username,
        pageId: account.linked_page_id,
        embeddedSignup: true,
        connectedAt,
      },
      lookupKey: "igAccountId",
      lookupValue: account.ig_account_id,
      credentialsSecretRef: tokenRefs.pageTokenRefs[account.linked_page_id] ?? process.env.META_PAGE_ACCESS_TOKEN_SECRET_REF ?? null,
    });
    created.push(channel);
  }

  for (const page of options.facebook_pages) {
    if (!parsed.data.page_ids.includes(page.page_id)) continue;
    const channel = await upsertMetaChannelAccount({
      req,
      channelType: "messenger",
      name: `messenger-${page.page_id}`,
      displayName: page.name ? `Messenger ${page.name}` : `Messenger ${page.page_id}`,
      providerConfig: {
        provider: "meta",
        pageId: page.page_id,
        pageName: page.name,
        embeddedSignup: true,
        connectedAt,
      },
      lookupKey: "pageId",
      lookupValue: page.page_id,
      credentialsSecretRef: tokenRefs.pageTokenRefs[page.page_id] ?? process.env.META_PAGE_ACCESS_TOKEN_SECRET_REF ?? null,
    });
    created.push(channel);
  }

  for (const catalog of options.commerce_catalogs) {
    if (!parsed.data.catalog_ids.includes(catalog.catalog_id)) continue;
    const [source] = await db.insert(catalogSourcesTable).values({
      workspaceId: req.sessionUser.activeWorkspaceId,
      sourceType: "commerce_catalog",
      externalId: catalog.catalog_id,
      name: catalog.name || catalog.catalog_id,
      status: "active",
      config: { provider: "meta", business_id: catalog.business_id ?? null, connectedAt },
    }).onConflictDoUpdate({
      target: [catalogSourcesTable.workspaceId, catalogSourcesTable.sourceType, catalogSourcesTable.externalId],
      set: { name: catalog.name || catalog.catalog_id, status: "active", updatedAt: new Date() },
    }).returning();
    createdSources.push(source);
    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "catalog_source_create",
      severity: "info",
      entityType: "catalog_source",
      entityId: source.id,
      entityLabel: source.name,
      newData: { sourceType: source.sourceType, externalId: source.externalId, provider: "meta" },
    });
  }

  for (const account of options.ad_accounts) {
    if (!parsed.data.ad_account_ids.includes(account.ad_account_id)) continue;
    const [source] = await db.insert(catalogSourcesTable).values({
      workspaceId: req.sessionUser.activeWorkspaceId,
      sourceType: "ads",
      externalId: account.ad_account_id,
      name: account.name || account.ad_account_id,
      status: "active",
      config: { provider: "meta", business_id: account.business_id ?? null, connectedAt },
    }).onConflictDoUpdate({
      target: [catalogSourcesTable.workspaceId, catalogSourcesTable.sourceType, catalogSourcesTable.externalId],
      set: { name: account.name || account.ad_account_id, status: "active", updatedAt: new Date() },
    }).returning();
    createdSources.push(source);
    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "catalog_source_create",
      severity: "info",
      entityType: "catalog_source",
      entityId: source.id,
      entityLabel: source.name,
      newData: { sourceType: source.sourceType, externalId: source.externalId, provider: "meta" },
    });
  }

  res.status(201).json({
    accounts: created.map((account) => ({
      id: account.id,
      channel_type: account.channelType,
      channelType: account.channelType,
      name: account.name,
      displayName: account.displayName,
      status: account.status,
    })),
    sources: createdSources.map((source) => ({
      id: source.id,
      source_type: source.sourceType,
      sourceType: source.sourceType,
      name: source.name,
      status: source.status,
      syncStatus: source.syncStatus,
    })),
  });
});

export default router;
