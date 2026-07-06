import { Router, type Response } from "express";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { aiAgentsTable, catalogSourcesTable, channelAccountsTable, db, workspacesTable } from "@workspace/db";
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
import { listIntegrationHealth } from "./integrationHealth.service";
import {
  integrationProviders,
  providerAccountStatuses,
} from "./integrationTypes";
import { collectEquivalentMetaChannelIds, lookupAliasesForMetaKey } from "./meta-channel-identity";
import { checkLimit } from "../../services/billing";
import { getWorkspaceOnboardingStatus } from "../../services/onboarding-status";
import { syncCatalogSource } from "../../services/meta-catalog-sync";
import { autoSyncCreatedCatalogSources, resolveCatalogsForSelectedWabas } from "./catalog-auto-sync";

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

function providerLookupCondition(lookupKey: string, lookupValue: string) {
  const aliases = lookupAliasesForMetaKey(lookupKey);
  if (aliases.length === 1) {
    return sql`${channelAccountsTable.providerConfig}->>${lookupKey} = ${lookupValue}`;
  }
  if (aliases[0] === "phone_number_id") {
    return sql`(${channelAccountsTable.providerConfig}->>'phone_number_id' = ${lookupValue} OR ${channelAccountsTable.providerConfig}->>'phoneNumberId' = ${lookupValue})`;
  }
  if (aliases[0] === "ig_account_id") {
    return sql`(${channelAccountsTable.providerConfig}->>'ig_account_id' = ${lookupValue} OR ${channelAccountsTable.providerConfig}->>'igAccountId' = ${lookupValue})`;
  }
  if (aliases[0] === "page_id") {
    return sql`(${channelAccountsTable.providerConfig}->>'page_id' = ${lookupValue} OR ${channelAccountsTable.providerConfig}->>'pageId' = ${lookupValue})`;
  }
  if (aliases[0] === "waba_id") {
    return sql`(${channelAccountsTable.providerConfig}->>'waba_id' = ${lookupValue} OR ${channelAccountsTable.providerConfig}->>'wabaId' = ${lookupValue})`;
  }
  return sql`${channelAccountsTable.providerConfig}->>${lookupKey} = ${lookupValue}`;
}

function providerConfigRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function providerConfigString(value: unknown, ...keys: string[]): string | null {
  const config = providerConfigRecord(value);
  for (const key of keys) {
    const current = config[key];
    if (typeof current === "string" && current.trim()) return current.trim();
  }
  return null;
}

function appBaseUrl(req: AuthenticatedRequest) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const proto = req.header("x-forwarded-proto") ?? req.protocol;
  const host = req.header("x-forwarded-host") ?? req.header("host");
  return `${proto}://${host}`;
}

function metaRedirectUri(req: AuthenticatedRequest) {
  return process.env.META_REDIRECT_URI ?? `${appBaseUrl(req)}/api/integrations/meta/embedded-signup/callback`;
}

function metaGraphVersion(): string | null {
  const version = process.env.META_GRAPH_VERSION?.trim();
  return version || null;
}

function requireMetaGraphVersion(): string {
  const version = metaGraphVersion();
  if (!version) throw new Error("META_GRAPH_VERSION is not configured");
  return version;
}

function metaEmbeddedSignupConfigIds() {
  return {
    whatsappStandard: process.env.META_WHATSAPP_STANDARD_CONFIG_ID ?? null,
    whatsappCoexistence: process.env.META_WHATSAPP_COEXISTENCE_CONFIG_ID ?? null,
    instagramMessenger: process.env.META_INSTAGRAM_MESSENGER_CONFIG_ID ?? null,
    facebookContent: process.env.META_FACEBOOK_CONTENT_CONFIG_ID ?? null,
  };
}

type MetaPhoneNumber = {
  phone_number_id: string;
  display_number: string;
  verified_name?: string;
};

