import { Router, type Request, type Response, type NextFunction } from "express";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { aiAgentChannelsTable, aiAgentInstructionsTable, aiAgentsTable, catalogSourcesTable, channelAccountsTable, db, featureFlagsTable, metaMobileSignupAttemptsTable, pool, workspacesTable } from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { logger } from "../../lib/logger";
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
import { resolveCredentialsSecretRef } from "../../services/meta-whatsapp-business-profile";
import { autoSyncCreatedCatalogSources, resolveCatalogsForSelectedWabas } from "./catalog-auto-sync";

const router = Router();
// الحارس على مستوى الراوتر — مع استثناء واحد: مسار عودة OAuth للجوال. كان router.use(requireSession)
// المطلق يرد 401 قبل أن يصل الطلب لمعالج العودة إطلاقاً (اكتُشف بالسجلات 12 يوليو: العودة تصل بكود
// صالح لكن حارس الجلسة يرفضها لأن كوكي الجلسة يضيع على الجوال). عودة الجوال تصادق عبر nonce الحالة
// لا الجلسة؛ نتجاوز الحارس لها فقط، مع إرفاق sessionUser إن وُجدت جلسة (مسار سطح المكتب + تحسين
// نفس المتصفح)، والمعالج نفسه يعيد فرض 401 على مسار سطح المكتب عديم الجلسة.
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.endsWith("/meta/embedded-signup/callback")) {
    if (req.session?.user) (req as AuthenticatedRequest).sessionUser = req.session.user;
    next();
    return;
  }
  requireSession(req, res, next);
});

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

type MetaMobileConfigKey = "whatsapp_standard" | "whatsapp_coexistence";
type MetaMobileReturnTo = "/onboarding" | "/integrations";

type MetaWhatsAppRedirectState = {
  nonce: string;
  signupAttemptId: string;
  userId: string;
  workspaceId: string;
  configKey: MetaMobileConfigKey;
  configId: string;
  returnTo: MetaMobileReturnTo;
  createdAt: number;
  expiresAt: number;
};

type MetaMobileRedirectResult = {
  userId: string;
  workspaceId: string;
  signupAttemptId: string;
  returnTo: MetaMobileReturnTo;
  channelAccountId: string;
  createdAt: number;
  expiresAt: number;
};

class MetaChannelConflictError extends Error {
  readonly status = 409;
  constructor(readonly code: "phone_number_linked_to_another_workspace") {
    super(code);
  }
}

export async function assertWhatsAppPhoneAvailableForWorkspace(workspaceId: string, lookupCondition: ReturnType<typeof providerLookupCondition>) {
  const [otherWorkspaceAccount] = await db
    .select({ id: channelAccountsTable.id })
    .from(channelAccountsTable)
    .where(and(
      sql`${channelAccountsTable.workspaceId} <> ${workspaceId}`,
      inArray(channelAccountsTable.channelType, ["whatsapp", "whatsapp_api"]),
      eq(channelAccountsTable.status, "active"),
      lookupCondition,
    ))
    .limit(1);
  if (otherWorkspaceAccount) {
    throw new MetaChannelConflictError("phone_number_linked_to_another_workspace");
  }
}

type MetaMobileSessionContext = {
  signupAttemptId: string;
  configKey: MetaMobileConfigKey;
  returnTo: MetaMobileReturnTo;
  expiresAt: number;
  claimToken: string;
};

function metaMobileRedirectEnabled() {
  return process.env.META_MOBILE_REDIRECT_ENABLED?.trim().toLowerCase() === "true";
}

function configuredMobileConfigId(configKey: MetaMobileConfigKey) {
  return configKey === "whatsapp_standard"
    ? process.env.META_WHATSAPP_STANDARD_CONFIG_ID?.trim()
    : process.env.META_WHATSAPP_COEXISTENCE_CONFIG_ID?.trim();
}

function mobileEmbeddedSignupExtras(configKey: MetaMobileConfigKey) {
  return configKey === "whatsapp_coexistence"
    ? {
        setup: {},
        featureType: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3",
        version: "v4",
      }
    : {
        sessionInfoVersion: "3",
        version: "v4",
      };
}

