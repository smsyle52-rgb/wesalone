import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import type pino from "pino";

type CatalogSourceRow = {
  id: string;
  workspace_id: string;
  channel_account_id: string | null;
  source_type: "commerce_catalog" | "page_posts" | "ads" | string;
  external_id: string;
  name: string;
  last_synced_at: Date | null;
};

type DomainEventRow = {
  id: string;
  workspace_id: string;
  entity_id: string;
  attempts: number;
};

type SyncResult = {
  status: "success" | "partial" | "failed";
  itemsSynced: number;
  itemsFailed: number;
  error?: string;
};

const maxCatalogEvents = 10;
const maxAttempts = 5;

function requireMetaGraphVersion(): string {
  const version = process.env.META_GRAPH_VERSION?.trim();
  if (!version) throw new Error("META_GRAPH_VERSION is not configured");
  return version;
}

function isDryRun(): boolean {
  return process.env.META_DRY_RUN === "true" || !process.env.META_APP_SECRET;
}

function token(): string | null {
  if (isDryRun()) return null;
  return process.env.META_SYSTEM_USER_TOKEN ?? process.env.META_ACCESS_TOKEN ?? null;
}

async function metaGet<T>(path: string, accessToken: string): Promise<T> {
  const graphVersion = requireMetaGraphVersion();
  const url = `https://graph.facebook.com/${graphVersion}/${path.replace(/^\//, "")}`;

  async function attempt() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      return await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
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

async function collectPages<T>(path: string, accessToken: string): Promise<T[]> {
  const rows: T[] = [];
  let current: string | null = path;
  for (let page = 0; current && page < 20; page += 1) {
    const payload: { data?: T[]; paging?: { next?: string } } = await metaGet(current, accessToken);
    rows.push(...(payload.data ?? []));
    if (!payload.paging?.next) break;
    const nextUrl = new URL(payload.paging.next);
    current = `${nextUrl.pathname.replace(`/${requireMetaGraphVersion()}/`, "")}${nextUrl.search}`;
  }
  return rows;
}

function dryRunProducts(source: CatalogSourceRow) {
  return [
    { id: `${source.external_id}-sample-1`, name: "منتج تجريبي 1", description: "عنصر متزامن تجريبيا من كتالوج ميتا.", price: "1000", currency: "YER", availability: "in stock", inventory: 12, brand: "Meta", category: "sample" },
    { id: `${source.external_id}-sample-2`, name: "منتج تجريبي 2", description: "عنصر تجريبي متاح للبحث داخل الوكيل.", price: "2500", currency: "YER", availability: "preorder", inventory: null, brand: "Meta", category: "sample" },
    { id: `${source.external_id}-sample-3`, name: "منتج تجريبي 3", description: "مرآة بيانات آمنة عند غياب أسرار Meta.", price: "0", currency: "YER", availability: "out of stock", inventory: 0, brand: "Meta", category: "sample" },
  ];
}

function dryRunPosts(source: CatalogSourceRow) {
  const createdTime = new Date().toISOString();
  return [
    { id: `${source.external_id}-post-1`, message: "منشور تجريبي من صفحة ميتا.", created_time: createdTime, type: "status" },
    { id: `${source.external_id}-post-2`, message: "عرض تجريبي مرتبط بالمنتجات المتزامنة.", created_time: createdTime, type: "status" },
    { id: `${source.external_id}-post-3`, message: "تحديث تجريبي للوكيل عن آخر المنشورات.", created_time: createdTime, type: "status" },
  ];
}

function dryRunAds(source: CatalogSourceRow) {
  const startTime = new Date().toISOString();
  return [
    { id: `${source.external_id}-ad-1`, name: "إعلان تجريبي 1", status: "ACTIVE", objective: "MESSAGES", creative: { body: "إعلان تجريبي لمنتج متزامن." }, start_time: startTime },
    { id: `${source.external_id}-ad-2`, name: "إعلان تجريبي 2", status: "PAUSED", objective: "SALES", creative: { body: "حملة تجريبية للكتالوج." }, start_time: startTime },
    { id: `${source.external_id}-ad-3`, name: "إعلان تجريبي 3", status: "ACTIVE", objective: "ENGAGEMENT", creative: { body: "ترويج تجريبي للمنشورات." }, start_time: startTime },
  ];
}

function parsePrice(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, "").match(/\d+(\.\d+)?/);
  return match ? Number(match[0]).toFixed(2) : null;
}

