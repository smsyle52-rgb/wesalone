import { Router, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, ilike, type SQL } from "drizzle-orm";
import {
  adCampaignsTable,
  catalogSourcesTable,
  catalogSyncRunsTable,
  db,
  productsTable,
  socialPostsTable,
} from "@workspace/db";
import { auditFromRequest, createAuditLog } from "../../lib/audit";
import { publishDomainEvent } from "../../lib/events";
import type { AuthenticatedRequest } from "../../lib/types";
import { requirePermission } from "../../middlewares/requirePermission";
import { requireSession } from "../../middlewares/requireSession";

const router = Router();
router.use(requireSession);

const paramsSchema = z.object({ id: z.string().uuid() });
const createSourceSchema = z.object({
  sourceType: z.enum(["commerce_catalog", "page_posts", "ads"]),
  externalId: z.string().min(1),
  name: z.string().min(1),
  channelAccountId: z.string().uuid().optional().nullable(),
  config: z.record(z.string(), z.unknown()).optional(),
});
const listProductsSchema = z.object({
  availability: z.string().optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const patchProductSchema = z.object({ isVisible: z.boolean() });

router.get("/sources", requirePermission("catalog:read"), async (req: AuthenticatedRequest, res: Response) => {
  const sources = await db.select()
    .from(catalogSourcesTable)
    .where(eq(catalogSourcesTable.workspaceId, req.sessionUser.activeWorkspaceId))
    .orderBy(desc(catalogSourcesTable.updatedAt));
  res.json({ sources });
});

router.post("/sources", requirePermission("catalog:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createSourceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات المصدر غير صحيحة" });
    return;
  }

  const [source] = await db.insert(catalogSourcesTable).values({
    workspaceId: req.sessionUser.activeWorkspaceId,
    channelAccountId: parsed.data.channelAccountId ?? null,
    sourceType: parsed.data.sourceType,
    externalId: parsed.data.externalId,
    name: parsed.data.name,
    config: parsed.data.config ?? {},
  }).onConflictDoUpdate({
    target: [catalogSourcesTable.workspaceId, catalogSourcesTable.sourceType, catalogSourcesTable.externalId],
    set: {
      name: parsed.data.name,
      channelAccountId: parsed.data.channelAccountId ?? null,
      config: parsed.data.config ?? {},
      status: "active",
      updatedAt: new Date(),
    },
  }).returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "catalog_source_create",
    severity: "info",
    entityType: "catalog_source",
    entityId: source.id,
    entityLabel: source.name,
    newData: { sourceType: source.sourceType, externalId: source.externalId },
  });

  res.status(201).json({ source });
});

router.post("/sources/:id/sync", requirePermission("catalog:sync"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = paramsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "معرف مصدر غير صالح" });
    return;
  }

  const [source] = await db.select()
    .from(catalogSourcesTable)
    .where(and(
      eq(catalogSourcesTable.id, parsed.data.id),
      eq(catalogSourcesTable.workspaceId, req.sessionUser.activeWorkspaceId),
    ))
    .limit(1);

  if (!source) {
    res.status(404).json({ error: "مصدر الكتالوج غير موجود" });
    return;
  }

  await publishDomainEvent({
    eventType: "catalog.sync.requested",
    entityType: "catalog_source",
    entityId: source.id,
    payload: { catalogSourceId: source.id, sourceType: source.sourceType },
    sessionUser: req.sessionUser,
  });

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "catalog_sync_requested",
    severity: "info",
    entityType: "catalog_source",
    entityId: source.id,
    entityLabel: source.name,
    newData: { sourceType: source.sourceType },
  });

  res.status(202).json({ queued: true, sourceId: source.id });
});

router.delete("/sources/:id", requirePermission("catalog:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = paramsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "معرف مصدر غير صالح" });
    return;
  }

  const [source] = await db.update(catalogSourcesTable)
    .set({ status: "paused", updatedAt: new Date() })
    .where(and(
      eq(catalogSourcesTable.id, parsed.data.id),
      eq(catalogSourcesTable.workspaceId, req.sessionUser.activeWorkspaceId),
    ))
    .returning();

  if (!source) {
    res.status(404).json({ error: "مصدر الكتالوج غير موجود" });
    return;
  }

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "catalog_source_disable",
    severity: "warning",
    entityType: "catalog_source",
    entityId: source.id,
    entityLabel: source.name,
  });

  res.json({ source });
});

