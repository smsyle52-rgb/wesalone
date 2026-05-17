import { Router, type Response } from "express";
import { auditFromRequest, createAuditLog } from "../../lib/audit";
import type { AuthenticatedRequest } from "../../lib/types";
import { requirePermission } from "../../middlewares/requirePermission";
import { requireSession } from "../../middlewares/requireSession";
import {
  cancelBroadcast,
  createBroadcast,
  getBroadcast,
  getBroadcastStats,
  listBroadcasts,
  listRecipients,
  previewBroadcast,
  startBroadcast,
  updateBroadcast,
} from "./broadcasts.service";
import { createBroadcastSchema, listBroadcastsQuerySchema, updateBroadcastSchema } from "./broadcasts.schema";

const router = Router();
router.use(requireSession);

router.get("/", requirePermission("broadcasts:read"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = listBroadcastsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }
  res.json(await listBroadcasts(req.sessionUser.activeWorkspaceId, parsed.data));
});

router.get("/:id", requirePermission("broadcasts:read"), async (req: AuthenticatedRequest, res: Response) => {
  res.json(await getBroadcast(req.sessionUser.activeWorkspaceId, req.params.id as string));
});

router.post("/", requirePermission("broadcasts:write"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createBroadcastSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }
  const broadcast = await createBroadcast(req.sessionUser.activeWorkspaceId, req.sessionUser.userId, parsed.data);
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "broadcast_create",
    severity: "info",
    entityType: "broadcast",
    entityId: broadcast.id,
    entityLabel: broadcast.name,
    newData: { templateId: broadcast.templateId, channelAccountId: broadcast.channelAccountId },
  });
  res.status(201).json({ broadcast });
});

router.patch("/:id", requirePermission("broadcasts:write"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateBroadcastSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }
  const broadcast = await updateBroadcast(req.sessionUser.activeWorkspaceId, req.params.id as string, parsed.data);
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "broadcast_update",
    severity: "info",
    entityType: "broadcast",
    entityId: broadcast.id,
    entityLabel: broadcast.name,
    newData: parsed.data,
  });
  res.json({ broadcast });
});

router.post("/:id/preview", requirePermission("broadcasts:read"), async (req: AuthenticatedRequest, res: Response) => {
  res.json(await previewBroadcast(req.sessionUser.activeWorkspaceId, req.params.id as string));
});

router.post("/:id/start", requirePermission("broadcasts:send"), async (req: AuthenticatedRequest, res: Response) => {
  const result = await startBroadcast(req.sessionUser.activeWorkspaceId, req.params.id as string);
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "broadcast_start",
    severity: "info",
    entityType: "broadcast",
    entityId: result.broadcast.id,
    entityLabel: result.broadcast.name,
    newData: { audienceCount: result.audienceCount, status: result.broadcast.status },
  });
  res.json(result);
});

router.post("/:id/cancel", requirePermission("broadcasts:cancel"), async (req: AuthenticatedRequest, res: Response) => {
  const result = await cancelBroadcast(req.sessionUser.activeWorkspaceId, req.params.id as string);
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "broadcast_cancel",
    severity: "warning",
    entityType: "broadcast",
    entityId: result.broadcast.id,
    entityLabel: result.broadcast.name,
    newData: { status: result.broadcast.status },
  });
  res.json(result);
});

router.get("/:id/recipients", requirePermission("broadcasts:read"), async (req: AuthenticatedRequest, res: Response) => {
  res.json(await listRecipients(req.sessionUser.activeWorkspaceId, req.params.id as string, req.query.status as string | undefined));
});

router.get("/:id/stats", requirePermission("broadcasts:read"), async (req: AuthenticatedRequest, res: Response) => {
  res.json(await getBroadcastStats(req.sessionUser.activeWorkspaceId, req.params.id as string));
});

export default router;
