import { Router, type Response } from "express";
import { auditFromRequest, createAuditLog } from "../../lib/audit";
import type { AuthenticatedRequest } from "../../lib/types";
import { requirePermission } from "../../middlewares/requirePermission";
import { requireSession } from "../../middlewares/requireSession";
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomationRuns,
  listAutomations,
  setAutomationStatus,
  testRunAutomation,
  updateAutomation,
} from "./automations.service";
import { createAutomationSchema, listAutomationsQuerySchema, testRunSchema, updateAutomationSchema } from "./automations.schema";

const router = Router();
router.use(requireSession);

router.get("/", requirePermission("automations:read"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = listAutomationsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }
  res.json(await listAutomations(req.sessionUser.activeWorkspaceId, parsed.data));
});

router.get("/:id", requirePermission("automations:read"), async (req: AuthenticatedRequest, res: Response) => {
  res.json(await getAutomation(req.sessionUser.activeWorkspaceId, req.params.id as string));
});

router.post("/", requirePermission("automations:write"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createAutomationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const automation = await createAutomation(req.sessionUser.activeWorkspaceId, req.sessionUser.userId, parsed.data);
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "automation_create",
    severity: "info",
    entityType: "automation",
    entityId: automation.id,
    entityLabel: automation.name,
    newData: { trigger: automation.trigger, actionCount: Array.isArray(automation.actions) ? automation.actions.length : 0 },
  });
  res.status(201).json({ automation });
});

router.patch("/:id", requirePermission("automations:write"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateAutomationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const automation = await updateAutomation(req.sessionUser.activeWorkspaceId, req.params.id as string, parsed.data);
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "automation_update",
    severity: "info",
    entityType: "automation",
    entityId: automation.id,
    entityLabel: automation.name,
    newData: parsed.data,
  });
  res.json({ automation });
});

router.delete("/:id", requirePermission("automations:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const automation = await deleteAutomation(req.sessionUser.activeWorkspaceId, req.params.id as string);
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "automation_delete",
    severity: "warning",
    entityType: "automation",
    entityId: automation.id,
    entityLabel: automation.name,
    oldData: { status: automation.status },
  });
  res.json({ message: "تم حذف الأتمتة" });
});

router.post("/:id/activate", requirePermission("automations:activate"), async (req: AuthenticatedRequest, res: Response) => {
  const automation = await setAutomationStatus(req.sessionUser.activeWorkspaceId, req.params.id as string, "active");
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "automation_activate",
    severity: "info",
    entityType: "automation",
    entityId: automation.id,
    entityLabel: automation.name,
    newData: { status: "active" },
  });
  res.json({ automation });
});

router.post("/:id/pause", requirePermission("automations:activate"), async (req: AuthenticatedRequest, res: Response) => {
  const automation = await setAutomationStatus(req.sessionUser.activeWorkspaceId, req.params.id as string, "paused");
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "automation_pause",
    severity: "info",
    entityType: "automation",
    entityId: automation.id,
    entityLabel: automation.name,
    newData: { status: "paused" },
  });
  res.json({ automation });
});

router.post("/:id/test-run", requirePermission("automations:write"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = testRunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const result = await testRunAutomation(req.sessionUser.activeWorkspaceId, req.params.id as string, parsed.data);
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "automation_test_run",
    severity: "info",
    entityType: "automation",
    entityId: req.params.id as string,
    newData: { dryRun: true, shouldRun: result.shouldRun },
  });
  res.json(result);
});

router.get("/:id/runs", requirePermission("automations:read"), async (req: AuthenticatedRequest, res: Response) => {
  res.json(await listAutomationRuns(req.sessionUser.activeWorkspaceId, req.params.id as string));
});

export default router;