async function claimDueSources(): Promise<CatalogSourceRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<CatalogSourceRow>(
      `
      UPDATE catalog_sources
      SET sync_status = 'syncing', updated_at = now()
      WHERE id IN (
        SELECT id
        FROM catalog_sources
        WHERE status = 'active'
          AND (last_synced_at IS NULL OR last_synced_at < now() - interval '30 minutes')
        ORDER BY last_synced_at ASC NULLS FIRST, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 10
      )
      RETURNING id, workspace_id, channel_account_id, source_type, external_id, name, last_synced_at
      `,
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function claimCatalogEvents(): Promise<DomainEventRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<DomainEventRow>(
      `
      UPDATE domain_events
      SET status = 'processing'
      WHERE id IN (
        SELECT id
        FROM domain_events
        WHERE status = 'pending'
          AND event_type = 'catalog.sync.requested'
          AND next_attempt_at <= now()
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      )
      RETURNING id, workspace_id, entity_id, attempts
      `,
      [maxCatalogEvents],
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function loadSource(id: string, workspaceId: string): Promise<CatalogSourceRow | null> {
  const result = await pool.query<CatalogSourceRow>(
    `
    SELECT id, workspace_id, channel_account_id, source_type, external_id, name, last_synced_at
    FROM catalog_sources
    WHERE id = $1 AND workspace_id = $2 AND status = 'active'
    LIMIT 1
    `,
    [id, workspaceId],
  );
  return result.rows[0] ?? null;
}

async function recordRun(source: CatalogSourceRow, startedAt: Date, result: SyncResult): Promise<void> {
  await pool.query(
    `
    INSERT INTO catalog_sync_runs (workspace_id, catalog_source_id, status, items_synced, items_failed, error, started_at, finished_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, now())
    `,
    [source.workspace_id, source.id, result.status, result.itemsSynced, result.itemsFailed, result.error ?? null, startedAt],
  );
}

async function markSource(source: CatalogSourceRow, result: SyncResult): Promise<void> {
  await pool.query(
    `
    UPDATE catalog_sources
    SET sync_status = $2,
        last_synced_at = CASE WHEN $2 = 'synced' THEN now() ELSE last_synced_at END,
        last_sync_error = $3,
        updated_at = now()
    WHERE id = $1
    `,
    [source.id, result.status === "failed" ? "failed" : "synced", result.error ?? null],
  );
}

async function syncProducts(source: CatalogSourceRow, logger: pino.Logger): Promise<number> {
  const accessToken = token();
  const rows = accessToken
    ? await collectPages<any>(`${source.external_id}/products?fields=id,name,description,price,currency,availability,inventory,image_url,url,brand,category`, accessToken)
    : dryRunProducts(source);
  if (!accessToken) logger.info({ sourceId: source.id }, "DRY_RUN Meta commerce catalog sync");

  const seenIds: string[] = [];
  for (const item of rows) {
    const externalProductId = String(item.retailer_id ?? item.id);
    seenIds.push(externalProductId);
    await pool.query(
      `
      INSERT INTO products (
        workspace_id, catalog_source_id, external_product_id, name, description, category, price, currency,
        availability, inventory_count, image_url, product_url, brand, raw, is_visible, synced_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, true, now(), now())
      ON CONFLICT (workspace_id, catalog_source_id, external_product_id)
      DO UPDATE SET name = excluded.name,
                    description = excluded.description,
                    category = excluded.category,
                    price = excluded.price,
                    currency = excluded.currency,
                    availability = excluded.availability,
                    inventory_count = excluded.inventory_count,
                    image_url = excluded.image_url,
                    product_url = excluded.product_url,
                    brand = excluded.brand,
                    raw = excluded.raw,
                    is_visible = true,
                    synced_at = now(),
                    updated_at = now()
      `,
      [
        source.workspace_id,
        source.id,
        externalProductId,
        String(item.name ?? externalProductId),
        item.description ? String(item.description) : null,
        item.category ? String(item.category) : null,
        parsePrice(item.price),
        item.currency ? String(item.currency) : "YER",
        item.availability ? String(item.availability) : null,
        Number.isFinite(Number(item.inventory)) ? Number(item.inventory) : null,
        item.image_url ? String(item.image_url) : null,
        item.url ? String(item.url) : null,
        item.brand ? String(item.brand) : null,
        JSON.stringify(item),
      ],
    );
  }

  if (seenIds.length > 0) {
    await pool.query(
      `
      UPDATE products
      SET is_visible = false, updated_at = now()
      WHERE workspace_id = $1
        AND catalog_source_id = $2
        AND NOT (external_product_id = ANY($3::text[]))
      `,
      [source.workspace_id, source.id, seenIds],
    );
  }

  await feedVisibleProductsToKnowledge(source);
  return rows.length;
}

async function syncPosts(source: CatalogSourceRow, logger: pino.Logger): Promise<number> {
  const accessToken = token();
  const rows = accessToken
    ? await collectPages<any>(`${source.external_id}/posts?fields=id,message,created_time,permalink_url,attachments,type`, accessToken)
    : dryRunPosts(source);
  if (!accessToken) logger.info({ sourceId: source.id }, "DRY_RUN Meta page posts sync");

  for (const item of rows) {
    const attachment = item.attachments?.data?.[0] ?? {};
    await pool.query(
      `
      INSERT INTO social_posts (workspace_id, catalog_source_id, external_post_id, message, post_type, permalink_url, media_url, published_at, raw, synced_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
      ON CONFLICT (workspace_id, catalog_source_id, external_post_id)
      DO UPDATE SET message = excluded.message,
                    post_type = excluded.post_type,
                    permalink_url = excluded.permalink_url,
                    media_url = excluded.media_url,
                    published_at = excluded.published_at,
                    raw = excluded.raw,
                    synced_at = now()
      `,
      [
        source.workspace_id,
        source.id,
        String(item.id),
        item.message ? String(item.message) : null,
        item.type ? String(item.type) : null,
        item.permalink_url ? String(item.permalink_url) : null,
        attachment.media?.image?.src ? String(attachment.media.image.src) : null,
        item.created_time ? new Date(item.created_time) : null,
        JSON.stringify(item),
      ],
    );
  }
  return rows.length;
}

async function syncAds(source: CatalogSourceRow, logger: pino.Logger): Promise<number> {
  const accessToken = token();
  const rows = accessToken
    ? await collectPages<any>(`${source.external_id}/ads?fields=id,name,status,objective,creative{body,image_url,object_story_spec},start_time,end_time`, accessToken)
    : dryRunAds(source);
  if (!accessToken) logger.info({ sourceId: source.id }, "DRY_RUN Meta ads sync");

  for (const item of rows) {
    const creative = item.creative ?? {};
    const promotedProductIds = [
      creative.object_story_spec?.template_data?.product_id,
      creative.object_story_spec?.link_data?.product_id,
    ].filter((value: unknown) => typeof value === "string");
    await pool.query(
      `
      INSERT INTO ad_campaigns (
        workspace_id, catalog_source_id, external_ad_id, name, status, objective, promoted_product_ids,
        ad_creative_text, ad_creative_image_url, start_time, end_time, raw, synced_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12::jsonb, now())
      ON CONFLICT (workspace_id, catalog_source_id, external_ad_id)
      DO UPDATE SET name = excluded.name,
                    status = excluded.status,
                    objective = excluded.objective,
                    promoted_product_ids = excluded.promoted_product_ids,
                    ad_creative_text = excluded.ad_creative_text,
                    ad_creative_image_url = excluded.ad_creative_image_url,
                    start_time = excluded.start_time,
                    end_time = excluded.end_time,
                    raw = excluded.raw,
                    synced_at = now()
      `,
      [
        source.workspace_id,
        source.id,
        String(item.id),
        String(item.name ?? item.id),
        item.status ? String(item.status) : null,
        item.objective ? String(item.objective) : null,
        JSON.stringify(promotedProductIds),
        creative.body ? String(creative.body) : null,
        creative.image_url ? String(creative.image_url) : null,
        item.start_time ? new Date(item.start_time) : null,
        item.end_time ? new Date(item.end_time) : null,
        JSON.stringify(item),
      ],
    );
  }
  return rows.length;
}

async function ensureCatalogKnowledgeBase(workspaceId: string): Promise<{ id: string; ownerId: string } | null> {
  const ownerResult = await pool.query<{ user_id: string }>(
    "SELECT user_id FROM workspace_memberships WHERE workspace_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    [workspaceId],
  );
  const ownerId = ownerResult.rows[0]?.user_id;
  if (!ownerId) return null;

  const existing = await pool.query<{ id: string }>(
    "SELECT id FROM knowledge_bases WHERE workspace_id = $1 AND name = 'Meta catalog mirror' LIMIT 1",
    [workspaceId],
  );
  if (existing.rows[0]) return { id: existing.rows[0].id, ownerId };

  const created = await pool.query<{ id: string }>(
    `
    INSERT INTO knowledge_bases (workspace_id, name, description, status, created_by)
    VALUES ($1, 'Meta catalog mirror', 'Read-only mirror of Meta catalog products for agent retrieval.', 'active', $2)
    RETURNING id
    `,
    [workspaceId, ownerId],
  );
  return { id: created.rows[0].id, ownerId };
}

async function feedVisibleProductsToKnowledge(source: CatalogSourceRow): Promise<void> {
  const base = await ensureCatalogKnowledgeBase(source.workspace_id);
  if (!base) return;

  const products = await pool.query<{
    id: string;
    external_product_id: string;
    name: string;
    description: string | null;
    price: string | null;
    currency: string | null;
    availability: string | null;
  }>(
    `
    SELECT id, external_product_id, name, description, price::text, currency, availability
    FROM products
    WHERE workspace_id = $1 AND catalog_source_id = $2 AND is_visible = true
    `,
    [source.workspace_id, source.id],
  );

  for (const product of products.rows) {
    const content = `منتج: ${product.name}. السعر: ${product.price ?? "غير محدد"} ${product.currency ?? "YER"}. التوفر: ${product.availability ?? "غير محدد"}. ${product.description ?? ""}`.trim();
    const contentHash = createHash("sha256").update(content).digest("hex");
    const sourceUrl = `catalog://product/${product.id}`;

    const sourceResult = await pool.query<{ id: string }>(
      "SELECT id FROM knowledge_sources WHERE workspace_id = $1 AND source_url = $2 LIMIT 1",
      [source.workspace_id, sourceUrl],
    );
    const knowledgeSourceId = sourceResult.rows[0]?.id ?? (await pool.query<{ id: string }>(
      `
      INSERT INTO knowledge_sources (workspace_id, knowledge_base_id, type, title, status, source_url, raw_text, metadata, created_by)
      VALUES ($1, $2, 'text', $3, 'ready', $4, $5, $6::jsonb, $7)
      RETURNING id
      `,
      [
        source.workspace_id,
        base.id,
        `Catalog product ${product.external_product_id}`,
        sourceUrl,
        content,
        JSON.stringify({ source: "catalog", productId: product.id, contentHash }),
        base.ownerId,
      ],
    )).rows[0].id;

    const documentResult = await pool.query<{ id: string; content_text: string }>(
      "SELECT id, content_text FROM knowledge_documents WHERE workspace_id = $1 AND source_id = $2 LIMIT 1",
      [source.workspace_id, knowledgeSourceId],
    );
    if (documentResult.rows[0]?.content_text === content) continue;

    const documentId = documentResult.rows[0]?.id ?? (await pool.query<{ id: string }>(
      `
      INSERT INTO knowledge_documents (workspace_id, knowledge_base_id, source_id, title, content_text, status, token_estimate, created_by)
      VALUES ($1, $2, $3, $4, $5, 'ready', $6, $7)
      RETURNING id
      `,
      [source.workspace_id, base.id, knowledgeSourceId, product.name, content, Math.ceil(content.length / 4), base.ownerId],
    )).rows[0].id;

    if (documentResult.rows[0]) {
      await pool.query(
        "UPDATE knowledge_documents SET title = $3, content_text = $4, status = 'ready', updated_at = now() WHERE id = $1 AND workspace_id = $2",
        [documentId, source.workspace_id, product.name, content],
      );
    }

    await pool.query(
      "UPDATE knowledge_sources SET raw_text = $3, metadata = $4::jsonb, updated_at = now() WHERE id = $1 AND workspace_id = $2",
      [knowledgeSourceId, source.workspace_id, content, JSON.stringify({ source: "catalog", productId: product.id, contentHash })],
    );
    await pool.query("DELETE FROM knowledge_chunks WHERE document_id = $1 AND workspace_id = $2", [documentId, source.workspace_id]);
    await pool.query(
      `
      INSERT INTO knowledge_chunks (workspace_id, knowledge_base_id, document_id, chunk_index, chunk_text, token_estimate, embedding_status, embedding_ref, metadata)
      VALUES ($1, $2, $3, 0, $4, $5, 'skipped', $6, $7::jsonb)
      `,
      [
        source.workspace_id,
        base.id,
        documentId,
        content,
        Math.ceil(content.length / 4),
        `sha256:${contentHash}`,
        JSON.stringify({ source: "catalog", productId: product.id }),
      ],
    );
  }
}

async function syncSource(source: CatalogSourceRow, logger: pino.Logger): Promise<SyncResult> {
  const startedAt = new Date();
  try {
    let itemsSynced = 0;
    if (source.source_type === "commerce_catalog") itemsSynced = await syncProducts(source, logger);
    else if (source.source_type === "page_posts") itemsSynced = await syncPosts(source, logger);
    else if (source.source_type === "ads") itemsSynced = await syncAds(source, logger);
    else throw new Error(`Unsupported source type ${source.source_type}`);

    const result: SyncResult = { status: "success", itemsSynced, itemsFailed: 0 };
    await markSource(source, result);
    await recordRun(source, startedAt, result);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const result: SyncResult = { status: "failed", itemsSynced: 0, itemsFailed: 1, error };
    await markSource(source, result);
    await recordRun(source, startedAt, result);
    return result;
  }
}

async function markCatalogEventProcessed(id: string): Promise<void> {
  await pool.query("UPDATE domain_events SET status = 'processed', processed_at = now() WHERE id = $1", [id]);
}

async function markCatalogEventFailed(event: DomainEventRow, err: unknown): Promise<void> {
  const attempts = event.attempts + 1;
  const failed = attempts >= maxAttempts;
  const errorMessage = err instanceof Error ? err.message : String(err);
  await pool.query(
    `
    UPDATE domain_events
    SET attempts = $2,
        status = $3,
        next_attempt_at = now() + ($4 || ' seconds')::interval,
        payload = payload || jsonb_build_object('last_error', $5::text)
    WHERE id = $1
    `,
    [event.id, attempts, failed ? "failed" : "pending", Math.pow(2, attempts), errorMessage.slice(0, 500)],
  );
}

export async function pollCatalogSync(logger: pino.Logger): Promise<number> {
  let processed = 0;
  for (const source of await claimDueSources()) {
    await syncSource(source, logger);
    processed += 1;
  }

  for (const event of await claimCatalogEvents()) {
    try {
      const source = await loadSource(event.entity_id, event.workspace_id);
      if (!source) throw new Error("Catalog source not found");
      await syncSource(source, logger);
      await markCatalogEventProcessed(event.id);
      processed += 1;
    } catch (err) {
      logger.warn({ err, eventId: event.id }, "Catalog sync event failed");
      await markCatalogEventFailed(event, err);
    }
  }

  return processed;
}
