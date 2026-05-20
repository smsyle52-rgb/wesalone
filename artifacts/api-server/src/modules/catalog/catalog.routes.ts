import { Router, type Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { catalogSourcesTable, db } from "@workspace/db";
import { auditFromRequest, createAuditLog } from "../../lib/audit";
import { publishDomainEvent } from "../../lib/events";
import type { AuthenticatedRequest } from "../../lib/types";
import { requirePermission } from "../../middlewares/requirePermission";
import { requireSession } from "../../middlewares/requireSession";

const router = Router();
router.use(requireSession);

const paramsSchema = z.object({ id: z.string().uuid() });

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

export default router;
