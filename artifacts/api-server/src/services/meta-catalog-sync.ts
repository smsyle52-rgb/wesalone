import { createHash } from "node:crypto";
import { and, desc, eq, notInArray, or, sql } from "drizzle-orm";
import {
  adCampaignsTable,
  catalogSourcesTable,
  catalogSyncRunsTable,
  channelAccountsTable,
  db,
  inventoryProductsTable,
  knowledgeBasesTable,
  knowledgeDocumentsTable,
  knowledgeSourcesTable,
  productsTable,
  socialPostsTable,
  workspaceMembershipsTable,
  type CatalogSource,
  type Product,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { resolveCredentialsSecretRef } from "./meta-whatsapp-business-profile";
import { rebuildDocumentChunks } from "./kb-chunker";

function requireMetaGraphVersion(): string {
  const version = process.env.META_GRAPH_VERSION?.trim();
  if (!version) throw new Error("META_GRAPH_VERSION is not configured");
  return version;
}

type SyncResult = {
  status: "success" | "partial" | "failed";
  itemsSynced: number;
  itemsFailed: number;
  error?: string;
};

type MetaPage<T> = {
  data?: T[];
  paging?: {
    next?: string;
  };
};

type MetaProduct = {
  id?: string;
  retailer_id?: string;
  name?: string;
  description?: string;
  price?: string | number;
  currency?: string;
  availability?: string;
  inventory?: string | number | null;
  image_url?: string | null;
  url?: string | null;
  brand?: string | null;
  category?: string | null;
};

type MetaPost = {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string | null;
  attachments?: { data?: Array<{ media?: { image?: { src?: string } } }> } | null;
  type?: string;
};

// إنستغرام (الطور 2 — 11 يوليو 2026): حسابات الأعمال في إنستغرام لا تملك {id}/posts أصلاً —
// منشوراتها الحقيقية عبر {ig-user-id}/media بحقول مختلفة الأسماء تماماً (caption لا message،
// permalink لا permalink_url، إلخ). النوع هنا يعكس شكل استجابة ميتا الفعلي لهذا الـendpoint.
type MetaIgMedia = {
  id: string;
  caption?: string;
  permalink?: string | null;
  timestamp?: string;
  media_url?: string | null;
  media_type?: string;
};

type MetaAd = {
  id: string;
  name?: string;
  status?: string;
  objective?: string;
  creative?: {
    body?: string;
    image_url?: string;
    object_story_spec?: {
      template_data?: { product_id?: string };
      link_data?: { product_id?: string };
    };
  };
  start_time?: string;
  end_time?: string | null;
};

function stringConfig(config: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function sourceConfig(source: CatalogSource): Record<string, unknown> {
  return source.config && typeof source.config === "object" && !Array.isArray(source.config)
    ? source.config as Record<string, unknown>
    : {};
}

function isDryRun(channelAccount?: { id: string; credentialsSecretRef: string | null } | null): boolean {
  if (process.env.META_DRY_RUN === "true") return true;
  if (process.env.META_SYSTEM_USER_TOKEN) return false;
  if (process.env.META_ACCESS_TOKEN) return false;
  if (channelAccount?.credentialsSecretRef) return false;
  return !process.env.META_APP_SECRET;
}

function accessToken(source: CatalogSource, channelAccount?: { id: string; credentialsSecretRef: string | null } | null): string | null {
  if (isDryRun(channelAccount)) return null;
  if (process.env.META_SYSTEM_USER_TOKEN) return process.env.META_SYSTEM_USER_TOKEN;
  if (process.env.META_ACCESS_TOKEN) return process.env.META_ACCESS_TOKEN;
  if (channelAccount?.credentialsSecretRef) {
    try {
      return resolveCredentialsSecretRef(channelAccount.credentialsSecretRef);
    } catch (err) {
      logger.warn({ err, sourceId: source.id, channelAccountId: channelAccount.id }, "Meta catalog access token could not be resolved from the linked channel");
    }
  }
  throw new Error("Meta catalog access token is not configured");
}

async function loadChannelAccount(source: CatalogSource) {
  if (source.channelAccountId) {
    const [account] = await db
      .select({ id: channelAccountsTable.id, credentialsSecretRef: channelAccountsTable.credentialsSecretRef })
      .from(channelAccountsTable)
      .where(eq(channelAccountsTable.id, source.channelAccountId))
      .limit(1);
    if (account) return account;
  }

  const config = sourceConfig(source);
  const sourceWabaId = stringConfig(config, "waba_id", "wabaId");
  const accounts = await db
    .select({
      id: channelAccountsTable.id,
      credentialsSecretRef: channelAccountsTable.credentialsSecretRef,
      providerConfig: channelAccountsTable.providerConfig,
    })
    .from(channelAccountsTable)
    .where(and(
      eq(channelAccountsTable.workspaceId, source.workspaceId),
      eq(channelAccountsTable.channelType, "whatsapp"),
      eq(channelAccountsTable.status, "active"),
      sourceWabaId
        ? or(
          sql`${channelAccountsTable.providerConfig}->>'waba_id' = ${sourceWabaId}`,
          sql`${channelAccountsTable.providerConfig}->>'wabaId' = ${sourceWabaId}`,
        )
        : undefined,
    ))
    .limit(sourceWabaId ? 5 : 2);

  if (accounts.length === 1) return accounts[0];
  return null;
}

// مصدَّرة (11 يوليو) لتُعاد استخدامها في اكتشاف كتالوجات ميتا (catalog.routes.ts POST
// /sources/discover) بدل تكرار منطق الترقيم والمصادقة مع Graph API هناك.
export async function metaGet<T>(path: string, token: string): Promise<T> {
  const graphVersion = requireMetaGraphVersion();
  const url = `https://graph.facebook.com/${graphVersion}/${path.replace(/^\//, "")}`;

  async function attempt() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      return await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  let response = await attempt();
  if (response.status >= 500) response = await attempt();
  if (!response.ok) throw new Error(`Meta Graph API returned ${response.status}`);
  return await response.json() as T;
}

export async function collectPages<T>(initialPath: string, token: string): Promise<T[]> {
  const rows: T[] = [];
  let path: string | null = initialPath;
  for (let page = 0; path && page < 20; page += 1) {
    const payload: MetaPage<T> = await metaGet<MetaPage<T>>(path, token);
    rows.push(...(payload.data ?? []));
    if (!payload.paging?.next) break;
    const nextUrl: URL = new URL(payload.paging.next);
    path = `${nextUrl.pathname.replace(`/${requireMetaGraphVersion()}/`, "")}${nextUrl.search}`;
  }
  return rows;
}

function dryRunProducts(source: CatalogSource): MetaProduct[] {
  return [
    { id: `${source.externalId}-sample-1`, name: "منتج تجريبي 1", description: "عنصر متزامن تجريبيا من كتالوج ميتا.", price: "1000", currency: "YER", availability: "in stock", inventory: 12, brand: "Meta", category: "sample" },
    { id: `${source.externalId}-sample-2`, name: "منتج تجريبي 2", description: "عنصر تجريبي متاح للبحث داخل الوكيل.", price: "2500", currency: "YER", availability: "preorder", inventory: null, brand: "Meta", category: "sample" },
    { id: `${source.externalId}-sample-3`, name: "منتج تجريبي 3", description: "مرآة بيانات آمنة عند غياب أسرار Meta.", price: "0", currency: "YER", availability: "out of stock", inventory: 0, brand: "Meta", category: "sample" },
  ];
}

function dryRunPosts(source: CatalogSource): MetaPost[] {
  const createdTime = new Date().toISOString();
  return [
    { id: `${source.externalId}-post-1`, message: "منشور تجريبي من صفحة ميتا.", created_time: createdTime, type: "status" },
    { id: `${source.externalId}-post-2`, message: "عرض تجريبي مرتبط بالمنتجات المتزامنة.", created_time: createdTime, type: "status" },
    { id: `${source.externalId}-post-3`, message: "تحديث تجريبي للوكيل عن آخر المنشورات.", created_time: createdTime, type: "status" },
  ];
}

function dryRunAds(source: CatalogSource): MetaAd[] {
  const startTime = new Date().toISOString();
  return [
    { id: `${source.externalId}-ad-1`, name: "إعلان تجريبي 1", status: "ACTIVE", objective: "MESSAGES", creative: { body: "إعلان تجريبي لمنتج متزامن." }, start_time: startTime },
    { id: `${source.externalId}-ad-2`, name: "إعلان تجريبي 2", status: "PAUSED", objective: "SALES", creative: { body: "حملة تجريبية للكتالوج." }, start_time: startTime },
    { id: `${source.externalId}-ad-3`, name: "إعلان تجريبي 3", status: "ACTIVE", objective: "ENGAGEMENT", creative: { body: "ترويج تجريبي للمنشورات." }, start_time: startTime },
  ];
}

function parsePrice(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, "").match(/\d+(\.\d+)?/);
  return match ? Number(match[0]).toFixed(2) : null;
}

async function upsertInventoryMirror(params: {
  source: CatalogSource;
  externalProductId: string;
  row: {
    name: string;
    description: string | null;
    price: string | null;
    currency: string;
    availability: string | null;
    inventoryCount: number | null;
    imageUrl: string | null;
  };
}) {
  const sku = `meta:${params.source.externalId}:${params.externalProductId}`;
  const [existing] = await db.select({ id: inventoryProductsTable.id })
    .from(inventoryProductsTable)
    .where(and(
      eq(inventoryProductsTable.workspaceId, params.source.workspaceId),
      eq(inventoryProductsTable.sku, sku),
    ))
    .limit(1);

  const values = {
    name: params.row.name,
    description: params.row.description,
    sku,
    price: params.row.price ?? "0",
    currency: params.row.currency,
    imageUrl: params.row.imageUrl,
    quantityAvailable: params.row.inventoryCount,
    status: params.row.availability === "out of stock" ? "inactive" : "active",
    isArchived: false,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(inventoryProductsTable)
      .set(values)
      .where(and(
        eq(inventoryProductsTable.id, existing.id),
        eq(inventoryProductsTable.workspaceId, params.source.workspaceId),
      ));
    return;
  }

  await db.insert(inventoryProductsTable).values({
    workspaceId: params.source.workspaceId,
    ...values,
  });
}

async function markSource(source: CatalogSource, values: Partial<typeof catalogSourcesTable.$inferInsert>) {
  await db.update(catalogSourcesTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(catalogSourcesTable.id, source.id));
}

async function recordRun(source: CatalogSource, startedAt: Date, result: SyncResult) {
  await db.insert(catalogSyncRunsTable).values({
    workspaceId: source.workspaceId,
    catalogSourceId: source.id,
    status: result.status,
    itemsSynced: result.itemsSynced,
    itemsFailed: result.itemsFailed,
    error: result.error,
    startedAt,
    finishedAt: new Date(),
  });
}

async function runWithAudit(source: CatalogSource, fn: () => Promise<SyncResult>): Promise<SyncResult> {
  const startedAt = new Date();
  await markSource(source, { syncStatus: "syncing", lastSyncError: null });
  try {
    const result = await fn();
    await markSource(source, {
      syncStatus: result.status === "failed" ? "failed" : "synced",
      lastSyncedAt: result.status === "failed" ? source.lastSyncedAt : new Date(),
      lastSyncError: result.error ?? null,
    });
    await recordRun(source, startedAt, result);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const result: SyncResult = { status: "failed", itemsSynced: 0, itemsFailed: 1, error };
    await markSource(source, { syncStatus: "failed", lastSyncError: error });
    await recordRun(source, startedAt, result);
    return result;
  }
}

async function visibleProducts(source: CatalogSource) {
  return db.select()
    .from(productsTable)
    .where(and(
      eq(productsTable.workspaceId, source.workspaceId),
      eq(productsTable.catalogSourceId, source.id),
      eq(productsTable.isVisible, true),
    ));
}

async function findKnowledgeOwner(workspaceId: string): Promise<string | null> {
  const [membership] = await db
    .select({ userId: workspaceMembershipsTable.userId })
    .from(workspaceMembershipsTable)
    .where(and(eq(workspaceMembershipsTable.workspaceId, workspaceId), eq(workspaceMembershipsTable.status, "active")))
    .orderBy(desc(workspaceMembershipsTable.createdAt))
    .limit(1);
  return membership?.userId ?? null;
}

async function ensureCatalogKnowledgeBase(workspaceId: string) {
  const [existing] = await db
    .select()
    .from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.workspaceId, workspaceId), eq(knowledgeBasesTable.name, "Meta catalog mirror")))
    .limit(1);
  if (existing) return existing;

  const ownerId = await findKnowledgeOwner(workspaceId);
  if (!ownerId) return null;

  const [created] = await db.insert(knowledgeBasesTable).values({
    workspaceId,
    name: "Meta catalog mirror",
    description: "Read-only mirror of Meta catalog products for agent retrieval.",
    status: "active",
    createdBy: ownerId,
  }).returning();
  return created;
}

