import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  workspacesTable,
  workspaceMembershipsTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { registerWorkspace, loginUser, loadUserPermissions, hashPassword, verifyPassword } from "./auth.service";
import { createAuditLog } from "../../lib/audit";
import type { AuthenticatedRequest } from "../../lib/types";
import { logger } from "../../lib/logger";
import { authLimiter, changePasswordLimiter } from "../../lib/rateLimiter";

const router = Router();

const registerSchema = z.object({
  ownerName: z.string().min(2, "الاسم يجب أن يكون على الأقل حرفين").max(100),
  email: z.string().email("بريد إلكتروني غير صحيح"),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
  workspaceName: z.string().min(2, "اسم المنشأة يجب أن يكون على الأقل حرفين").max(100),
});

const loginSchema = z.object({
  email: z.string().email("بريد إلكتروني غير صحيح"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
});

router.post("/register", authLimiter, async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  try {
    const { user, workspace, membership } = await registerWorkspace(parsed.data);

    const { permissions, roleSlugs } = await loadUserPermissions(membership.id);

    const sessionUser = {
      userId: user.id,
      activeWorkspaceId: workspace.id,
      activeMembershipId: membership.id,
      permissions,
      roleSlugs,
      name: user.name,
      email: user.email,
    };

    req.session.user = sessionUser;

    await createAuditLog({
      workspaceId: workspace.id,
      actorType: "user",
      actorId: user.id,
      actorLabel: user.name,
      action: "register",
      severity: "info",
      entityType: "workspace",
      entityId: workspace.id,
      entityLabel: workspace.name,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({
      message: "تم إنشاء الحساب بنجاح",
      user: { id: user.id, name: user.name, email: user.email },
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "حدث خطأ داخلي";
    logger.error({ err }, "Registration failed");
    const statusCode = message.includes("مسجل") ? 409 : 500;
    res.status(statusCode).json({ error: message });
  }
});

router.post("/login", authLimiter, async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  try {
    const sessionData = await loginUser({
      email: parsed.data.email,
      password: parsed.data.password,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    req.session.user = sessionData;

    await createAuditLog({
      workspaceId: sessionData.activeWorkspaceId,
      actorType: "user",
      actorId: sessionData.userId,
      actorLabel: sessionData.name,
      action: "login",
      severity: "info",
      entityType: "user",
      entityId: sessionData.userId,
      entityLabel: sessionData.email,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({
      message: "تم تسجيل الدخول بنجاح",
      user: {
        id: sessionData.userId,
        name: sessionData.name,
        email: sessionData.email,
        permissions: sessionData.permissions,
        roleSlugs: sessionData.roleSlugs,
      },
      workspaceId: sessionData.activeWorkspaceId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "حدث خطأ داخلي";
    logger.error({ err }, "Login failed");
    res.status(401).json({ error: message });
  }
});

router.post("/logout", requireSession, async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { userId, name, activeWorkspaceId } = authReq.sessionUser;

  await createAuditLog({
    workspaceId: activeWorkspaceId,
    actorType: "user",
    actorId: userId,
    actorLabel: name,
    action: "logout",
    severity: "info",
    entityType: "user",
    entityId: userId,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  req.session.destroy((err) => {
    if (err) logger.error({ err }, "Session destroy failed");
    res.clearCookie("khadamatak.sid");
    res.json({ message: "تم تسجيل الخروج بنجاح" });
  });
});

router.get("/me", requireSession, async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { userId, activeWorkspaceId, activeMembershipId } = authReq.sessionUser;

  try {
    const [workspace] = await db
      .select({ id: workspacesTable.id, name: workspacesTable.name, slug: workspacesTable.slug, status: workspacesTable.status, plan: workspacesTable.plan })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, activeWorkspaceId))
      .limit(1);

    const { permissions, roleSlugs } = await loadUserPermissions(activeMembershipId);

    req.session.user = { ...authReq.sessionUser, permissions, roleSlugs };

    res.json({
      user: {
        id: userId,
        name: authReq.sessionUser.name,
        email: authReq.sessionUser.email,
        permissions,
        roleSlugs,
      },
      workspace,
    });
  } catch (err) {
    logger.error({ err }, "Failed to load /me");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "كلمة المرور الحالية مطلوبة"),
  newPassword: z.string().min(8, "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل"),
  confirmPassword: z.string().min(1, "تأكيد كلمة المرور مطلوب"),
});

router.post("/change-password", changePasswordLimiter, requireSession, async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  if (newPassword !== confirmPassword) {
    res.status(400).json({ error: "كلمتا المرور غير متطابقتين" });
    return;
  }

  if (newPassword === currentPassword) {
    res.status(400).json({ error: "لا يمكن استخدام كلمة المرور الحالية ككلمة مرور جديدة" });
    return;
  }

  try {
    const [user] = await db
      .select({ id: usersTable.id, name: usersTable.name, passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(eq(usersTable.id, authReq.sessionUser.userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "المستخدم غير موجود" });
      return;
    }

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(400).json({ error: "كلمة المرور الحالية غير صحيحة" });
      return;
    }

    const newHash = await hashPassword(newPassword);

    await db
      .update(usersTable)
      .set({ passwordHash: newHash })
      .where(eq(usersTable.id, user.id));

    await createAuditLog({
      workspaceId: authReq.sessionUser.activeWorkspaceId,
      actorType: "user",
      actorId: user.id,
      actorLabel: user.name,
      action: "user_password_change",
      severity: "warning",
      entityType: "user",
      entityId: user.id,
      entityLabel: user.name,
      oldData: {},
      newData: {},
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ message: "تم تغيير كلمة المرور بنجاح" });
  } catch (err) {
    logger.error({ err }, "Change password failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

router.post("/switch-workspace", requireSession, async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { workspaceId } = req.body;

  if (!workspaceId || typeof workspaceId !== "string") {
    res.status(400).json({ error: "معرف المنشأة مطلوب" });
    return;
  }

  try {
    const [membership] = await db
      .select()
      .from(workspaceMembershipsTable)
      .where(
        eq(workspaceMembershipsTable.userId, authReq.sessionUser.userId)
      )
      .limit(1);

    if (!membership || membership.workspaceId !== workspaceId) {
      res.status(403).json({ error: "ليس لديك وصول لهذه المنشأة" });
      return;
    }

    const { permissions, roleSlugs } = await loadUserPermissions(membership.id);

    req.session.user = {
      ...authReq.sessionUser,
      activeWorkspaceId: workspaceId,
      activeMembershipId: membership.id,
      permissions,
      roleSlugs,
    };

    await createAuditLog({
      workspaceId,
      actorType: "user",
      actorId: authReq.sessionUser.userId,
      actorLabel: authReq.sessionUser.name,
      action: "switch_workspace",
      severity: "info",
      entityType: "workspace",
      entityId: workspaceId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ message: "تم تبديل المنشأة بنجاح", workspaceId });
  } catch (err) {
    logger.error({ err }, "Switch workspace failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

export default router;