function saveSession(req: AuthenticatedRequest) {
  return new Promise<void>((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

type MobileAttemptClaim = {
  outcome: "claimed" | "completed" | "busy" | "invalid";
  claimToken?: string;
  encryptedTokenRef?: string | null;
  checkpoint?: string;
};

function nonceHash(nonce: string) {
  return createHash("sha256").update(nonce).digest("hex");
}

async function createMetaMobileAttempt(state: MetaWhatsAppRedirectState) {
  await pool.query(`
    INSERT INTO meta_mobile_signup_attempts
      (signup_attempt_id, nonce_hash, user_id, workspace_id, config_key, config_id, return_to, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [state.signupAttemptId, nonceHash(state.nonce), state.userId, state.workspaceId, state.configKey, state.configId, state.returnTo, new Date(state.expiresAt)]);
}

// تحميل محاولة الجوال بهوية كاملة عبر nonce الـstate وحده — أساس نقطة العودة العديمة الجلسة
// (12 يوليو): user/workspace يؤخذان من الصف المربوط عند البدء بجلسة موثّقة، لا من كوكي قد يضيع.
type MobileAttemptIdentity = {
  signupAttemptId: string;
  userId: string;
  workspaceId: string;
  configKey: MetaMobileConfigKey;
  returnTo: string;
  expiresAtMs: number;
};

async function loadMobileAttemptByNonce(nonce: string): Promise<MobileAttemptIdentity | null> {
  if (!nonce) return null;
  const { rows } = await pool.query<{
    signup_attempt_id: string;
    user_id: string;
    workspace_id: string;
    config_key: string;
    return_to: string;
    expires_ms: string | number;
  }>(`
    SELECT signup_attempt_id, user_id, workspace_id, config_key, return_to,
           (EXTRACT(EPOCH FROM expires_at) * 1000)::bigint AS expires_ms,
           (expires_at <= NOW()) AS is_expired
    FROM meta_mobile_signup_attempts
    WHERE nonce_hash = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [nonceHash(nonce)]);
  const row = rows[0] as (typeof rows)[number] & { is_expired?: boolean } | undefined;
  // تشخيص حادثة 12 يوليو: العودة تصل بكود صالح لكن الصف لا يُوجد → 401. نسجّل بصمة الـhash
  // وعدد الصفوف وحالة الصلاحية لنميّز بين (لا صف إطلاقاً = خلل إدراج/تطابق) و(صف منتهي).
  logger.info({
    nonceHashPrefix: nonceHash(nonce).slice(0, 12),
    matchedRows: rows.length,
    isExpired: row?.is_expired ?? null,
  }, "Meta mobile signup attempt lookup by nonce");
  if (!row || row.is_expired) return null;
  return {
    signupAttemptId: row.signup_attempt_id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    configKey: row.config_key as MetaMobileConfigKey,
    returnTo: row.return_to || "/dashboard",
    expiresAtMs: Number(row.expires_ms),
  };
}

export async function claimMetaMobileRedirectCallback(params: {
  workspaceId: string;
  userId: string;
  signupAttemptId: string;
  nonce: string;
}): Promise<MobileAttemptClaim> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<{
      status: string;
      checkpoint: string;
      lease_expires_at: Date | null;
      encrypted_token_ref: string | null;
    }>(`
      SELECT status, checkpoint, lease_expires_at, encrypted_token_ref
      FROM meta_mobile_signup_attempts
      WHERE signup_attempt_id = $1 AND workspace_id = $2 AND user_id = $3
        AND nonce_hash = $4 AND expires_at > NOW()
      FOR UPDATE
    `, [params.signupAttemptId, params.workspaceId, params.userId, nonceHash(params.nonce)]);
    const attempt = selected.rows[0];
    if (!attempt) {
      await client.query("ROLLBACK");
      return { outcome: "invalid" };
    }
    if (attempt.status === "completed") {
      await client.query("COMMIT");
      return { outcome: "completed", checkpoint: attempt.checkpoint };
    }
    if (attempt.status === "processing" && attempt.lease_expires_at && attempt.lease_expires_at.getTime() > Date.now()) {
      await client.query("COMMIT");
      return { outcome: "busy", checkpoint: attempt.checkpoint };
    }
    const claimToken = randomBytes(18).toString("hex");
    await client.query(`
      UPDATE meta_mobile_signup_attempts
      SET status = 'processing', claim_token = $1, claimed_at = NOW(),
          lease_expires_at = NOW() + INTERVAL '5 minutes', retry_count = retry_count + 1,
          last_error_code = NULL, updated_at = NOW()
      WHERE signup_attempt_id = $2
    `, [claimToken, params.signupAttemptId]);
    await client.query("COMMIT");
    return {
      outcome: "claimed",
      claimToken,
      encryptedTokenRef: attempt.encrypted_token_ref,
      checkpoint: attempt.checkpoint,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateMobileAttempt(params: {
  signupAttemptId: string;
  claimToken: string;
  status: "processing" | "failed_retryable" | "failed_terminal";
  checkpoint: string;
  encryptedTokenRef?: string;
  lastErrorCode?: string;
}) {
  await pool.query(`
    UPDATE meta_mobile_signup_attempts
    SET status = $1, checkpoint = $2,
        encrypted_token_ref = COALESCE($3, encrypted_token_ref),
        last_error_code = $4,
        lease_expires_at = CASE WHEN $1 = 'processing' THEN NOW() + INTERVAL '5 minutes' ELSE NULL END,
        updated_at = NOW()
    WHERE signup_attempt_id = $5 AND claim_token = $6
  `, [params.status, params.checkpoint, params.encryptedTokenRef ?? null, params.lastErrorCode ?? null, params.signupAttemptId, params.claimToken]);
}

export async function ensureAutoAgentChannel(workspaceId: string, agentId: string, channelAccountId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `ai-agent-channel:${workspaceId}:${agentId}:${channelAccountId}`,
    ]);
    const updated = await client.query(`
      UPDATE ai_agent_channels
      SET mode = 'auto', updated_at = NOW()
      WHERE workspace_id = $1 AND agent_id = $2 AND channel_account_id = $3
      RETURNING id
    `, [workspaceId, agentId, channelAccountId]);
    if (updated.rowCount === 0) {
      await client.query(`
        INSERT INTO ai_agent_channels (workspace_id, agent_id, channel_account_id, mode)
        VALUES ($1, $2, $3, 'auto')
      `, [workspaceId, agentId, channelAccountId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

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
  if (!response.ok) {
    // تشخيص 12 يوليو: كان الخطأ يحمل رقم الحالة فقط — فتعذّر معرفة أي edge فشل ولماذا. نُضمّن
    // المسار (edge) وجسم خطأ ميتا (رمز/رسالة الخطأ — لا يحمل توكناً) لنكشف السبب الدقيق (صلاحية
    // ناقصة، edge غير مدعوم لتوكن التعايش، معرّف خاطئ). نقتطع المسار قبل أي «?» لئلا نسرّب باراميترات.
    const body = await response.text().catch(() => "");
    const safePath = path.split("?")[0];
    throw new Error(`Meta Graph API returned ${response.status} for ${safePath}: ${body.slice(0, 400)}`);
  }
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
  if (!response.ok) {
    // نقرأ جسم خطأ ميتا لنعرف السبب الدقيق (code مُستهلك، redirect_uri، صلاحية) بدل رقم حالة مجرّد.
    // بلا أسرار: جسم خطأ OAuth من ميتا لا يحمل توكناً، فقط رسالة/رمز الخطأ.
    const body = await response.text().catch(() => "");
    throw new Error(`Meta OAuth exchange returned ${response.status}: ${body.slice(0, 300)}`);
  }
  const payload: any = await response.json();
  // 6 يوليو 2026: عميل حقيقي أخذ 409 (meta_token_exchange_unavailable) ثلاث مرات متتالية —
  // هذا الفرع كان يُسقط رسالة خطأ Meta الفعلية (غالباً code إعادة استخدام أو رفض صلاحية)
  // بصمت، فتعذّر معرفة السبب الحقيقي. نُسجّل حقول الخطأ فقط (لا access_token أبداً).
  if (typeof payload.access_token !== "string") {
    req.log?.warn({
      metaErrorCode: payload?.error?.code ?? null,
      metaErrorSubcode: payload?.error?.error_subcode ?? null,
      metaErrorType: payload?.error?.type ?? null,
    }, "Meta OAuth exchange returned 200 without access_token");
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

const metaWhatsAppRedirectStartSchema = z.object({
  configKey: z.enum(["whatsapp_standard", "whatsapp_coexistence"]),
  configId: z.string().trim().min(1),
  returnTo: z.enum(["/onboarding", "/integrations"]),
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

// سياق الوكيل الحي من ميتا (الطور 2 — 11 يوليو 2026): حتى الآن لا يوجد أي مصدر page_posts
// يُنشأ عند الربط — فمنشورات الصفحة/حساب إنستغرام لا تصل الوكيل الحيّ أبداً مهما مضى الوقت.
// كل صفحة فيسبوك أو حساب إنستغرام مختار يحصل الآن على مصدر page_posts فور الربط (نفس نمط
// onConflictDoUpdate + سجل تدقيق catalog_source_create المستخدم في مصادر الإعلانات أدناه)،
// فيلتقطه autoSyncCreatedCatalogSources للمزامنة الفورية (انظر catalog-auto-sync.ts).
async function upsertMetaPagePostsSource(params: {
  req: AuthenticatedRequest;
  channelAccountId: string;
  externalId: string;
  name: string;
  platform: "facebook" | "instagram";
  connectedAt: string;
}): Promise<typeof catalogSourcesTable.$inferSelect> {
  const config = { provider: "meta", platform: params.platform, connectedAt: params.connectedAt };
  const [source] = await db.insert(catalogSourcesTable).values({
    workspaceId: params.req.sessionUser.activeWorkspaceId,
    channelAccountId: params.channelAccountId,
    sourceType: "page_posts",
    externalId: params.externalId,
    name: params.name,
    status: "active",
    config,
  }).onConflictDoUpdate({
    target: [catalogSourcesTable.workspaceId, catalogSourcesTable.sourceType, catalogSourcesTable.externalId],
    set: {
      name: params.name,
      channelAccountId: params.channelAccountId,
      config,
      status: "active",
      updatedAt: new Date(),
    },
  }).returning();

  await createAuditLog({
    ...auditFromRequest(params.req, params.req.sessionUser),
    action: "catalog_source_create",
    severity: "info",
    entityType: "catalog_source",
    entityId: source.id,
    entityLabel: source.name,
    newData: { sourceType: source.sourceType, externalId: source.externalId, provider: "meta" },
  });

  return source;
}

function currentMetaSession(req: AuthenticatedRequest): {
  options: MetaChannelOptions;
  tokenRefs: MetaTokenRefs;
  mobileContext?: MetaMobileSessionContext;
} {
  const stored = (req.session as any).metaChannelOptions;
  if (stored?.workspaceId === req.sessionUser.activeWorkspaceId && Date.now() - stored.createdAt < 30 * 60_000) {
    return {
      options: stored.options,
      tokenRefs: stored.tokenRefs ?? { pageTokenRefs: {} },
      mobileContext: stored.mobileContext,
    };
  }
  return fallbackMetaOptions();
}

// معرّفات WABA الممنوحة تُستخرج من صلاحيات التوكن الدقيقة (debug_token) لا من me/businesses:
// توكن التسجيل المضمّن (تعايش/قياسي) يمنح whatsapp_business_management للـWABA الممنوح فقط، بلا
// business_management — فـ me/businesses يرد «(#100) Missing Permission» ويُجهض الربط (حادثة 12
// يوليو، السبب الجذري لعدم ربط الجوال). granular_scopes.target_ids هي معرّفات WABA مباشرة.
async function discoverGrantedWabaIds(userToken: string): Promise<string[]> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return [];
  const url = new URL(`https://graph.facebook.com/${requireMetaGraphVersion()}/debug_token`);
  url.searchParams.set("input_token", userToken);
  url.searchParams.set("access_token", `${appId}|${appSecret}`);
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Meta debug_token returned ${response.status}: ${body.slice(0, 300)}`);
  }
  const payload: any = await response.json();
  const scopes: any[] = payload?.data?.granular_scopes ?? [];
  const wabaIds = new Set<string>();
  for (const scope of scopes) {
    if (scope?.scope === "whatsapp_business_management" || scope?.scope === "whatsapp_business_messaging") {
      for (const targetId of scope?.target_ids ?? []) if (targetId) wabaIds.add(String(targetId));
    }
  }
  return [...wabaIds];
}

async function fetchMetaWhatsAppOptions(userToken: string): Promise<{ options: MetaChannelOptions; tokenRefs: MetaTokenRefs }> {
  const wabaIds = await discoverGrantedWabaIds(userToken);
  const whatsappAccounts: MetaChannelOptions["whatsapp_accounts"] = [];
  const commerceCatalogs: MetaChannelOptions["commerce_catalogs"] = [];
  for (const wabaId of wabaIds) {
    // التوكن يملك whatsapp_business_management لهذا الـWABA تحديداً → قراءته مباشرةً مسموحة.
    // owner_business_info أفضل جهد (لتعبئة business_id)؛ إن نقصت صلاحيته لا يُجهض الربط.
    let waba: any;
    try {
      waba = await callMetaGraph(
        `${wabaId}?fields=id,name,phone_numbers{id,display_phone_number,verified_name},owner_business_info{id,name}`,
        userToken,
      );
    } catch (err) {
      logger.warn({ wabaId, err: err instanceof Error ? err.message : String(err) }, "WABA detail fetch failed; retrying without business info");
      // إعادة محاولة بالحقول الأساسية فقط (الرقم هو المطلوب) — قد يكون owner_business_info هو المرفوض.
      waba = await callMetaGraph(`${wabaId}?fields=id,name,phone_numbers{id,display_phone_number,verified_name}`, userToken);
    }
    const businessId = String(waba?.owner_business_info?.id ?? "");
    whatsappAccounts.push({
      waba_id: String(waba?.id ?? wabaId),
      business_id: businessId,
      name: String(waba?.name ?? waba?.owner_business_info?.name ?? "WhatsApp Business"),
      phone_numbers: (waba?.phone_numbers?.data ?? []).map((phone: any) => ({
        phone_number_id: String(phone.id),
        display_number: String(phone.display_phone_number ?? ""),
        verified_name: phone.verified_name ? String(phone.verified_name) : undefined,
      })),
    });
    // جلب الكتالوج ثانوي بحت — ربط الرقم هو الهدف. فشله يجب ألا يُجهض ربط واتساب.
    try {
      for (const catalog of await fetchWabaProductCatalogs(wabaId, userToken, businessId)) {
        pushUniqueMetaCatalog(commerceCatalogs, catalog);
      }
    } catch (err) {
      logger.warn({ wabaId, err: err instanceof Error ? err.message : String(err) }, "WABA catalog discovery failed; continuing without catalogs");
    }
  }
  return {
    options: {
      whatsapp_accounts: whatsappAccounts,
      facebook_pages: [],
      instagram_accounts: [],
      commerce_catalogs: commerceCatalogs,
      ad_accounts: [],
    },
    tokenRefs: {
      userTokenRef: encryptedTokenRef(userToken) ?? undefined,
      pageTokenRefs: {},
    },
  };
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
  externalAccountId?: string | null;
  externalBusinessId?: string | null;
  externalPhoneId?: string | null;
  ensureAutoAgent?: boolean;
}) {
  const lookupCondition = providerLookupCondition(params.lookupKey, params.lookupValue);

  if (params.channelType === "whatsapp") {
    await assertWhatsAppPhoneAvailableForWorkspace(params.req.sessionUser.activeWorkspaceId, lookupCondition);
  }

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
    // W6-T1: نفس المبدأ عُمِّم على إنستغرام/ماسنجر (externalAccountId = igAccountId/pageId).
    ...(params.externalAccountId !== undefined ? { externalAccountId: params.externalAccountId } : {}),
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

  if (params.ensureAutoAgent && account.defaultAgentId) {
    await ensureAutoAgentChannel(params.req.sessionUser.activeWorkspaceId, account.defaultAgentId, account.id);
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
        eq(channelAccountsTable.workspaceId, params.req.sessionUser.activeWorkspaceId),
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

async function subscribeMobileWhatsAppAccounts(
  req: AuthenticatedRequest,
  accounts: MetaChannelOptions["whatsapp_accounts"],
  userToken: string,
  signupAttemptId: string,
) {
  for (const account of accounts) {
    await postMetaGraph(`${account.waba_id}/subscribed_apps`, userToken);
  }
  req.log?.info({ signupAttemptId, accountCount: accounts.length }, "Meta mobile signup WABA subscriptions completed");
}

async function connectMobileWhatsAppPhone(params: {
  req: AuthenticatedRequest;
  account: MetaChannelOptions["whatsapp_accounts"][number];
  phone: MetaPhoneNumber;
  tokenRef: string;
  userToken: string;
  configKey: MetaMobileConfigKey;
  signupAttemptId: string;
}) {
  if (params.configKey === "whatsapp_standard") {
    try {
      await postMetaGraph(`${params.phone.phone_number_id}/register`, params.userToken, {
        messaging_product: "whatsapp",
        pin: "000000",
      });
    } catch (err) {
      params.req.log?.warn({ err, signupAttemptId: params.signupAttemptId }, "Meta mobile signup phone registration failed; continuing");
    }
  }

  const connectedAt = new Date().toISOString();
  return upsertMetaChannelAccount({
    req: params.req,
    channelType: "whatsapp",
    name: `whatsapp-${params.phone.phone_number_id}`,
    displayName: params.phone.display_number
      ? `WhatsApp ${params.phone.display_number}`
      : `WhatsApp ${params.phone.phone_number_id}`,
    providerConfig: {
      provider: "meta",
      business_id: params.account.business_id ?? null,
      meta_app_id: process.env.META_APP_ID ?? null,
      waba_id: params.account.waba_id,
      phone_number_id: params.phone.phone_number_id,
      display_number: params.phone.display_number,
      verified_name: params.phone.verified_name,
      wabaId: params.account.waba_id,
      phoneNumberId: params.phone.phone_number_id,
      displayPhoneNumber: params.phone.display_number,
      verifiedName: params.phone.verified_name,
      embeddedSignup: true,
      configKey: params.configKey,
      connectedAt,
    },
    lookupKey: "phoneNumberId",
    lookupValue: params.phone.phone_number_id,
    credentialsSecretRef: params.tokenRef,
    externalBusinessId: params.account.waba_id,
    externalPhoneId: params.phone.phone_number_id,
    ensureAutoAgent: true,
  });
}

// حادثة «المزامنة الكاذبة» (12 يوليو 2026): مسار ربط الجوال كان يربط القناة **بدون** أي إنشاء
// لمصادر الكتالوج — عكس مسار الكمبيوتر تماماً (الذي يكتشف كتالوجات الـWABA ويُنشئ مصادرها
// ويزامنها فوراً منذ 4 يوليو). النتيجة: كل تاجر يربط رقمه من الجوال يبقى كتالوجه يتيماً
// إلى الأبد ولا منتج واحد يصل مخزونه. هذه الدالة تعوّض ذلك بنفس تسلسل الكمبيوتر، لكن بهوية
// صريحة (workspaceId/userId من صف المحاولة) لأن نقطة عودة الجوال تعمل بلا جلسة. فشلها
// لا يفشل الربط أبداً — الكتالوج قابل للاسترداد لاحقاً بزر «البحث عن كتالوجات مرتبطة».
async function attachMobileWhatsAppCatalogs(params: {
  workspaceId: string;
  userId: string;
  channelAccountId: string;
  wabaId: string;
  businessId: string | null;
  userToken: string;
  signupAttemptId: string;
  log?: { info?: (obj: unknown, msg?: string) => void; warn?: (obj: unknown, msg?: string) => void };
}): Promise<void> {
  try {
    const catalogs = await fetchWabaProductCatalogs(params.wabaId, params.userToken, params.businessId ?? undefined);
    if (catalogs.length === 0) {
      params.log?.info?.({ signupAttemptId: params.signupAttemptId, wabaId: params.wabaId }, "Mobile signup: no WABA-linked catalogs found at connect");
      return;
    }
    const connectedAt = new Date().toISOString();
    const createdSources: Array<typeof catalogSourcesTable.$inferSelect> = [];
    for (const catalog of catalogs) {
      const [source] = await db.insert(catalogSourcesTable).values({
        workspaceId: params.workspaceId,
        channelAccountId: params.channelAccountId,
        sourceType: "commerce_catalog",
        externalId: catalog.catalog_id,
        name: catalog.name || catalog.catalog_id,
        status: "active",
        config: { provider: "meta", business_id: catalog.business_id ?? null, waba_id: params.wabaId, connectedAt },
      }).onConflictDoUpdate({
        target: [catalogSourcesTable.workspaceId, catalogSourcesTable.sourceType, catalogSourcesTable.externalId],
        set: {
          name: catalog.name || catalog.catalog_id,
          channelAccountId: params.channelAccountId,
          config: { provider: "meta", business_id: catalog.business_id ?? null, waba_id: params.wabaId, connectedAt },
          status: "active",
          updatedAt: new Date(),
        },
      }).returning();
      createdSources.push(source);
      await createAuditLog({
        workspaceId: params.workspaceId,
        actorType: "user",
        actorId: params.userId,
        action: "catalog_source_create",
        severity: "info",
        entityType: "catalog_source",
        entityId: source.id,
        entityLabel: source.name,
        newData: { sourceType: source.sourceType, externalId: source.externalId, provider: "meta", mobileSignup: true },
      });
    }
    const results = await autoSyncCreatedCatalogSources(
      createdSources,
      syncCatalogSource,
      (source, err) => params.log?.warn?.({ err, sourceId: source.id, signupAttemptId: params.signupAttemptId }, "Auto sync failed for mobile signup catalog source"),
    );
    params.log?.info?.(
      { signupAttemptId: params.signupAttemptId, catalogs: createdSources.length, synced: [...results.values()].reduce((sum, r) => sum + r.itemsSynced, 0) },
      "Mobile signup: WABA catalogs attached and synced",
    );
  } catch (err) {
    params.log?.warn?.({ err, signupAttemptId: params.signupAttemptId, wabaId: params.wabaId }, "Mobile signup catalog attach failed — channel connect unaffected");
  }
}

async function finalizeMobileWhatsAppConnection(params: {
  // هوية صريحة من صف المحاولة (لا من req.sessionUser): نقطة العودة تعمل بلا جلسة (12 يوليو).
  workspaceId: string;
  userId: string;
  account: MetaChannelOptions["whatsapp_accounts"][number];
  phone: MetaPhoneNumber;
  tokenRef: string;
  configKey: MetaMobileConfigKey;
  signupAttemptId: string;
  claimToken: string;
}) {
  const workspaceId = params.workspaceId;
  const userId = params.userId;
  const lookupCondition = providerLookupCondition("phoneNumberId", params.phone.phone_number_id);
  const connectedAt = new Date().toISOString();

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`meta-mobile-finalize:${params.signupAttemptId}`}, 0))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-phone:${workspaceId}:${params.phone.phone_number_id}`}, 0))`);

    const [foreignAccount] = await tx
      .select({ id: channelAccountsTable.id })
      .from(channelAccountsTable)
      .where(and(
        sql`${channelAccountsTable.workspaceId} <> ${workspaceId}`,
        inArray(channelAccountsTable.channelType, ["whatsapp", "whatsapp_api"]),
        eq(channelAccountsTable.status, "active"),
        lookupCondition,
      ))
      .limit(1);
    if (foreignAccount) throw new MetaChannelConflictError("phone_number_linked_to_another_workspace");

    const [existing] = await tx
      .select()
      .from(channelAccountsTable)
      .where(and(
        eq(channelAccountsTable.workspaceId, workspaceId),
        inArray(channelAccountsTable.channelType, ["whatsapp", "whatsapp_api"]),
        lookupCondition,
      ))
      .limit(1);

    const channelValues = {
      workspaceId,
      channelType: "whatsapp" as const,
      name: `whatsapp-${params.phone.phone_number_id}`,
      displayName: params.phone.display_number ? `WhatsApp ${params.phone.display_number}` : `WhatsApp ${params.phone.phone_number_id}`,
      status: "active",
      providerConfig: {
        provider: "meta",
        business_id: params.account.business_id ?? null,
        meta_app_id: process.env.META_APP_ID ?? null,
        waba_id: params.account.waba_id,
        phone_number_id: params.phone.phone_number_id,
        display_number: params.phone.display_number,
        verified_name: params.phone.verified_name,
        wabaId: params.account.waba_id,
        phoneNumberId: params.phone.phone_number_id,
        displayPhoneNumber: params.phone.display_number,
        verifiedName: params.phone.verified_name,
        embeddedSignup: true,
        configKey: params.configKey,
        connectedAt,
      },
      credentialsSecretRef: params.tokenRef,
      externalBusinessId: params.account.waba_id,
      externalPhoneId: params.phone.phone_number_id,
      createdBy: userId,
      updatedAt: new Date(),
    };
    let [channel] = existing
      ? await tx.update(channelAccountsTable).set(channelValues).where(and(eq(channelAccountsTable.id, existing.id), eq(channelAccountsTable.workspaceId, workspaceId))).returning()
      : await tx.insert(channelAccountsTable).values(channelValues).returning();

    await tx.update(channelAccountsTable).set({
      status: "disabled",
      providerConfig: null,
      credentialsSecretRef: null,
      externalBusinessId: null,
      externalPhoneId: null,
      updatedAt: new Date(),
    }).where(and(
      eq(channelAccountsTable.workspaceId, workspaceId),
      sql`${channelAccountsTable.id} <> ${channel.id}`,
      inArray(channelAccountsTable.channelType, ["whatsapp", "whatsapp_api"]),
      lookupCondition,
    ));

    let agentId = channel.defaultAgentId;
    if (agentId) {
      const [validAgent] = await tx.select({ id: aiAgentsTable.id }).from(aiAgentsTable).where(and(
        eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.workspaceId, workspaceId), eq(aiAgentsTable.status, "active"),
      )).limit(1);
      if (!validAgent) agentId = null;
    }
    if (!agentId) {
      const [activeAgent] = await tx.select({ id: aiAgentsTable.id }).from(aiAgentsTable).where(and(
        eq(aiAgentsTable.workspaceId, workspaceId), eq(aiAgentsTable.status, "active"),
      )).orderBy(desc(aiAgentsTable.updatedAt), desc(aiAgentsTable.createdAt)).limit(1);
      agentId = activeAgent?.id ?? null;
    }
    if (!agentId) {
      const [createdAgent] = await tx.insert(aiAgentsTable).values({
        workspaceId,
        name: "وكيل وصال",
        type: "support",
        status: "active",
        defaultModel: "gemini_flash",
        dialect: "standard_arabic",
        createdBy: userId,
      }).returning({ id: aiAgentsTable.id });
      agentId = createdAgent.id;
      await tx.insert(aiAgentInstructionsTable).values({
        workspaceId,
        agentId,
        rolePrompt: "أنت موظف مبيعات وخدمة عملاء ودود ومحترف، تجيب بوضوح وفق معلومات النشاط.",
      });
    }

    [channel] = await tx.update(channelAccountsTable)
      .set({ defaultAgentId: agentId, updatedAt: new Date() })
      .where(and(eq(channelAccountsTable.id, channel.id), eq(channelAccountsTable.workspaceId, workspaceId)))
      .returning();

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-agent-channel:${workspaceId}:${agentId}:${channel.id}`}, 0))`);
    const [agentChannel] = await tx.select({ id: aiAgentChannelsTable.id }).from(aiAgentChannelsTable).where(and(
      eq(aiAgentChannelsTable.workspaceId, workspaceId),
      eq(aiAgentChannelsTable.agentId, agentId),
      eq(aiAgentChannelsTable.channelAccountId, channel.id),
    )).limit(1);
    if (agentChannel) {
      await tx.update(aiAgentChannelsTable).set({ mode: "auto", updatedAt: new Date() }).where(eq(aiAgentChannelsTable.id, agentChannel.id));
      await tx.delete(aiAgentChannelsTable).where(and(
        eq(aiAgentChannelsTable.workspaceId, workspaceId),
        eq(aiAgentChannelsTable.agentId, agentId),
        eq(aiAgentChannelsTable.channelAccountId, channel.id),
        sql`${aiAgentChannelsTable.id} <> ${agentChannel.id}`,
      ));
    } else {
      await tx.insert(aiAgentChannelsTable).values({ workspaceId, agentId, channelAccountId: channel.id, mode: "auto" });
    }

    for (const flagKey of ["whatsapp_api_enabled", "ai_auto_send"]) {
      await tx.insert(featureFlagsTable).values({ workspaceId, flagKey, isEnabled: true, config: {} }).onConflictDoUpdate({
        target: [featureFlagsTable.workspaceId, featureFlagsTable.flagKey],
        set: { isEnabled: true },
      });
    }

    const [workspace] = await tx.select({ settings: workspacesTable.settings }).from(workspacesTable).where(eq(workspacesTable.id, workspaceId)).limit(1);
    const currentSettings = workspace?.settings && typeof workspace.settings === "object" && !Array.isArray(workspace.settings)
      ? workspace.settings as Record<string, unknown>
      : {};
    await tx.update(workspacesTable).set({ settings: { ...currentSettings, onboarding_completed: true }, updatedAt: new Date() }).where(eq(workspacesTable.id, workspaceId));

    const [completedAttempt] = await tx.update(metaMobileSignupAttemptsTable).set({
      status: "completed",
      checkpoint: "completed",
      channelAccountId: channel.id,
      resultReady: true,
      completedAt: new Date(),
      leaseExpiresAt: null,
      encryptedTokenRef: null,
      updatedAt: new Date(),
    }).where(and(
      eq(metaMobileSignupAttemptsTable.signupAttemptId, params.signupAttemptId),
      eq(metaMobileSignupAttemptsTable.claimToken, params.claimToken),
    )).returning({ id: metaMobileSignupAttemptsTable.id });
    if (!completedAttempt) throw new Error("meta_mobile_attempt_claim_lost");
    return channel;
  });
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
    externalAccountId: params.igAccountId,
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
    externalAccountId: params.pageId,
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
    mobileRedirectEnabled: metaMobileRedirectEnabled(),
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

router.get("/meta/embedded-signup/whatsapp/redirect/start", requirePermission("integrations:update"), async (req: AuthenticatedRequest, res: Response) => {
  if (!metaMobileRedirectEnabled()) {
    res.status(404).json({ enabled: false, code: "meta_mobile_redirect_disabled" });
    return;
  }

  const parsed = metaWhatsAppRedirectStartSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات تحويل واتساب غير صالحة", code: "invalid_mobile_redirect_request" });
    return;
  }

  const appId = process.env.META_APP_ID?.trim();
  const graphVersion = process.env.META_GRAPH_VERSION?.trim();
  const expectedConfigId = configuredMobileConfigId(parsed.data.configKey);
  if (!appId || !graphVersion || !expectedConfigId) {
    res.status(409).json({ error: "إعدادات Meta غير مكتملة", code: "meta_mobile_redirect_config_missing" });
    return;
  }
  if (parsed.data.configId !== expectedConfigId) {
    res.status(400).json({ error: "إعداد التسجيل المضمن غير معروف", code: "unknown_meta_signup_config" });
    return;
  }

  const now = Date.now();
  const pending: MetaWhatsAppRedirectState = {
    nonce: randomBytes(24).toString("hex"),
    signupAttemptId: randomBytes(12).toString("hex"),
    userId: req.sessionUser.userId,
    workspaceId: req.sessionUser.activeWorkspaceId,
    configKey: parsed.data.configKey,
    configId: expectedConfigId,
    returnTo: parsed.data.returnTo,
    createdAt: now,
    // 12 يوليو: كانت 15 دقيقة — أقصر بكثير من رحلة تسجيل مضمّن حقيقية على الجوال (فتح تطبيق
    // فيسبوك، اختيار الأصل والرقم، OTP، أحياناً حذف/إعادة تثبيت التطبيق). سابقة موثّقة: عميل
    // احتاج 44 دقيقة متواصلة. نافذة منتهية = العودة تصل بكود صالح فلا تجد صف محاولتها → 401.
    // ساعتان تطابق فلسفة المرجع (بلا مهلة عملياً)؛ الصف يُنظَّف لاحقاً عبر expires_at أياً كان.
    expiresAt: now + 120 * 60_000,
  };
  (req.session as any).metaWhatsAppRedirectState = pending;
  await createMetaMobileAttempt(pending);
  // تشخيص 12 يوليو: نبصم hash الـnonce المكتوب لنقارنه ببصمة البحث عند العودة (يكشف تحوير state).
  logger.info({ nonceHashPrefix: nonceHash(pending.nonce).slice(0, 12), signupAttemptId: pending.signupAttemptId }, "Meta mobile signup attempt row created");

  // FB.login sends these same Embedded Signup parameters to dialog/oauth. The only change is
  // replacing the opener callback with this server callback so mobile tab separation cannot lose it.
  const url = new URL(`https://www.facebook.com/${graphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", metaRedirectUri(req));
  url.searchParams.set("state", pending.nonce);
  url.searchParams.set("config_id", pending.configId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("override_default_response_type", "true");
  url.searchParams.set("extras", JSON.stringify(mobileEmbeddedSignupExtras(pending.configKey)));

  await saveSession(req);
  req.log?.info({
    signupAttemptId: pending.signupAttemptId,
    configKey: pending.configKey,
    returnTo: pending.returnTo,
    expiresAt: new Date(pending.expiresAt).toISOString(),
  }, "Meta mobile signup redirect started");
  res.json({
    enabled: true,
    url: url.toString(),
    signupAttemptId: pending.signupAttemptId,
    expiresAt: new Date(pending.expiresAt).toISOString(),
  });
});

router.get("/meta/embedded-signup/mobile-redirect/result", requirePermission("integrations:update"), async (req: AuthenticatedRequest, res: Response) => {
  if (!metaMobileRedirectEnabled()) {
    res.status(404).json({ enabled: false, code: "meta_mobile_redirect_disabled" });
    return;
  }
  // قاعدة البيانات هي الحكم (12 يوليو): كانت النتيجة مرهونة بكتابة جلسة يجريها الـcallback —
  // الذي قد يهبط في متصفح آخر بلا جلسة أصلاً (تطبيق فيسبوك/تبويب جديد) فلا يعرف التبويبُ
  // الأصلي المسجَّل أبداً أن الربط اكتمل. الآن: الصف المكتمل لهذا المستخدم/المساحة يكفي.
  const sessionResult = (req.session as any).metaMobileRedirectResult as MetaMobileRedirectResult | undefined;
  const signupAttemptId = String(req.query.signupAttemptId ?? "") || sessionResult?.signupAttemptId || "";
  const result = signupAttemptId ? await pool.query<{ signup_attempt_id: string; return_to: string }>(`
    SELECT signup_attempt_id, return_to FROM meta_mobile_signup_attempts
    WHERE signup_attempt_id = $1 AND workspace_id = $2 AND user_id = $3
      AND status = 'completed' AND result_ready = true AND expires_at > NOW()
  `, [signupAttemptId, req.sessionUser.activeWorkspaceId, req.sessionUser.userId]) : null;
  const row = result?.rows[0];
  if (!row) {
    res.json({ completed: false });
    return;
  }
  res.json({ completed: true, returnTo: row.return_to || "/dashboard", signupAttemptId: row.signup_attempt_id });
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

// نقطة عودة OAuth — عامة عمداً (بلا requirePermission): عودة الجوال كثيراً ما تصل في سياق
// متصفح بلا كوكي الجلسة (فتح عبر تطبيق فيسبوك، فقدان التبويب الأصلي، اختلاف www/بدونها) —
// حادثة 12 يوليو: عميل حقيقي أكمل عند ميتا وارتطم بـ401 خام «يجب تسجيل الدخول أولاً».
// إثبات مسار الجوال = امتلاك nonce الـstate (عشوائي، مخزَّن مُجزّأً، بصلاحية، وادّعاء ذرّي
// بعقد إيجار) + كود OAuth صالح من ميتا لنفس التطبيق؛ الهوية (user/workspace) تؤخذ من صف
// المحاولة المربوط عند البدء بجلسة موثّقة. مسار سطح المكتب يبقى مشروطاً بالجلسة كما كان.
// وكل فشل هنا "توجيه" لا JSON خام — هذه صفحة يقف أمامها إنسان لا عميل API.
router.get("/meta/embedded-signup/callback", async (req: Request, res: Response): Promise<void> => {
  const state = String(req.query.state ?? "");
  const sessionUser = (req as AuthenticatedRequest).sessionUser as AuthenticatedRequest["sessionUser"] | undefined;
  const attempt = state ? await loadMobileAttemptByNonce(state) : null;
  // تشخيص 12 يوليو: صورة كاملة عند كل عودة — هل وصل state/code، وهل صار مسار جوال أم لا.
  logger.info({
    hasState: Boolean(state),
    hasCode: Boolean(req.query.code),
    hasSession: Boolean(sessionUser),
    attemptResolved: Boolean(attempt),
    lookupHashPrefix: state ? nonceHash(state).slice(0, 12) : null,
  }, "Meta embedded-signup callback entry");
  if (attempt && !metaMobileRedirectEnabled()) {
    res.status(404).json({ connected: false, error: "meta_mobile_redirect_disabled" });
    return;
  }
  if (attempt) {
    const sessionMatches = Boolean(sessionUser
      && sessionUser.userId === attempt.userId
      && sessionUser.activeWorkspaceId === attempt.workspaceId);
    const withParam = (base: string, suffix: string) => `${base}${base.includes("?") ? "&" : "?"}${suffix}`;
    const failRedirect = (reason: string) => {
      req.log?.warn({ signupAttemptId: attempt.signupAttemptId, reason }, "Meta mobile signup callback failed for visitor");
      res.redirect(withParam(attempt.returnTo, `whatsapp_connected=0&reason=${encodeURIComponent(reason)}`));
    };

    const code = String(req.query.code ?? "");
    if (!code) {
      failRedirect("missing_code");
      return;
    }

    const claim = await claimMetaMobileRedirectCallback({
      workspaceId: attempt.workspaceId,
      userId: attempt.userId,
      signupAttemptId: attempt.signupAttemptId,
      nonce: state,
    });
    if (claim.outcome === "invalid") {
      failRedirect("invalid_state");
      return;
    }
    if (claim.outcome === "busy") {
      failRedirect("attempt_processing");
      return;
    }
    if (claim.outcome === "completed") {
      res.redirect(withParam(attempt.returnTo, "whatsapp_connected=1"));
      return;
    }
    const claimToken = claim.claimToken!;
    const now = Date.now();

    req.log?.info({ signupAttemptId: attempt.signupAttemptId, configKey: attempt.configKey, sessionMatches }, "Meta mobile signup callback accepted");
    try {
      const resumedToken = claim.encryptedTokenRef ? resolveCredentialsSecretRef(claim.encryptedTokenRef) : null;
      const userToken = resumedToken ?? await exchangeCodeForToken(req as AuthenticatedRequest, code);
      if (!userToken) {
        await updateMobileAttempt({ signupAttemptId: attempt.signupAttemptId, claimToken, status: "failed_retryable", checkpoint: "pending", lastErrorCode: "meta_token_exchange_unavailable" });
        failRedirect("meta_token_exchange_unavailable");
        return;
      }
      const tokenRef = encryptedTokenRef(userToken);
      if (!tokenRef?.startsWith("enc:v1:")) {
        await updateMobileAttempt({ signupAttemptId: attempt.signupAttemptId, claimToken, status: "failed_terminal", checkpoint: "token_exchanged", lastErrorCode: "meta_per_channel_token_storage_unavailable" });
        failRedirect("meta_per_channel_token_storage_unavailable");
        return;
      }
      if (!resumedToken) {
        await updateMobileAttempt({ signupAttemptId: attempt.signupAttemptId, claimToken, status: "processing", checkpoint: "token_exchanged", encryptedTokenRef: tokenRef });
      }

      const channelOptions = await fetchMetaWhatsAppOptions(userToken);
      await updateMobileAttempt({ signupAttemptId: attempt.signupAttemptId, claimToken, status: "processing", checkpoint: "meta_discovered", encryptedTokenRef: tokenRef });
      const whatsappAccounts = channelOptions.options.whatsapp_accounts.filter((account) => account.phone_numbers.length > 0);
      const discoveredPhones = whatsappAccounts.flatMap((account) => account.phone_numbers.map((phone) => ({ account, phone })));
      const distinctWabaCount = new Set(discoveredPhones.map((entry) => entry.account.waba_id)).size;
      // تشخيص + رؤية: كم WABA وكم رقماً اكتُشف (أرقام مقنّعة، لا نكشف الرقم كاملاً في السجل).
      req.log?.info({
        signupAttemptId: attempt.signupAttemptId,
        distinctWabaCount,
        phoneCount: discoveredPhones.length,
        phones: discoveredPhones.map((entry) => (entry.phone.display_number || "").replace(/\d(?=\d{2})/g, "•")),
      }, "Meta mobile signup discovered WhatsApp numbers");
      if (discoveredPhones.length === 0) {
        failRedirect("no_whatsapp_phone_discovered");
        return;
      }

      // ربط تلقائي عند WABA واحد (حتى لو له أكثر من رقم) — كل أرقامه تخص نفس نشاط التاجر، فربط
      // أولها آمن وقابل للإضافة لاحقاً. صفحة الاختيار كانت تُجهض مستخدم الجوال أول مرة (بوابة
      // onboarding تُعيده للإعداد فلا يراها — حادثة 12 يوليو). الاختيار يبقى للحالة النادرة:
      // WABAs متعددة (أنشطة مختلفة) حيث الربط التلقائي قد يخطئ النشاط.
      if (distinctWabaCount <= 1) {
        const selected = discoveredPhones[0];
        const [existingChannel] = await db
          .select({ id: channelAccountsTable.id })
          .from(channelAccountsTable)
          .where(and(
            eq(channelAccountsTable.workspaceId, attempt.workspaceId),
            eq(channelAccountsTable.channelType, "whatsapp"),
            providerLookupCondition("phoneNumberId", selected.phone.phone_number_id),
          ))
          .limit(1);
        if (!existingChannel) {
          const channelLimit = await checkLimit(attempt.workspaceId, "channels");
          if (channelLimit.limit !== null && channelLimit.current + 1 > channelLimit.limit) {
            failRedirect("plan_limit_reached");
            return;
          }
        }
        await subscribeMobileWhatsAppAccounts(req as AuthenticatedRequest, [selected.account], userToken, attempt.signupAttemptId);
        await updateMobileAttempt({ signupAttemptId: attempt.signupAttemptId, claimToken, status: "processing", checkpoint: "subscribed", encryptedTokenRef: tokenRef });
        const account = await finalizeMobileWhatsAppConnection({
          workspaceId: attempt.workspaceId,
          userId: attempt.userId,
          account: selected.account,
          phone: selected.phone,
          tokenRef,
          configKey: attempt.configKey,
          signupAttemptId: attempt.signupAttemptId,
          claimToken,
        });
        // «المزامنة الكاذبة» (12 يوليو): الكتالوج يلتحق بالقناة فور الربط — كما في مسار الكمبيوتر.
        // غير قاتل: القناة أُنشئت فعلاً في finalize أعلاه؛ فشل إرفاق الكتالوج (ثانوي) يجب ألا يقلب
        // ربطاً ناجحاً إلى «فشل» في نظر العميل. نسجّله ونكمل نحو نجاح الربط.
        try {
          await attachMobileWhatsAppCatalogs({
            workspaceId: attempt.workspaceId,
            userId: attempt.userId,
            channelAccountId: account.id,
            wabaId: selected.account.waba_id,
            businessId: selected.account.business_id ?? null,
            userToken,
            signupAttemptId: attempt.signupAttemptId,
            log: req.log,
          });
        } catch (err) {
          req.log?.warn({ signupAttemptId: attempt.signupAttemptId, err: err instanceof Error ? err.message : String(err) }, "Mobile WhatsApp catalog attach failed; channel already linked, continuing");
        }
        if (sessionMatches) {
          ((req as AuthenticatedRequest).session as any).metaMobileRedirectResult = {
            userId: attempt.userId,
            workspaceId: attempt.workspaceId,
            signupAttemptId: attempt.signupAttemptId,
            returnTo: attempt.returnTo,
            channelAccountId: account.id,
            createdAt: now,
            expiresAt: attempt.expiresAtMs,
          };
          await saveSession(req as AuthenticatedRequest);
        }
        req.log?.info({ signupAttemptId: attempt.signupAttemptId, autoSelected: true, sessionMatches }, "Meta mobile signup channel connected");
        res.redirect(withParam(attempt.returnTo, "whatsapp_connected=1"));
        return;
      }

      // أكثر من رقم: تُحفظ الخيارات في صف المحاولة (مصدر دائم لا يضيع مع الجلسة)، وتُكتب نسخة
      // في الجلسة أيضاً إن كانت موجودة ومطابقة — فيكمل الاختيار في نفس المتصفح فوراً، أو من
      // التبويب الأصلي المسجَّل عبر معرف المحاولة.
      const sanitizedOptions = sanitizeMetaOptions(channelOptions.options);
      await pool.query(
        `UPDATE meta_mobile_signup_attempts SET discovered_options = $1, updated_at = NOW() WHERE signup_attempt_id = $2 AND claim_token = $3`,
        [JSON.stringify(sanitizedOptions), attempt.signupAttemptId, claimToken],
      );
      if (sessionMatches) {
        ((req as AuthenticatedRequest).session as any).metaChannelOptions = {
          workspaceId: attempt.workspaceId,
          options: sanitizedOptions,
          tokenRefs: { ...channelOptions.tokenRefs, userTokenRef: tokenRef },
          mobileContext: {
            signupAttemptId: attempt.signupAttemptId,
            configKey: attempt.configKey,
            // قيمة العمود تُكتب حصراً من الاتحاد المضيّق في نقطة البدء الموثّقة
            returnTo: attempt.returnTo as MetaMobileReturnTo,
            expiresAt: attempt.expiresAtMs,
            claimToken,
          } satisfies MetaMobileSessionContext,
          createdAt: now,
        };
        await saveSession(req as AuthenticatedRequest);
      }
      req.log?.info({ signupAttemptId: attempt.signupAttemptId, autoSelected: false, phoneCount: discoveredPhones.length, sessionMatches }, "Meta mobile signup requires channel selection");
      res.redirect(`/integrations/meta/select-channels?metaSignupAttempt=${encodeURIComponent(attempt.signupAttemptId)}`);
      return;
    } catch (err) {
      if (err instanceof MetaChannelConflictError) {
        failRedirect(err.code);
        return;
      }
      await updateMobileAttempt({ signupAttemptId: attempt.signupAttemptId, claimToken, status: "failed_retryable", checkpoint: claim.checkpoint ?? "processing", lastErrorCode: "meta_mobile_redirect_callback_failed" }).catch(() => {});
      // تشخيص 12 يوليو: الكتلة كانت تبتلع الاستثناء الفعلي وتسجّل رمزاً عاماً فقط — فتعذّر معرفة
      // أي خطوة فشلت (تبادل الكود/اكتشاف الأرقام/الاشتراك/الإنهاء). الآن نسجّل رسالة الخطأ ونوعه
      // وأول سطر من الأثر (بلا أي توكن — الرسائل لا تحمل أسراراً).
      req.log?.warn({
        signupAttemptId: attempt.signupAttemptId,
        errorCode: "meta_mobile_redirect_callback_failed",
        errName: err instanceof Error ? err.name : typeof err,
        errMessage: err instanceof Error ? err.message : String(err),
        errStackTop: err instanceof Error ? (err.stack ?? "").split("\n")[1]?.trim() ?? null : null,
      }, "Meta mobile signup callback failed");
      failRedirect("meta_mobile_redirect_callback_failed");
      return;
    }
  }

  // مسار سطح المكتب (النافذة المنبثقة): يتطلب جلسة كما كان دائماً.
  if (!sessionUser) {
    res.status(401).json({ error: "يجب تسجيل الدخول أولاً", code: "UNAUTHORIZED" });
    return;
  }
  const stored = (req.session as any).metaOAuthState;
  if (!stored || stored.state !== state || stored.workspaceId !== sessionUser.activeWorkspaceId || Date.now() - stored.createdAt > 15 * 60_000) {
    res.status(403).json({ connected: false, error: "invalid_state" });
    return;
  }

  const code = String(req.query.code ?? "");
  let channelOptions: { options: MetaChannelOptions; tokenRefs: MetaTokenRefs };

  try {
    const userToken = code ? await exchangeCodeForToken(req as AuthenticatedRequest, code) : null;
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
    workspaceId: sessionUser.activeWorkspaceId,
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
      externalAccountId: account.externalAccountId,
      externalBusinessId: account.externalBusinessId,
      externalPhoneId: account.externalPhoneId,
      healthStatus: account.healthStatus,
      lastHealthAt: account.lastHealthAt,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    })),
  });
});