type MetaChannelOptions = {
  whatsapp_accounts: Array<{
    waba_id: string;
    business_id?: string;
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

function metaEncryptionKey(): Buffer {
  const material = process.env.META_OAUTH_STATE_SECRET ?? process.env.SESSION_SECRET;
  if (!material) throw new Error("META_OAUTH_STATE_SECRET or SESSION_SECRET is required to store direct Meta tokens");
  return createHash("sha256").update(material).digest();
}

function encryptedTokenRef(token: string | null | undefined): string | null {
  if (!token) return process.env.META_ACCESS_TOKEN_SECRET_REF ?? null;
  if (!process.env.META_OAUTH_STATE_SECRET && !process.env.SESSION_SECRET) return process.env.META_ACCESS_TOKEN_SECRET_REF ?? null;
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
  const response = await fetch(`https://graph.facebook.com/${requireMetaGraphVersion()}/${path.replace(/^\//, "")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Meta Graph API returned ${response.status}`);
  return response.json();
}

function pushUniqueMetaCatalog(
  catalogs: MetaChannelOptions["commerce_catalogs"],
  catalog: MetaChannelOptions["commerce_catalogs"][number],
) {
  if (catalogs.some((item) => item.catalog_id === catalog.catalog_id)) return;
  catalogs.push(catalog);
}

async function fetchWabaProductCatalogs(
  wabaId: string,
  userToken: string,
  businessId?: string,
): Promise<MetaChannelOptions["commerce_catalogs"]> {
  try {
    const payload = await callMetaGraph(`${wabaId}/product_catalogs?fields=id,name`, userToken);
    return (payload?.data ?? [])
      .filter((catalog: any) => catalog?.id)
      .map((catalog: any) => ({
        catalog_id: String(catalog.id),
        name: String(catalog.name ?? "WhatsApp Catalog"),
        business_id: businessId,
      }));
  } catch {
    return [];
  }
}

async function postMetaGraph(path: string, token: string, body?: Record<string, unknown>): Promise<any> {
  const response = await fetch(`https://graph.facebook.com/${requireMetaGraphVersion()}/${path.replace(/^\//, "")}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Meta Graph API POST returned ${response.status}`);
  return response.json();
}

async function exchangeCodeForToken(
  req: AuthenticatedRequest,
  code: string,
  options: { redirectUri?: string | null } = {},
): Promise<string | null> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret || !code) return null;

  const url = new URL(`https://graph.facebook.com/${requireMetaGraphVersion()}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  const redirectUri = options.redirectUri === undefined ? metaRedirectUri(req) : options.redirectUri;
  if (redirectUri) url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Meta OAuth exchange returned ${response.status}`);
  const payload: any = await response.json();
  // 6 يوليو 2026: عميل حقيقي أخذ 409 (meta_token_exchange_unavailable) ثلاث مرات متتالية —
  // هذا الفرع كان يُسقط رسالة خطأ Meta الفعلية (غالباً code إعادة استخدام أو رفض صلاحية)
  // بصمت، فتعذّر معرفة السبب الحقيقي. نُسجّل حقول الخطأ فقط (لا access_token أبداً).
  if (typeof payload.access_token !== "string") {
    req.log?.warn({ metaError: payload?.error ?? payload }, "Meta OAuth exchange returned 200 without access_token");
    return null;
  }
  return payload.access_token;
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

async function fetchMetaPageOptions(userToken: string): Promise<{
  facebookPages: MetaChannelOptions["facebook_pages"];
  instagramAccounts: MetaChannelOptions["instagram_accounts"];
  pageTokenRefs: Record<string, string>;
}> {
  const pages = await callMetaGraph(
    "me/accounts?fields=id,name,access_token,instagram_business_account{id,username}",
    userToken,
  );

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

  return { facebookPages, instagramAccounts, pageTokenRefs };
}

async function fetchMetaChannelOptions(userToken: string): Promise<{ options: MetaChannelOptions; tokenRefs: MetaTokenRefs }> {
  const [businessesResult, pageOptionsResult] = await Promise.allSettled([
    callMetaGraph("me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}},owned_product_catalogs{id,name},owned_ad_accounts{id,name,account_id}", userToken),
    fetchMetaPageOptions(userToken),
  ]);
  const businesses = businessesResult.status === "fulfilled" ? businessesResult.value : { data: [] };
  const pageOptions = pageOptionsResult.status === "fulfilled"
    ? pageOptionsResult.value
    : { facebookPages: [], instagramAccounts: [], pageTokenRefs: {} };

  const whatsappAccounts: MetaChannelOptions["whatsapp_accounts"] = [];
  const commerceCatalogs: MetaChannelOptions["commerce_catalogs"] = [];
  const adAccounts: MetaChannelOptions["ad_accounts"] = [];
  for (const business of businesses?.data ?? []) {
    const businessId = String(business.id ?? "");
    for (const waba of business?.owned_whatsapp_business_accounts?.data ?? []) {
      whatsappAccounts.push({
        waba_id: String(waba.id),
        business_id: businessId,
        name: String(waba.name ?? business.name ?? "WhatsApp Business"),
        phone_numbers: (waba.phone_numbers?.data ?? []).map((phone: any) => ({
          phone_number_id: String(phone.id),
          display_number: String(phone.display_phone_number ?? ""),
          verified_name: phone.verified_name ? String(phone.verified_name) : undefined,
        })),
      });
      for (const catalog of await fetchWabaProductCatalogs(String(waba.id), userToken, businessId)) {
        pushUniqueMetaCatalog(commerceCatalogs, catalog);
      }
    }
    for (const catalog of business?.owned_product_catalogs?.data ?? []) {
      pushUniqueMetaCatalog(commerceCatalogs, {
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

  return {
    options: {
      whatsapp_accounts: whatsappAccounts,
      facebook_pages: pageOptions.facebookPages,
      instagram_accounts: pageOptions.instagramAccounts,
      commerce_catalogs: commerceCatalogs,
      ad_accounts: adAccounts,
    },
    tokenRefs: {
      userTokenRef: encryptedTokenRef(userToken) ?? undefined,
      pageTokenRefs: pageOptions.pageTokenRefs,
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

const metaEmbeddedSignupCompleteSchema = z.object({
  code: z.string().trim().min(1),
  waba_id: z.string().trim().min(1).optional(),
  wabaId: z.string().trim().min(1).optional(),
  phone_number_id: z.string().trim().min(1).optional(),
  phoneNumberId: z.string().trim().min(1).optional(),
  display_phone_number: z.string().trim().optional(),
  displayPhoneNumber: z.string().trim().optional(),
  verified_name: z.string().trim().optional(),
  verifiedName: z.string().trim().optional(),
  config_id: z.string().trim().optional(),
  configId: z.string().trim().optional(),
  config_key: z.string().trim().optional(),
  configKey: z.string().trim().optional(),
});

const metaEmbeddedSignupInstagramSchema = z.object({
  code: z.string().trim().min(1),
  ig_account_id: z.string().trim().min(1).optional(),
  igAccountId: z.string().trim().min(1).optional(),
  linked_page_id: z.string().trim().min(1).optional(),
  linkedPageId: z.string().trim().min(1).optional(),
  username: z.string().trim().optional(),
});

const metaEmbeddedSignupMessengerSchema = z.object({
  code: z.string().trim().min(1),
  page_id: z.string().trim().min(1).optional(),
  pageId: z.string().trim().min(1).optional(),
  page_name: z.string().trim().optional(),
  pageName: z.string().trim().optional(),
});

const metaEmbeddedSignupInstagramMessengerSchema = z.object({
  code: z.string().trim().min(1),
});

async function upsertMetaCatalogSources(params: {
  req: AuthenticatedRequest;
  catalogs: Array<{
    catalog_id: string;
    name: string;
    business_id?: string;
    linked_waba_id: string | null;
  }>;
  channelAccountIdByWabaId: Map<string, string>;
  connectedAt: string;
}): Promise<Array<typeof catalogSourcesTable.$inferSelect>> {
  const createdSources: Array<typeof catalogSourcesTable.$inferSelect> = [];

  for (const catalog of params.catalogs) {
    const channelAccountId = catalog.linked_waba_id
      ? params.channelAccountIdByWabaId.get(catalog.linked_waba_id) ?? null
      : null;
    const [source] = await db.insert(catalogSourcesTable).values({
      workspaceId: params.req.sessionUser.activeWorkspaceId,
      channelAccountId,
      sourceType: "commerce_catalog",
      externalId: catalog.catalog_id,
      name: catalog.name || catalog.catalog_id,
      status: "active",
      config: {
        provider: "meta",
        business_id: catalog.business_id ?? null,
        waba_id: catalog.linked_waba_id,
        connectedAt: params.connectedAt,
      },
    }).onConflictDoUpdate({
      target: [catalogSourcesTable.workspaceId, catalogSourcesTable.sourceType, catalogSourcesTable.externalId],
      set: {
        name: catalog.name || catalog.catalog_id,
        channelAccountId,
        config: {
          provider: "meta",
          business_id: catalog.business_id ?? null,
          waba_id: catalog.linked_waba_id,
          connectedAt: params.connectedAt,
        },
        status: "active",
        updatedAt: new Date(),
      },
    }).returning();
    createdSources.push(source);
    await createAuditLog({
      ...auditFromRequest(params.req, params.req.sessionUser),
      action: "catalog_source_create",
      severity: "info",
      entityType: "catalog_source",
      entityId: source.id,
      entityLabel: source.name,
      newData: { sourceType: source.sourceType, externalId: source.externalId, provider: "meta" },
    });
  }

  return createdSources;
}

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
  externalBusinessId?: string | null;
  externalPhoneId?: string | null;
}) {
  const lookupCondition = providerLookupCondition(params.lookupKey, params.lookupValue);

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
    // 7 يوليو 2026: تُملأ فقط حين يمررها الاستدعاء (واتساب) — بلا هذا، فحص اكتمال onboarding
    // الاحتياطي (حين لا credentialsSecretRef، أي مسار توكن النظام) لا يجد أي دليل إطلاقاً.
    ...(params.externalBusinessId !== undefined ? { externalBusinessId: params.externalBusinessId } : {}),
    ...(params.externalPhoneId !== undefined ? { externalPhoneId: params.externalPhoneId } : {}),
  };

  let [account] = existing
    ? await db.update(channelAccountsTable).set(values).where(and(
      eq(channelAccountsTable.id, existing.id),
      eq(channelAccountsTable.workspaceId, params.req.sessionUser.activeWorkspaceId)
    )).returning()
    : await db.insert(channelAccountsTable).values(values).returning();

  // اربط القناة تلقائياً بوكيل الـworkspace عند أول ربط — بلا هذا، القناة تعمل (استقبال/إرسال)
  // لكن لا رد آلي أبداً حتى يذهب التاجر يدوياً للإعدادات ويختار وكيلاً؛ خطوة onboarding
  // تنشئ الوكيل قبل ربط القناة دائماً، فمن المتوقع وجوده هنا. لا نتجاوز اختياراً سابقاً للتاجر.
  if (!account.defaultAgentId) {
    const [workspaceAgent] = await db
      .select({ id: aiAgentsTable.id })
      .from(aiAgentsTable)
      .where(and(eq(aiAgentsTable.workspaceId, params.req.sessionUser.activeWorkspaceId), eq(aiAgentsTable.status, "active")))
      .orderBy(desc(aiAgentsTable.updatedAt), desc(aiAgentsTable.createdAt))
      .limit(1);
    if (workspaceAgent) {
      [account] = await db
        .update(channelAccountsTable)
        .set({ defaultAgentId: workspaceAgent.id, updatedAt: new Date() })
        .where(and(eq(channelAccountsTable.id, account.id), eq(channelAccountsTable.workspaceId, params.req.sessionUser.activeWorkspaceId)))
        .returning();
    }
  }

  const claimedAccountIds: string[] = [];
  if (params.channelType === "whatsapp") {
    const duplicatedAccounts = await db
      .update(channelAccountsTable)
      .set({
        status: "disabled",
        providerConfig: null,
        credentialsSecretRef: null,
        externalAccountId: null,
        externalBusinessId: null,
        externalPhoneId: null,
        healthStatus: null,
        lastHealthAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        sql`${channelAccountsTable.id} <> ${account.id}`,
        inArray(channelAccountsTable.channelType, ["whatsapp", "whatsapp_api"]),
        lookupCondition,
      ))
      .returning({ id: channelAccountsTable.id });

    claimedAccountIds.push(...duplicatedAccounts.map((item) => item.id));
  }

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
      claimedAccountIds,
      claimedCount: claimedAccountIds.length,
    },
  });

  return account;
}

function serializeChannelAccount(account: typeof channelAccountsTable.$inferSelect) {
  return {
    id: account.id,
    channelType: account.channelType,
    channel_type: account.channelType,
    name: account.name,
    displayName: account.displayName,
    status: account.status,
    providerConfig: account.providerConfig,
    hasCredentialReference: Boolean(account.credentialsSecretRef),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

// Shared Instagram connect logic — used by /instagram/complete and the combined IG+Messenger flow.
// Fetches the linked page token (for outbound IG calls), stores it encrypted, creates the channel
// account keyed by igAccountId (for ingest lookup), and subscribes the page to messaging webhooks.
async function connectInstagramChannel(params: {
  req: AuthenticatedRequest;
  userToken: string;
  igAccountId: string;
  linkedPageId: string;
  username?: string;
  pageToken?: string | null;
}) {
  let pageToken = params.pageToken ?? null;
  if (!pageToken) {
    try {
      const pageData = await callMetaGraph(`${params.linkedPageId}?fields=access_token`, params.userToken);
      pageToken = typeof pageData?.access_token === "string" ? pageData.access_token : null;
    } catch (err) {
      params.req.log?.warn({ err, linkedPageId: params.linkedPageId }, "Failed to fetch Instagram linked page token; will store user token");
    }
  }

  const username = params.username ?? "";
  const account = await upsertMetaChannelAccount({
    req: params.req,
    channelType: "instagram",
    name: `instagram-${params.igAccountId}`,
    displayName: username ? `Instagram @${username}` : `Instagram ${params.igAccountId}`,
    providerConfig: {
      provider: "meta",
      igAccountId: params.igAccountId,
      pageId: params.linkedPageId,
      username,
      embeddedSignup: true,
      connectedAt: new Date().toISOString(),
    },
    lookupKey: "igAccountId",
    lookupValue: params.igAccountId,
    credentialsSecretRef: encryptedTokenRef(pageToken ?? params.userToken),
  });

  try {
    await postMetaGraph(`${params.linkedPageId}/subscribed_apps`, pageToken ?? params.userToken, {
      subscribed_fields: "messages,messaging_postbacks,messaging_optins",
    });
  } catch (err) {
    params.req.log?.warn({ err, linkedPageId: params.linkedPageId, channelAccountId: account.id }, "Instagram page webhook subscription failed; continuing");
  }

  return account;
}

// Shared Messenger connect logic — used by /messenger/complete and the combined IG+Messenger flow.
async function connectMessengerChannel(params: {
  req: AuthenticatedRequest;
  userToken: string;
  pageId: string;
  pageName?: string;
  pageToken?: string | null;
}) {
  let pageName = params.pageName ?? "";
  let pageToken = params.pageToken ?? null;
  if (!pageToken) {
    try {
      const pageData = await callMetaGraph(`${params.pageId}?fields=access_token,name`, params.userToken);
      pageToken = typeof pageData?.access_token === "string" ? pageData.access_token : null;
      if (!pageName && typeof pageData?.name === "string") pageName = pageData.name;
    } catch (err) {
      params.req.log?.warn({ err, pageId: params.pageId }, "Failed to fetch Messenger page token; will store user token");
    }
  }

  const account = await upsertMetaChannelAccount({
    req: params.req,
    channelType: "messenger",
    name: `messenger-${params.pageId}`,
    displayName: pageName ? `Messenger ${pageName}` : `Messenger ${params.pageId}`,
    providerConfig: {
      provider: "meta",
      pageId: params.pageId,
      pageName,
      embeddedSignup: true,
      connectedAt: new Date().toISOString(),
    },
    lookupKey: "pageId",
    lookupValue: params.pageId,
    credentialsSecretRef: encryptedTokenRef(pageToken ?? params.userToken),
  });

  try {
    await postMetaGraph(`${params.pageId}/subscribed_apps`, pageToken ?? params.userToken, {
      subscribed_fields: "messages,messaging_postbacks,messaging_optins",
    });
  } catch (err) {
    params.req.log?.warn({ err, pageId: params.pageId, channelAccountId: account.id }, "Messenger page webhook subscription failed; continuing");
  }

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
        whatsappByWaba.set(key, {
          waba_id: wabaId,
          business_id: typeof config.business_id === "string" ? config.business_id : undefined,
          name: account.displayName,
          phone_numbers: [],
        });
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

router.get("/health", requirePermission("integrations:read"), async (req: AuthenticatedRequest, res: Response) => {
  const health = await listIntegrationHealth(req.sessionUser.activeWorkspaceId);
  res.json(health);
});

router.get("/meta/embedded-signup/config", requirePermission("integrations:update"), async (_req: AuthenticatedRequest, res: Response) => {
  const appId = process.env.META_APP_ID ?? null;
  const graphVersion = metaGraphVersion() ?? "v22.0";
  const configIds = metaEmbeddedSignupConfigIds();
  // ready يبقى مبنياً على الحد الأدنى (واتساب القياسي) كما كان — لا نغيّر دلالته القائمة.
  // missing الآن يُبلّغ شفافيةً عن أي config فرعي غائب (تعايش/إنستغرام+ماسنجر) بدل أن يختفي
  // صامتاً خلف ready=true عاماً؛ الحماية الفعلية للعميل هي تعطيل الزر لكل خيار configId فارغ
  // (Onboarding/IntegrationsPage) بصرف النظر عن هذا الحقل.
  const missing = [
    !appId ? "META_APP_ID" : null,
    !graphVersion ? "META_GRAPH_VERSION" : null,
    !configIds.whatsappStandard ? "META_WHATSAPP_STANDARD_CONFIG_ID" : null,
    !configIds.whatsappCoexistence ? "META_WHATSAPP_COEXISTENCE_CONFIG_ID (تعايش)" : null,
    !configIds.instagramMessenger ? "META_INSTAGRAM_MESSENGER_CONFIG_ID" : null,
  ].filter(Boolean);

  res.json({
    appId,
    graphVersion,
    configIds,
    ready: Boolean(appId) && Boolean(graphVersion) && Boolean(configIds.whatsappStandard),
    missing,
  });
});

router.get("/meta/embedded-signup/start", requirePermission("integrations:update"), async (req: AuthenticatedRequest, res: Response) => {
  const appId = process.env.META_APP_ID;
  const graphVersion = process.env.META_GRAPH_VERSION?.trim();
  const state = randomBytes(24).toString("hex");
  (req.session as any).metaOAuthState = {
    state,
    workspaceId: req.sessionUser.activeWorkspaceId,
    createdAt: Date.now(),
  };

  const missing = [
    !appId ? "META_APP_ID" : null,
    !graphVersion ? "META_GRAPH_VERSION" : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    res.status(409).json({ ready: false, missing, mode: "config_missing" });
    return;
  }
  const metaAppId = appId!;
  const metaGraphVersion = graphVersion!;

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
  const url = new URL(`https://www.facebook.com/${metaGraphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", metaAppId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("response_type", "code");

  res.json({ url: url.toString(), state, redirectUri, scopes, channels: ["whatsapp", "instagram", "messenger", "commerce_catalog", "ads"] });
});

router.post("/meta/embedded-signup/complete", requirePermission("integrations:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = metaEmbeddedSignupCompleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات التسجيل المضمن غير صالحة", details: parsed.error.flatten() });
    return;
  }

  const wabaId = parsed.data.waba_id ?? parsed.data.wabaId ?? "";
  const phoneNumberId = parsed.data.phone_number_id ?? parsed.data.phoneNumberId ?? "";
  if (!wabaId || !phoneNumberId) {
    res.status(400).json({ error: "waba_id and phone_number_id are required", code: "missing_embedded_signup_ids" });
    return;
  }

  const channelLimit = await checkLimit(req.sessionUser.activeWorkspaceId, "channels");
  if (channelLimit.limit !== null && channelLimit.current + 1 > channelLimit.limit) {
    res.status(402).json({
      error: "وصلت حد باقتك لعدد القنوات. قم بترقية الباقة قبل الربط.",
      code: "plan_limit_reached",
      limit: channelLimit,
    });
    return;
  }

  // 7 يوليو 2026: لا نستبدل هذا بتوكن النظام العام تلقائياً حين يفشل code — ذلك التوكن واسع
  // الصلاحية عبر كل حسابات واتساب تحت أعمالنا في Meta، ودون تبديل code (المُثبَت مسبقاً عبر
  // Meta نفسها) لا يوجد أي إثبات أن مساحة العمل الطالبة تملك فعلاً هذا الـwaba_id تحديداً —
  // فتح هذا كثغرة اختطاف بين المستأجرين. الاسترجاع اليدوي المُستخدم للعملاء الحقيقيين هذه
  // الجلسة سليم لأنه بإذن صريح لكل حالة وباتصال مباشر بقاعدة البيانات، لا عبر واجهة عامة.
  let userToken: string | null = null;
  if (parsed.data.code) {
    try {
      userToken = await exchangeCodeForToken(req, parsed.data.code, { redirectUri: null });
    } catch (err) {
      req.log?.warn({ err }, "Meta embedded signup token exchange failed");
      res.status(502).json({ error: "تعذر تبديل كود Meta إلى رمز وصول", code: "meta_token_exchange_failed" });
      return;
    }
  }

  if (!userToken) {
    res.status(409).json({
      error: "تعذر تجهيز رمز وصول Meta. تحقق من META_APP_ID و META_APP_SECRET و META_GRAPH_VERSION.",
      code: "meta_token_exchange_unavailable",
    });
    return;
  }

  const displayNumber = parsed.data.display_phone_number ?? parsed.data.displayPhoneNumber ?? "";
  const verifiedName = parsed.data.verified_name ?? parsed.data.verifiedName ?? "";
  const configId = parsed.data.config_id ?? parsed.data.configId ?? "";
  const configKey = parsed.data.config_key ?? parsed.data.configKey ?? "whatsapp_standard";
  const connectedAt = new Date().toISOString();
  const tokenRef = encryptedTokenRef(userToken) ?? process.env.META_ACCESS_TOKEN_SECRET_REF ?? null;
  const account = await upsertMetaChannelAccount({
    req,
    channelType: "whatsapp",
    name: `whatsapp-${phoneNumberId}`,
    displayName: displayNumber ? `WhatsApp ${displayNumber}` : `WhatsApp ${phoneNumberId}`,
    providerConfig: {
      provider: "meta",
      meta_app_id: process.env.META_APP_ID ?? null,
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      display_number: displayNumber,
      verified_name: verifiedName,
      wabaId,
      phoneNumberId,
      displayPhoneNumber: displayNumber,
      verifiedName,
      embeddedSignup: true,
      embeddedSignupSource: "facebook_js_sdk",
      configId,
      configKey,
      connectedAt,
    },
    lookupKey: "phone_number_id",
    lookupValue: phoneNumberId,
    credentialsSecretRef: tokenRef,
    externalBusinessId: wabaId,
    externalPhoneId: phoneNumberId,
  });

  try {
    await postMetaGraph(`${wabaId}/subscribed_apps`, userToken);
  } catch (err) {
    req.log?.warn({ err, channelAccountId: account.id, wabaId }, "Meta WABA app subscription failed");
    res.status(502).json({ error: "تعذر الاشتراك في Webhooks لحساب واتساب التجاري", code: "meta_waba_subscription_failed" });
    return;
  }

  // رقم وضع التعايش (تطبيق واتساب للأعمال + Cloud API معاً) ليس رقماً جديداً على Cloud API —
  // ميتا ترفض /register له صراحة ("Register endpoint is not available for SMB businesses"،
  // مؤكَّد من فحص سابق). الاستدعاء غير ضار (يُمسَك ويُكمَّل) لكن تخطّيه أوضح وأقل ضجيجاً بالسجلات.
  if (configKey !== "whatsapp_coexistence") {
    try {
      await postMetaGraph(`${phoneNumberId}/register`, userToken, {
        messaging_product: "whatsapp",
        pin: "000000",
      });
    } catch (err) {
      req.log?.warn({ err, channelAccountId: account.id, phoneNumberId }, "Meta phone number registration failed; continuing");
    }
  }

  const wabaCatalogs = await fetchWabaProductCatalogs(wabaId, userToken);

  const createdSources = await upsertMetaCatalogSources({
    req,
    catalogs: resolveCatalogsForSelectedWabas({
      whatsappAccounts: [{ waba_id: wabaId }],
      commerceCatalogs: wabaCatalogs,
      selectedWabaIds: [wabaId],
      selectedCatalogIds: [],
    }),
    channelAccountIdByWabaId: new Map([[wabaId, account.id]]),
    connectedAt,
  });
  const autoSyncResults = await autoSyncCreatedCatalogSources(
    createdSources,
    syncCatalogSource,
    (source, err) => req.log?.warn({ err, sourceId: source.id, channelAccountId: account.id }, "Auto sync failed for embedded signup catalog source"),
  );

  res.status(201).json({
    account: {
      id: account.id,
      channel_type: account.channelType,
      channelType: account.channelType,
      name: account.name,
      displayName: account.displayName,
      status: account.status,
      providerConfig: account.providerConfig,
      hasCredentialReference: Boolean(account.credentialsSecretRef),
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    },
    sources: createdSources.map((source) => ({
      id: source.id,
      source_type: source.sourceType,
      sourceType: source.sourceType,
      name: source.name,
      status: source.status,
      syncStatus: autoSyncResults.get(source.id)?.status ?? source.syncStatus,
      syncResult: autoSyncResults.get(source.id) ?? null,
    })),
  });
});

// PD-6 fix: Instagram embedded signup — creates channel account with igAccountId for ingest lookup
router.post("/meta/embedded-signup/instagram/complete", requirePermission("integrations:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = metaEmbeddedSignupInstagramSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات ربط إنستغرام غير صالحة", details: parsed.error.flatten() });
    return;
  }

  const igAccountId = parsed.data.ig_account_id ?? parsed.data.igAccountId ?? "";
  const linkedPageId = parsed.data.linked_page_id ?? parsed.data.linkedPageId ?? "";
  if (!igAccountId || !linkedPageId) {
    res.status(400).json({ error: "ig_account_id and linked_page_id are required", code: "missing_instagram_ids" });
    return;
  }

  const channelLimit = await checkLimit(req.sessionUser.activeWorkspaceId, "channels");
  if (channelLimit.limit !== null && channelLimit.current + 1 > channelLimit.limit) {
    res.status(402).json({ error: "وصلت حد باقتك لعدد القنوات. قم بترقية الباقة قبل الربط.", code: "plan_limit_reached", limit: channelLimit });
    return;
  }

  let userToken: string | null = null;
  try {
    userToken = await exchangeCodeForToken(req, parsed.data.code, { redirectUri: null });
  } catch (err) {
    req.log?.warn({ err }, "Meta Instagram signup token exchange failed");
    res.status(502).json({ error: "تعذر تبديل كود Meta إلى رمز وصول", code: "meta_token_exchange_failed" });
    return;
  }

  if (!userToken) {
    res.status(409).json({ error: "تعذر تجهيز رمز وصول Meta. تحقق من META_APP_ID و META_APP_SECRET.", code: "meta_token_exchange_unavailable" });
    return;
  }

  const account = await connectInstagramChannel({
    req,
    userToken,
    igAccountId,
    linkedPageId,
    username: parsed.data.username,
  });

  res.status(201).json({ account: serializeChannelAccount(account) });
});

// PD-6 fix: Messenger embedded signup — creates channel account with pageId for ingest lookup
router.post("/meta/embedded-signup/messenger/complete", requirePermission("integrations:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = metaEmbeddedSignupMessengerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات ربط ماسنجر غير صالحة", details: parsed.error.flatten() });
    return;
  }

  const pageId = parsed.data.page_id ?? parsed.data.pageId ?? "";
  if (!pageId) {
    res.status(400).json({ error: "page_id is required", code: "missing_page_id" });
    return;
  }

  const channelLimit = await checkLimit(req.sessionUser.activeWorkspaceId, "channels");
  if (channelLimit.limit !== null && channelLimit.current + 1 > channelLimit.limit) {
    res.status(402).json({ error: "وصلت حد باقتك لعدد القنوات. قم بترقية الباقة قبل الربط.", code: "plan_limit_reached", limit: channelLimit });
    return;
  }

  let userToken: string | null = null;
  try {
    userToken = await exchangeCodeForToken(req, parsed.data.code, { redirectUri: null });
  } catch (err) {
    req.log?.warn({ err }, "Meta Messenger signup token exchange failed");
    res.status(502).json({ error: "تعذر تبديل كود Meta إلى رمز وصول", code: "meta_token_exchange_failed" });
    return;
  }

  if (!userToken) {
    res.status(409).json({ error: "تعذر تجهيز رمز وصول Meta. تحقق من META_APP_ID و META_APP_SECRET.", code: "meta_token_exchange_unavailable" });
    return;
  }

  const account = await connectMessengerChannel({
    req,
    userToken,
    pageId,
    pageName: parsed.data.page_name ?? parsed.data.pageName,
  });

  res.status(201).json({ account: serializeChannelAccount(account) });
});

// PD-6 fix: Instagram + Messenger via a single FB.login (instagram_messenger config). The popup
// does not return WhatsApp-style identifiers, so we discover the granted pages/IG accounts via Graph
// (reusing fetchMetaChannelOptions) and connect each through the shared connect helpers
// (channel creation + subscribed_apps + encrypted token). Meta app config is untouched.
router.post("/meta/embedded-signup/instagram-messenger/complete", requirePermission("integrations:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = metaEmbeddedSignupInstagramMessengerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات ربط إنستغرام وماسنجر غير صالحة", details: parsed.error.flatten() });
    return;
  }

  let userToken: string | null = null;
  try {
    userToken = await exchangeCodeForToken(req, parsed.data.code, { redirectUri: null });
  } catch (err) {
    req.log?.warn({ err }, "Meta Instagram/Messenger signup token exchange failed");
    res.status(502).json({ error: "تعذر تبديل كود Meta إلى رمز وصول", code: "meta_token_exchange_failed" });
    return;
  }
  if (!userToken) {
    res.status(409).json({ error: "تعذر تجهيز رمز وصول Meta. تحقق من META_APP_ID و META_APP_SECRET.", code: "meta_token_exchange_unavailable" });
    return;
  }

  let discovered: Awaited<ReturnType<typeof fetchMetaPageOptions>>;
  try {
    // This signup token is scoped to Pages/Instagram. Do not couple discovery to
    // WhatsApp, catalog, or ads fields that may legitimately be unavailable.
    discovered = await fetchMetaPageOptions(userToken);
  } catch (err) {
    req.log?.warn({ err }, "Instagram/Messenger discovery failed");
    res.status(502).json({ error: "تعذر اكتشاف الصفحات وحسابات إنستغرام من Meta", code: "meta_discovery_failed" });
    return;
  }

  const pages = discovered.facebookPages;
  const instagramAccounts = discovered.instagramAccounts;
  if (pages.length === 0 && instagramAccounts.length === 0) {
    res.status(409).json({
      error: "لم نعثر على صفحات فيسبوك أو حسابات إنستغرام مرتبطة بهذا الحساب. تأكد من منح الصلاحيات أثناء الربط.",
      code: "no_pages_or_instagram",
    });
    return;
  }

  const requestedChannelCount = pages.length + instagramAccounts.length;
  const channelLimit = await checkLimit(req.sessionUser.activeWorkspaceId, "channels");
  if (channelLimit.limit !== null && channelLimit.current + requestedChannelCount > channelLimit.limit) {
    res.status(402).json({
      error: "وصلت حد باقتك لعدد القنوات. قم بترقية الباقة قبل الربط.",
      code: "plan_limit_reached",
      limit: channelLimit,
    });
    return;
  }

  const created: Array<typeof channelAccountsTable.$inferSelect> = [];
  for (const page of pages) {
    created.push(await connectMessengerChannel({ req, userToken, pageId: page.page_id, pageName: page.name }));
  }
  for (const ig of instagramAccounts) {
    created.push(await connectInstagramChannel({
      req,
      userToken,
      igAccountId: ig.ig_account_id,
      linkedPageId: ig.linked_page_id,
      username: ig.username,
    }));
  }

  res.status(201).json({ accounts: created.map(serializeChannelAccount) });
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

  const onboardingStatusBeforeDisconnect = await getWorkspaceOnboardingStatus(req.sessionUser.activeWorkspaceId);
  if (onboardingStatusBeforeDisconnect.completed) {
    const [workspace] = await db
      .select({ id: workspacesTable.id, settings: workspacesTable.settings })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, req.sessionUser.activeWorkspaceId))
      .limit(1);

    if (workspace) {
      const currentSettings =
        workspace.settings && typeof workspace.settings === "object" && !Array.isArray(workspace.settings)
          ? workspace.settings as Record<string, unknown>
          : {};

      if (currentSettings.onboarding_completed !== true) {
        await db
          .update(workspacesTable)
          .set({ settings: { ...currentSettings, onboarding_completed: true } })
          .where(eq(workspacesTable.id, workspace.id));
      }
    }
  }

  const siblingAccounts = await db
    .select()
    .from(channelAccountsTable)
    .where(and(
      eq(channelAccountsTable.workspaceId, req.sessionUser.activeWorkspaceId),
      eq(channelAccountsTable.channelType, existing.channelType),
    ));

  const linkedAccountIds = collectEquivalentMetaChannelIds(existing, siblingAccounts);
  const idsToDisable = linkedAccountIds.length > 0 ? linkedAccountIds : [existing.id];

  const [account] = await db
    .update(channelAccountsTable)
    .set({
      status: "disabled",
      providerConfig: null,
      credentialsSecretRef: null,
      externalAccountId: null,
      externalBusinessId: null,
      externalPhoneId: null,
      healthStatus: null,
      lastHealthAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(channelAccountsTable.workspaceId, req.sessionUser.activeWorkspaceId),
      inArray(channelAccountsTable.id, idsToDisable),
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
    newData: { status: "disabled", channelType: existing.channelType, disabledAccountIds: idsToDisable, disabledCount: idsToDisable.length },
  });

  res.json({ account, disabledAccountIds: idsToDisable });
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
  const metaAppId = process.env.META_APP_ID ?? null;
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
          business_id: account.business_id ?? null,
          meta_app_id: metaAppId,
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
        meta_app_id: metaAppId,
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

  const selectedWhatsappChannels = created.filter((account) => account.channelType === "whatsapp");
  const selectedWhatsappChannelIdByWabaId = new Map<string, string>();
  for (const account of selectedWhatsappChannels) {
    const wabaId = providerConfigString(account.providerConfig, "waba_id", "wabaId");
    if (!wabaId || selectedWhatsappChannelIdByWabaId.has(wabaId)) continue;
    selectedWhatsappChannelIdByWabaId.set(wabaId, account.id);
  }

  const linkedCatalogs = resolveCatalogsForSelectedWabas({
    whatsappAccounts: options.whatsapp_accounts,
    commerceCatalogs: options.commerce_catalogs,
    selectedWabaIds: [...selectedWhatsappChannelIdByWabaId.keys()],
    selectedCatalogIds: parsed.data.catalog_ids,
  });
  createdSources.push(...await upsertMetaCatalogSources({
    req,
    catalogs: linkedCatalogs,
    channelAccountIdByWabaId: selectedWhatsappChannelIdByWabaId,
    connectedAt,
  }));

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

  const autoSyncResults = await autoSyncCreatedCatalogSources(
    createdSources,
    syncCatalogSource,
    (source, err) => req.log?.warn({ err, sourceId: source.id }, "Auto sync failed for newly connected catalog source"),
  );

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
      syncStatus: autoSyncResults.get(source.id)?.status ?? source.syncStatus,
      syncResult: autoSyncResults.get(source.id) ?? null,
    })),
  });
});

export default router;