router.get("/products", requirePermission("catalog:read"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = listProductsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "مرشحات غير صحيحة" });
    return;
  }

  const conditions: SQL[] = [eq(productsTable.workspaceId, req.sessionUser.activeWorkspaceId)];
  if (parsed.data.availability) conditions.push(eq(productsTable.availability, parsed.data.availability));
  if (parsed.data.category) conditions.push(eq(productsTable.category, parsed.data.category));
  if (parsed.data.search) conditions.push(ilike(productsTable.name, `%${parsed.data.search}%`));

  const products = await db.select({
    product: productsTable,
    sourceName: catalogSourcesTable.name,
    sourceType: catalogSourcesTable.sourceType,
  })
    .from(productsTable)
    .leftJoin(catalogSourcesTable, eq(productsTable.catalogSourceId, catalogSourcesTable.id))
    .where(and(...conditions))
    .orderBy(desc(productsTable.syncedAt))
    .limit(parsed.data.limit)
    .offset(parsed.data.offset);

  res.json({ products });
});

router.get("/products/:id", requirePermission("catalog:read"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = paramsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "معرف منتج غير صالح" });
    return;
  }
  const [product] = await db.select()
    .from(productsTable)
    .where(and(eq(productsTable.id, parsed.data.id), eq(productsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);
  if (!product) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }
  res.json({ product });
});

router.patch("/products/:id", requirePermission("catalog:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const params = paramsSchema.safeParse(req.params);
  const body = patchProductSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "بيانات المنتج غير صحيحة" });
    return;
  }

  const [product] = await db.update(productsTable)
    .set({ isVisible: body.data.isVisible, updatedAt: new Date() })
    .where(and(eq(productsTable.id, params.data.id), eq(productsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .returning();
  if (!product) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }
  res.json({ product });
});

router.get("/posts", requirePermission("catalog:read"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "مرشحات غير صحيحة" });
    return;
  }
  const posts = await db.select({ post: socialPostsTable, sourceName: catalogSourcesTable.name })
    .from(socialPostsTable)
    .leftJoin(catalogSourcesTable, eq(socialPostsTable.catalogSourceId, catalogSourcesTable.id))
    .where(eq(socialPostsTable.workspaceId, req.sessionUser.activeWorkspaceId))
    .orderBy(desc(socialPostsTable.publishedAt))
    .limit(parsed.data.limit)
    .offset(parsed.data.offset);
  res.json({ posts });
});

router.get("/ads", requirePermission("catalog:read"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "مرشحات غير صحيحة" });
    return;
  }
  const ads = await db.select({ ad: adCampaignsTable, sourceName: catalogSourcesTable.name })
    .from(adCampaignsTable)
    .leftJoin(catalogSourcesTable, eq(adCampaignsTable.catalogSourceId, catalogSourcesTable.id))
    .where(eq(adCampaignsTable.workspaceId, req.sessionUser.activeWorkspaceId))
    .orderBy(desc(adCampaignsTable.syncedAt))
    .limit(parsed.data.limit)
    .offset(parsed.data.offset);
  res.json({ ads });
});

router.get("/sync-runs", requirePermission("catalog:read"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "مرشحات غير صحيحة" });
    return;
  }
  const runs = await db.select({ run: catalogSyncRunsTable, sourceName: catalogSourcesTable.name })
    .from(catalogSyncRunsTable)
    .leftJoin(catalogSourcesTable, eq(catalogSyncRunsTable.catalogSourceId, catalogSourcesTable.id))
    .where(eq(catalogSyncRunsTable.workspaceId, req.sessionUser.activeWorkspaceId))
    .orderBy(desc(catalogSyncRunsTable.startedAt))
    .limit(parsed.data.limit)
    .offset(parsed.data.offset);
  res.json({ runs });
});

export default router;