export async function upsertProductKnowledge(source: CatalogSource): Promise<void> {
  const base = await ensureCatalogKnowledgeBase(source.workspaceId);
  if (!base) {
    logger.warn({ workspaceId: source.workspaceId }, "Catalog knowledge feed skipped because no active workspace member exists");
    return;
  }

  const ownerId = await findKnowledgeOwner(source.workspaceId);
  if (!ownerId) return;

  for (const product of await visibleProducts(source)) {
    await upsertProductKnowledgeDocument(product, base, ownerId);
  }
}

export async function upsertSingleProductKnowledge(product: Product): Promise<boolean> {
  const base = await ensureCatalogKnowledgeBase(product.workspaceId);
  if (!base) {
    logger.warn(
      { workspaceId: product.workspaceId, productId: product.id, reason: "no_knowledge_base_owner" },
      "Manual product knowledge skipped",
    );
    return false;
  }

  const ownerId = await findKnowledgeOwner(product.workspaceId);
  if (!ownerId) {
    logger.warn(
      { workspaceId: product.workspaceId, productId: product.id, reason: "no_active_workspace_member" },
      "Manual product knowledge skipped",
    );
    return false;
  }

  return upsertProductKnowledgeDocument(product, base, ownerId);
}

async function upsertProductKnowledgeDocument(
  product: Product,
  base: typeof knowledgeBasesTable.$inferSelect,
  ownerId: string,
): Promise<boolean> {
  const content = [
    `Product ID: ${product.externalProductId}.`,
    `\u0645\u0646\u062a\u062c: ${product.name}. \u0627\u0644\u0633\u0639\u0631: ${product.price ?? "\u063a\u064a\u0631 \u0645\u062d\u062f\u062f"} ${product.currency ?? "YER"}. \u0627\u0644\u062a\u0648\u0641\u0631: ${product.availability ?? "\u063a\u064a\u0631 \u0645\u062d\u062f\u062f"}. ${product.description ?? ""}`,
  ].join(" ").trim();
  if (!content) {
    logger.warn(
      { workspaceId: product.workspaceId, productId: product.id, reason: "empty_content" },
      "Product knowledge skipped",
    );
    return false;
  }

  const contentHash = createHash("sha256").update(content).digest("hex");
  const sourceUrl = `catalog://product/${product.id}`;

  const [existingSource] = await db.select()
    .from(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.workspaceId, product.workspaceId), eq(knowledgeSourcesTable.sourceUrl, sourceUrl)))
    .limit(1);

  const knowledgeSource = existingSource ?? (await db.insert(knowledgeSourcesTable).values({
    workspaceId: product.workspaceId,
    knowledgeBaseId: base.id,
    type: "text",
    title: `Catalog product ${product.externalProductId}`,
    status: "ready",
    sourceUrl,
    rawText: content,
    metadata: { source: "catalog", productId: product.id, contentHash },
    createdBy: ownerId,
  }).returning())[0];

  const [existingDocument] = await db.select()
    .from(knowledgeDocumentsTable)
    .where(and(eq(knowledgeDocumentsTable.workspaceId, product.workspaceId), eq(knowledgeDocumentsTable.sourceId, knowledgeSource.id)))
    .limit(1);

  if (existingDocument?.contentText === content) return true;

  const document = existingDocument
    ? (await db.update(knowledgeDocumentsTable)
      .set({ title: product.name, contentText: content, status: "ready", updatedAt: new Date() })
      .where(eq(knowledgeDocumentsTable.id, existingDocument.id))
      .returning())[0]
    : (await db.insert(knowledgeDocumentsTable).values({
      workspaceId: product.workspaceId,
      knowledgeBaseId: base.id,
      sourceId: knowledgeSource.id,
      title: product.name,
      contentText: content,
      status: "ready",
      tokenEstimate: Math.ceil(content.length / 4),
      createdBy: ownerId,
    }).returning())[0];

  await db.update(knowledgeSourcesTable)
    .set({ rawText: content, metadata: { source: "catalog", productId: product.id, contentHash }, updatedAt: new Date() })
    .where(eq(knowledgeSourcesTable.id, knowledgeSource.id));
  await rebuildDocumentChunks({
    documentId: document.id,
    workspaceId: product.workspaceId,
    knowledgeBaseId: base.id,
    contentText: content,
  });
  return true;
}

