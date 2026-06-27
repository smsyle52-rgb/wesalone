import express, { Router, type Response } from "express";
import { auditFromRequest, createAuditLog } from "../../lib/audit";
import type { AuthenticatedRequest } from "../../lib/types";
import { requirePermission } from "../../middlewares/requirePermission";
import { requireSession } from "../../middlewares/requireSession";
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  submitTemplate,
  syncAllTemplates,
  syncTemplate,
  updateTemplate,
  uploadHeaderMediaService,
} from "./templates.service";
import { createTemplateSchema, listTemplatesQuerySchema, updateTemplateSchema } from "./templates.schema";

const router = Router();
router.use(requireSession);

router.get("/", requirePermission("templates:read"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = listTemplatesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  res.json(await listTemplates(req.sessionUser.activeWorkspaceId, parsed.data));
});

router.get("/:id", requirePermission("templates:read"), async (req: AuthenticatedRequest, res: Response) => {
  res.json(await getTemplate(req.sessionUser.activeWorkspaceId, req.params.id as string));
});

router.post("/", requirePermission("templates:write"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const template = await createTemplate(req.sessionUser.activeWorkspaceId, req.sessionUser.userId, parsed.data);
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "template_create",
    severity: "info",
    entityType: "whatsapp_template",
    entityId: template.id,
    entityLabel: template.name,
    newData: { name: template.name, language: template.language, category: template.category },
  });

  res.status(201).json({ template });
});

router.patch("/:id", requirePermission("templates:write"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const template = await updateTemplate(req.sessionUser.activeWorkspaceId, req.params.id as string, parsed.data);
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "template_update",
    severity: "info",
    entityType: "whatsapp_template",
    entityId: template.id,
    entityLabel: template.name,
    newData: parsed.data,
  });

  res.json({ template });
});

router.delete("/:id", requirePermission("templates:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const template = await deleteTemplate(req.sessionUser.activeWorkspaceId, req.params.id as string);
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "template_delete",
    severity: "warning",
    entityType: "whatsapp_template",
    entityId: template.id,
    entityLabel: template.name,
    oldData: { status: template.status },
  });

  res.json({ message: "تم حذف القالب" });
});

router.post("/:id/duplicate", requirePermission("templates:write"), async (req: AuthenticatedRequest, res: Response) => {
  const template = await duplicateTemplate(req.sessionUser.activeWorkspaceId, req.sessionUser.userId, req.params.id as string);
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "template_duplicate",
    severity: "info",
    entityType: "whatsapp_template",
    entityId: template.id,
    entityLabel: template.name,
    newData: { sourceTemplateId: req.params.id },
  });

  res.status(201).json({ template });
});

router.post("/:id/submit", requirePermission("templates:submit"), async (req: AuthenticatedRequest, res: Response) => {
  const template = await submitTemplate(req.sessionUser.activeWorkspaceId, req.params.id as string);
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "template_submit",
    severity: "info",
    entityType: "whatsapp_template",
    entityId: template.id,
    entityLabel: template.name,
    newData: { status: template.status, metaTemplateId: template.metaTemplateId, dryRun: !template.metaTemplateId },
  });

  res.json({ template, submitted: true, externalCall: Boolean(template.metaTemplateId) });
});

router.post("/:id/sync", requirePermission("templates:read"), async (req: AuthenticatedRequest, res: Response) => {
  const result = await syncTemplate(req.sessionUser.activeWorkspaceId, req.params.id as string);
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "template_sync",
    severity: "info",
    entityType: "whatsapp_template",
    entityId: result.template.id,
    entityLabel: result.template.name,
    newData: { mode: result.mode, synced: result.synced, status: result.template.status },
  });

  res.json(result);
});

router.post("/sync-all", requirePermission("templates:submit"), async (req: AuthenticatedRequest, res: Response) => {
  const channelAccountId = req.body?.channelAccountId as string | undefined;
  const result = await syncAllTemplates(req.sessionUser.activeWorkspaceId, channelAccountId);
  res.json(result);
});

// Raw binary upload for IMAGE/VIDEO/DOCUMENT header examples → returns header_handle
router.post(
  "/header-media",
  express.raw({ type: ["image/*", "video/*", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], limit: "20mb" }),
  requirePermission("templates:write"),
  async (req: AuthenticatedRequest, res: Response) => {
    const mimeType = ((req.headers["content-type"] as string | undefined) ?? "").split(";")[0].trim();
    const fileName = (req.headers["x-file-name"] as string | undefined) ?? "header_media";
    const channelAccountId = req.headers["x-channel-account-id"] as string | undefined;
    const fileBuffer = req.body as Buffer;

    if (!fileBuffer?.length) {
      res.status(400).json({ error: "الملف فارغ أو غير مقبول" });
      return;
    }

    const result = await uploadHeaderMediaService(
      req.sessionUser.activeWorkspaceId,
      channelAccountId,
      fileBuffer,
      mimeType,
      fileName,
    );

    res.json(result);
  },
);

export default router;
