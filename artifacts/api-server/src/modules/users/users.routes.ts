import { Router, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  usersTable,
  workspaceMembershipsTable,
  rolesTable,
  membershipRolesTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { hashPassword } from "../auth/auth.service";
import type { AuthenticatedRequest } from "../../lib/types";
import { logger } from "../../lib/logger";

const router = Router();

router.use(requireSession);

router.get("/", requirePermission("team:read"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  try {
    const members = await db
      .select({
        membershipId: workspaceMembershipsTable.id,
        userId: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        phone: usersTable.phone,
        avatarUrl: usersTable.avatarUrl,
        status: workspaceMembershipsTable.status,
        joinedAt: workspaceMembershipsTable.joinedAt,
        lastSeenAt: usersTable.lastSeenAt,
        availability: workspaceMembershipsTable.availability,
      })
      .from(workspaceMembershipsTable)
      .innerJoin(usersTable, eq(workspaceMembershipsTable.userId, usersTable.id))
      .where(eq(workspaceMembershipsTable.workspaceId, authReq.sessionUser.activeWorkspaceId));

    res.json({ members });
  } catch (err) {
    logger.error({ err }, "Failed to list users");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

const availabilitySchema = z.object({
  availability: z.enum(["online", "away", "offline"]),
});

// W5-T1 (partial): self-service presence toggle. Scoped to the caller's own
// membership only — no permission beyond being logged in, matching the fact
// that this reflects the agent's own reported state, not something managed
// on their behalf. Auto-assignment reading this field stays deferred with W3-T1.
router.patch("/me/availability", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const parsed = availabilitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const [membership] = await db
    .update(workspaceMembershipsTable)
    .set({ availability: parsed.data.availability })
    .where(and(
      eq(workspaceMembershipsTable.id, authReq.sessionUser.activeMembershipId),
      eq(workspaceMembershipsTable.workspaceId, authReq.sessionUser.activeWorkspaceId),
    ))
    .returning({ id: workspaceMembershipsTable.id, availability: workspaceMembershipsTable.availability });

  if (!membership) { res.status(404).json({ error: "العضوية غير موجودة" }); return; }

  res.json({ availability: membership.availability });
});

const inviteSchema = z.object({
  name: z.string().min(2, "الاسم يجب أن يكون على الأقل حرفين"),
  email: z.string().email("بريد إلكتروني غير صحيح"),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
  roleSlug: z.enum(["manager", "agent", "accountant", "viewer"], {
    errorMap: () => ({ message: "الدور يجب أن يكون: manager أو agent أو accountant أو viewer" }),
  }),
});

router.post("/invite", requirePermission("users:invite"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  try {
    const { name, email, password, roleSlug } = parsed.data;

    let [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .limit(1);

    if (!user) {
      const passwordHash = await hashPassword(password);
      [user] = await db
        .insert(usersTable)
        .values({ name, email: email.toLowerCase(), passwordHash })
        .returning();
    }

    const [existingMembership] = await db
      .select()
      .from(workspaceMembershipsTable)
      .where(
        and(
          eq(workspaceMembershipsTable.workspaceId, authReq.sessionUser.activeWorkspaceId),
          eq(workspaceMembershipsTable.userId, user.id),
        )
      )
      .limit(1);

    if (existingMembership) {
      res.status(409).json({ error: "هذا المستخدم موجود مسبقاً في المنشأة" });
      return;
    }

    const [membership] = await db
      .insert(workspaceMembershipsTable)
      .values({
        workspaceId: authReq.sessionUser.activeWorkspaceId,
        userId: user.id,
        status: "active",
        invitedBy: authReq.sessionUser.userId,
        joinedAt: new Date(),
      })
      .returning();

    const [role] = await db
      .select()
      .from(rolesTable)
      .where(and(eq(rolesTable.slug, roleSlug), eq(rolesTable.isSystem, true)))
      .limit(1);

    if (role) {
      await db.insert(membershipRolesTable).values({
        membershipId: membership.id,
        roleId: role.id,
        assignedBy: authReq.sessionUser.userId,
      });
    }

    await createAuditLog({
      ...auditFromRequest(req, authReq.sessionUser),
      action: "invite",
      severity: "warning",
      entityType: "user",
      entityId: user.id,
      entityLabel: `${user.name} (${roleSlug})`,
      newData: { userId: user.id, email: user.email, roleSlug, membershipId: membership.id },
    });

    res.status(201).json({
      message: "تم دعوة الموظف بنجاح",
      member: { id: user.id, name: user.name, email: user.email, role: roleSlug },
    });
  } catch (err) {
    logger.error({ err }, "Failed to invite user");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

const changeRoleSchema = z.object({
  roleSlug: z.enum(["manager", "agent", "accountant", "viewer"], {
    errorMap: () => ({ message: "الدور غير صحيح. الأدوار المتاحة: manager, agent, accountant, viewer" }),
  }),
});

router.patch("/:membershipId/role", requirePermission("users:manage_roles"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const parsed = changeRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const membershipId = req.params.membershipId as string;

  try {
    const [membership] = await db
      .select({ id: workspaceMembershipsTable.id, userId: workspaceMembershipsTable.userId })
      .from(workspaceMembershipsTable)
      .where(
        and(
          eq(workspaceMembershipsTable.id, membershipId),
          eq(workspaceMembershipsTable.workspaceId, authReq.sessionUser.activeWorkspaceId),
        )
      )
      .limit(1);

    if (!membership) {
      res.status(404).json({ error: "العضو غير موجود في هذه المنشأة" });
      return;
    }

    const [targetUser] = await db.select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable).where(eq(usersTable.id, membership.userId)).limit(1);

    const existingRoles = await db.select({ roleId: membershipRolesTable.roleId, slug: rolesTable.slug })
      .from(membershipRolesTable)
      .innerJoin(rolesTable, eq(membershipRolesTable.roleId, rolesTable.id))
      .where(eq(membershipRolesTable.membershipId, membershipId));

    const oldRoleSlugs = existingRoles.map((r) => r.slug);

    const [newRole] = await db.select()
      .from(rolesTable)
      .where(and(eq(rolesTable.slug, parsed.data.roleSlug), eq(rolesTable.isSystem, true)))
      .limit(1);

    if (!newRole) {
      res.status(400).json({ error: "الدور غير موجود في النظام" });
      return;
    }

    await db.delete(membershipRolesTable)
      .where(eq(membershipRolesTable.membershipId, membershipId));

    await db.insert(membershipRolesTable).values({
      membershipId,
      roleId: newRole.id,
      assignedBy: authReq.sessionUser.userId,
    });

    await createAuditLog({
      ...auditFromRequest(req, authReq.sessionUser),
      action: "assign_role",
      severity: "warning",
      entityType: "user",
      entityId: membership.userId,
      entityLabel: targetUser?.name ?? membershipId,
      oldData: { roles: oldRoleSlugs },
      newData: { roles: [parsed.data.roleSlug], membershipId },
    });

    res.json({ message: "تم تغيير الدور بنجاح", role: parsed.data.roleSlug });
  } catch (err) {
    logger.error({ err }, "Failed to change user role");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

export default router;