export async function syncCommerceCatalog(source: CatalogSource): Promise<SyncResult> {
  return runWithAudit(source, async () => {
    const channelAccount = await loadChannelAccount(source);
    const token = accessToken(source, channelAccount);
    const rows = token
      ? await collectPages<MetaProduct>(`${source.externalId}/products?fields=id,name,description,price,currency,availability,inventory,image_url,url,brand,category`, token)
      : dryRunProducts(source);
    if (!token) logger.info({ sourceId: source.id }, "DRY_RUN Meta commerce catalog sync");

    const seenIds: string[] = [];
    for (const item of rows) {
      const externalProductId = String(item.retailer_id ?? item.id);
      seenIds.push(externalProductId);
      const row = {
        name: String(item.name ?? externalProductId),
        description: item.description ? String(item.description) : null,
        category: item.category ? String(item.category) : null,
        price: parsePrice(item.price),
        currency: item.currency ? String(item.currency) : "YER",
        availability: item.availability ? String(item.availability) : null,
        inventoryCount: Number.isFinite(Number(item.inventory)) ? Number(item.inventory) : null,
        imageUrl: item.image_url ? String(item.image_url) : null,
        productUrl: item.url ? String(item.url) : null,
        brand: item.brand ? String(item.brand) : null,
        raw: item,
        isVisible: true,
        syncedAt: new Date(),
        updatedAt: new Date(),
      };

      await db.insert(productsTable).values({
        workspaceId: source.workspaceId,
        catalogSourceId: source.id,
        externalProductId,
        ...row,
      }).onConflictDoUpdate({
        target: [productsTable.workspaceId, productsTable.catalogSourceId, productsTable.externalProductId],
        set: row,
      });

      await upsertInventoryMirror({ source, externalProductId, row });
    }

    if (seenIds.length > 0) {
      await db.update(productsTable)
        .set({ isVisible: false, updatedAt: new Date() })
        .where(and(
          eq(productsTable.workspaceId, source.workspaceId),
          eq(productsTable.catalogSourceId, source.id),
          notInArray(productsTable.externalProductId, seenIds),
        ));

      await db.update(inventoryProductsTable)
        .set({ isArchived: true, status: "inactive", updatedAt: new Date() })
        .where(and(
          eq(inventoryProductsTable.workspaceId, source.workspaceId),
          sql`${inventoryProductsTable.sku} like ${`meta:${source.externalId}:%`}`,
          notInArray(inventoryProductsTable.sku, seenIds.map((id) => `meta:${source.externalId}:${id}`)),
        ));
    }

    await upsertProductKnowledge(source);
    return { status: "success", itemsSynced: rows.length, itemsFailed: 0 };
  });
}