// 9 يوليو 2026: أغلب شكاوى "الوكيل لا يرد" الفعلية سببها تقييد Meta لرقم واتساب نفسه
// (RESTRICTED/FLAGGED عند تجاوز حد الرسائل، أو BLOCKED من health_status عند مخالفة سياسة) —
// لا علاقة له بكودنا، ولا نراه إلا بسؤال Meta مباشرة. هذا فحص عند الطلب (لا تلقائي دوري)
// يستخدم عمودي channel_accounts.health_status/last_health_at الموجودين مسبقاً (كانا بلا
// كاتب فعلي — W1-T1) فيُعطيهما أول استخدام حقيقي. يعتمد توكن النظام العام للقراءة فقط
// (GET حالة، لا كتابة على حساب العميل) — نفس مبدأ الاسترجاع اليدوي، بلا خطر عزل مستأجرين.
router.post("/meta/channels/:id/check-health", requirePermission("integrations:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const channelId = String(req.params.id);
  const [channel] = await db
    .select()
    .from(channelAccountsTable)
    .where(and(eq(channelAccountsTable.id, channelId), eq(channelAccountsTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!channel) { res.status(404).json({ error: "القناة غير موجودة" }); return; }
  if (channel.channelType !== "whatsapp" || !channel.externalPhoneId) {
    res.status(400).json({ error: "فحص الحالة متاح لقنوات واتساب المرتبطة فقط", code: "not_whatsapp_or_unlinked" });
    return;
  }

  const systemToken = process.env.META_SYSTEM_USER_TOKEN;
  if (!systemToken) {
    res.status(503).json({ error: "فحص الحالة غير مهيأ حالياً على الخادم", code: "meta_token_unavailable" });
    return;
  }

  let metaStatus: string | null = null;
  let canSendMessage: string | null = null;
  try {
    const payload = await callMetaGraph(`${channel.externalPhoneId}?fields=status,health_status`, systemToken);
    metaStatus = typeof payload?.status === "string" ? payload.status : null;
    const entities = payload?.health_status?.entities;
    const phoneEntity = Array.isArray(entities) ? entities.find((e: any) => e?.entity_type === "PHONE_NUMBER") : null;
    canSendMessage = typeof phoneEntity?.can_send_message === "string" ? phoneEntity.can_send_message : null;
  } catch (err) {
    req.log?.warn({ err, channelAccountId: channel.id }, "WhatsApp health check failed");
    res.status(502).json({ error: "تعذّر الاتصال بـ Meta لفحص حالة الرقم. حاول لاحقاً.", code: "meta_health_check_failed" });
    return;
  }

  // مشكلة فعلية فقط إن أكّد أحد الحقلين قيداً واضحاً — لا نُظهر "مشكلة" على مجرد غياب حقل
  // (بعض الأرقام السليمة لا تُرجع health_status إطلاقاً).
  const hasProblem = metaStatus === "RESTRICTED" || metaStatus === "FLAGGED" || canSendMessage === "BLOCKED" || canSendMessage === "LIMITED";
  const healthStatus = hasProblem ? "problem" : "ok";

  const [updated] = await db.update(channelAccountsTable)
    .set({ healthStatus, lastHealthAt: new Date(), updatedAt: new Date() })
    .where(and(eq(channelAccountsTable.id, channel.id), eq(channelAccountsTable.workspaceId, activeWorkspaceId)))
    .returning();

  res.json({
    healthStatus: updated.healthStatus,
    lastHealthAt: updated.lastHealthAt,
    metaStatus,
    canSendMessage,
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

  const { options, tokenRefs, mobileContext } = currentMetaSession(req);
  const created: Array<typeof channelAccountsTable.$inferSelect> = [];
  const createdSources: Array<typeof catalogSourcesTable.$inferSelect> = [];
  const connectedAt = new Date().toISOString();
  const metaAppId = process.env.META_APP_ID ?? null;
  const mobileUserToken = mobileContext ? resolveCredentialsSecretRef(tokenRefs.userTokenRef) : null;
  const subscribedMobileWabas = new Set<string>();
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

  if (mobileContext) {
    if (!mobileUserToken || parsed.data.whatsapp_phone_ids.length !== 1 || parsed.data.instagram_account_ids.length > 0 || parsed.data.page_ids.length > 0) {
      res.status(400).json({ error: "Mobile WhatsApp signup requires exactly one discovered phone", code: "invalid_mobile_channel_selection" });
      return;
    }
    const selectedPhoneId = parsed.data.whatsapp_phone_ids[0];
    const selectedAccount = options.whatsapp_accounts.find((account) => account.phone_numbers.some((phone) => phone.phone_number_id === selectedPhoneId));
    const selectedPhone = selectedAccount?.phone_numbers.find((phone) => phone.phone_number_id === selectedPhoneId);
    if (!selectedAccount || !selectedPhone) {
      res.status(400).json({ error: "Selected phone was not discovered by Meta", code: "unknown_mobile_phone_selection" });
      return;
    }
    try {
      await subscribeMobileWhatsAppAccounts(req, [selectedAccount], mobileUserToken, mobileContext.signupAttemptId);
      await updateMobileAttempt({ signupAttemptId: mobileContext.signupAttemptId, claimToken: mobileContext.claimToken, status: "processing", checkpoint: "subscribed", encryptedTokenRef: tokenRefs.userTokenRef });
      const channel = await finalizeMobileWhatsAppConnection({
        workspaceId: req.sessionUser.activeWorkspaceId,
        userId: req.sessionUser.userId,
        account: selectedAccount,
        phone: selectedPhone,
        tokenRef: tokenRefs.userTokenRef!,
        configKey: mobileContext.configKey,
        signupAttemptId: mobileContext.signupAttemptId,
        claimToken: mobileContext.claimToken,
      });
      // «المزامنة الكاذبة» (12 يوليو): نفس التحاق الكتالوج المطبَّق في نقطة العودة بلا جلسة.
      await attachMobileWhatsAppCatalogs({
        workspaceId: req.sessionUser.activeWorkspaceId,
        userId: req.sessionUser.userId,
        channelAccountId: channel.id,
        wabaId: selectedAccount.waba_id,
        businessId: selectedAccount.business_id ?? null,
        userToken: mobileUserToken,
        signupAttemptId: mobileContext.signupAttemptId,
        log: req.log,
      });
      (req.session as any).metaMobileRedirectResult = {
        userId: req.sessionUser.userId,
        workspaceId: req.sessionUser.activeWorkspaceId,
        signupAttemptId: mobileContext.signupAttemptId,
        returnTo: mobileContext.returnTo,
        channelAccountId: channel.id,
        createdAt: Date.now(),
        expiresAt: mobileContext.expiresAt,
      };
      delete (req.session as any).metaChannelOptions;
      await saveSession(req);
      res.status(201).json({
        accounts: [serializeChannelAccount(channel)],
        sources: [],
        returnTo: "/dashboard?whatsapp_connected=1",
        signupAttemptId: mobileContext.signupAttemptId,
      });
      return;
    } catch (err) {
      await updateMobileAttempt({ signupAttemptId: mobileContext.signupAttemptId, claimToken: mobileContext.claimToken, status: "failed_retryable", checkpoint: "subscribed", lastErrorCode: "mobile_channel_finalize_failed" }).catch(() => {});
      if (err instanceof MetaChannelConflictError) {
        res.status(409).json({ error: err.code, code: err.code });
        return;
      }
      throw err;
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
        externalBusinessId: account.waba_id ?? null,
        externalPhoneId: phone.phone_number_id,
        ensureAutoAgent: false,
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
      externalBusinessId: wabaId,
      externalPhoneId: phoneNumberId,
      ensureAutoAgent: false,
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
      externalAccountId: account.ig_account_id,
    });
    created.push(channel);

    // الطور 2: حساب إنستغرام مربوط الآن ينشئ مصدر page_posts فوراً (سياق الوكيل الحي — انظر
    // upsertMetaPagePostsSource أعلاه). لا نُعيد الجلب من ميتا — نفس بيانات الحساب المكتشفة أعلاه.
    createdSources.push(await upsertMetaPagePostsSource({
      req,
      channelAccountId: channel.id,
      externalId: account.ig_account_id,
      name: account.username ? `Instagram ${account.username}` : account.ig_account_id,
      platform: "instagram",
      connectedAt,
    }));
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
      externalAccountId: page.page_id,
    });
      created.push(channel);

    // الطور 2: صفحة فيسبوك مربوطة الآن تنشئ مصدر page_posts فوراً — نفس المنطق أعلاه لإنستغرام.
    createdSources.push(await upsertMetaPagePostsSource({
      req,
      channelAccountId: channel.id,
      externalId: page.page_id,
      name: page.name || page.page_id,
      platform: "facebook",
      connectedAt,
    }));
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
    returnTo: null,
    signupAttemptId: null,
  });
});

export default router;