// طبّع استجابة {ig-user-id}/media لنفس شكل MetaPost (caption→message، permalink→permalink_url،
// timestamp→created_time، media_url→attachments[0].media.image.src، media_type→type) — فيُعاد
// استخدام حلقة upsert/dry-run أدناه بلا أي تفرّع إضافي بعد نقطة الجلب.
function normalizeIgMediaToPost(media: MetaIgMedia): MetaPost {
  return {
    id: media.id,
    message: media.caption,
    created_time: media.timestamp,
    permalink_url: media.permalink ?? null,
    type: media.media_type,
    attachments: media.media_url
      ? { data: [{ media: { image: { src: media.media_url } } }] }
      : null,
  };
}

export async function syncPagePosts(source: CatalogSource): Promise<SyncResult> {
  return runWithAudit(source, async () => {
    const channelAccount = await loadChannelAccount(source);
    const token = accessToken(source, channelAccount);
    // فرع إنستغرام (الطور 2): نفس مصدر page_posts يخدم صفحات فيسبوك وحسابات إنستغرام معاً —
    // config.platform (مضبوطة عند إنشاء المصدر في integrations.routes.ts) تحدّد الـendpoint
    // الصحيح. بلا توكن (dry-run محلي) نستخدم dryRunPosts نفسها للمنصّتين — لا حاجة لعيّنة مستقلة.
    const isInstagram = sourceConfig(source).platform === "instagram";
    const rows = token
      ? isInstagram
        ? (await collectPages<MetaIgMedia>(`${source.externalId}/media?fields=id,caption,permalink,timestamp,media_url,media_type`, token)).map(normalizeIgMediaToPost)
        : await collectPages<MetaPost>(`${source.externalId}/posts?fields=id,message,created_time,permalink_url,attachments,type`, token)
      : dryRunPosts(source);
    if (!token) logger.info({ sourceId: source.id }, "DRY_RUN Meta page posts sync");

    for (const item of rows) {
      const externalPostId = String(item.id);
      const attachment = item.attachments?.data?.[0] ?? {};
      const row = {
        message: item.message ? String(item.message) : null,
        postType: item.type ? String(item.type) : null,
        permalinkUrl: item.permalink_url ? String(item.permalink_url) : null,
        mediaUrl: attachment.media?.image?.src ? String(attachment.media.image.src) : null,
        publishedAt: item.created_time ? new Date(item.created_time) : null,
        raw: item,
        syncedAt: new Date(),
      };

      await db.insert(socialPostsTable).values({
        workspaceId: source.workspaceId,
        catalogSourceId: source.id,
        externalPostId,
        ...row,
      }).onConflictDoUpdate({
        target: [socialPostsTable.workspaceId, socialPostsTable.catalogSourceId, socialPostsTable.externalPostId],
        set: row,
      });
    }

    return { status: "success", itemsSynced: rows.length, itemsFailed: 0 };
  });
}

export async function syncAds(source: CatalogSource): Promise<SyncResult> {
  return runWithAudit(source, async () => {
    const channelAccount = await loadChannelAccount(source);
    const token = accessToken(source, channelAccount);
    const rows = token
      ? await collectPages<MetaAd>(`${source.externalId}/ads?fields=id,name,status,objective,creative{body,image_url,object_story_spec},start_time,end_time`, token)
      : dryRunAds(source);
    if (!token) logger.info({ sourceId: source.id }, "DRY_RUN Meta ads sync");

    for (const item of rows) {
      const creative = item.creative ?? {};
      const promotedProductIds = [
        creative.object_story_spec?.template_data?.product_id,
        creative.object_story_spec?.link_data?.product_id,
      ].filter((value): value is string => typeof value === "string");

      const row = {
        name: String(item.name ?? item.id),
        status: item.status ? String(item.status) : null,
        objective: item.objective ? String(item.objective) : null,
        promotedProductIds,
        adCreativeText: creative.body ? String(creative.body) : null,
        adCreativeImageUrl: creative.image_url ? String(creative.image_url) : null,
        startTime: item.start_time ? new Date(item.start_time) : null,
        endTime: item.end_time ? new Date(item.end_time) : null,
        raw: item,
        syncedAt: new Date(),
      };

      await db.insert(adCampaignsTable).values({
        workspaceId: source.workspaceId,
        catalogSourceId: source.id,
        externalAdId: String(item.id),
        ...row,
      }).onConflictDoUpdate({
        target: [adCampaignsTable.workspaceId, adCampaignsTable.catalogSourceId, adCampaignsTable.externalAdId],
        set: row,
      });
    }

    return { status: "success", itemsSynced: rows.length, itemsFailed: 0 };
  });
}

export async function syncCatalogSource(source: CatalogSource): Promise<SyncResult> {
  if (source.sourceType === "commerce_catalog") return syncCommerceCatalog(source);
  if (source.sourceType === "page_posts") return syncPagePosts(source);
  if (source.sourceType === "ads") return syncAds(source);
  if (source.sourceType === "manual") {
    await upsertProductKnowledge(source);
    return { status: "success", itemsSynced: 0, itemsFailed: 0 };
  }
  return { status: "failed", itemsSynced: 0, itemsFailed: 1, error: `Unsupported source type ${source.sourceType}` };
}

export async function syncAll(workspaceId: string): Promise<SyncResult[]> {
  const sources = await db.select()
    .from(catalogSourcesTable)
    .where(and(eq(catalogSourcesTable.workspaceId, workspaceId), eq(catalogSourcesTable.status, "active")));
  return Promise.all(sources.map((source) => syncCatalogSource(source)));
}
