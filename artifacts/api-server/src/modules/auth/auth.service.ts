import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";
import {
  db,
  usersTable,
  workspacesTable,
  workspaceMembershipsTable,
  rolesTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  subscriptionsTable,
  plansTable,
  featureFlagsTable,
  loginEventsTable,
  paymentMethodsTable,
  exchangeRatesTable,
} from "@workspace/db";
import { logger } from "../../lib/logger";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40)
    + "-" + uuidv4().slice(0, 6);
}

export async function loadUserPermissions(membershipId: string): Promise<{ permissions: string[]; roleSlugs: string[] }> {
  const rows = await db
    .select({
      permissionSlug: permissionsTable.slug,
      roleSlug: rolesTable.slug,
    })
    .from(membershipRolesTable)
    .innerJoin(rolesTable, eq(membershipRolesTable.roleId, rolesTable.id))
    .innerJoin(rolePermissionsTable, eq(rolePermissionsTable.roleId, rolesTable.id))
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(eq(membershipRolesTable.membershipId, membershipId));

  const permissions = [...new Set(rows.map((r) => r.permissionSlug).filter(Boolean))] as string[];
  const roleSlugs = [...new Set(rows.map((r) => r.roleSlug).filter(Boolean))] as string[];
  return { permissions, roleSlugs };
}

export async function registerWorkspace(data: {
  ownerName: string;
  email: string;
  password: string;
  workspaceName: string;
}) {
  const { ownerName, email, password, workspaceName } = data;

  const [existingUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  if (existingUser) {
    throw new Error("هذا البريد الإلكتروني مسجل مسبقاً");
  }

  const passwordHash = await hashPassword(password);
  const slug = generateSlug(workspaceName);

  return await db.transaction(async (tx) => {
    const [workspace] = await tx
      .insert(workspacesTable)
      .values({ name: workspaceName, slug })
      .returning();

    const [user] = await tx
      .insert(usersTable)
      .values({ name: ownerName, email: email.toLowerCase(), passwordHash })
      .returning();

    const [membership] = await tx
      .insert(workspaceMembershipsTable)
      .values({
        workspaceId: workspace.id,
        userId: user.id,
        status: "active",
        joinedAt: new Date(),
      })
      .returning();

    const [ownerRole] = await tx
      .select()
      .from(rolesTable)
      .where(and(eq(rolesTable.slug, "owner"), eq(rolesTable.isSystem, true)))
      .limit(1);

    if (ownerRole) {
      await tx.insert(membershipRolesTable).values({
        membershipId: membership.id,
        roleId: ownerRole.id,
        assignedBy: user.id,
      });
    }

    const [trialPlan] = await tx
      .select()
      .from(plansTable)
      .where(eq(plansTable.slug, "trial"))
      .limit(1);

    if (trialPlan) {
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);

      await tx.insert(subscriptionsTable).values({
        workspaceId: workspace.id,
        planId: trialPlan.id,
        status: "trialing",
        startedAt: new Date(),
        trialEndsAt,
      });
    }

    const SECURITY_FLAGS = [
      { flagKey: "whatsapp_api_enabled", isEnabled: false },
      { flagKey: "ai_auto_send", isEnabled: false },
      { flagKey: "ai_confirm_payments", isEnabled: false },
      { flagKey: "voice_enabled", isEnabled: false },
      { flagKey: "payment_providers_enabled", isEnabled: false },
      { flagKey: "outbound_webhooks_enabled", isEnabled: false },
    ];

    await tx.insert(featureFlagsTable).values(
      SECURITY_FLAGS.map((f) => ({ workspaceId: workspace.id, ...f }))
    );

    const PAYMENT_METHODS = [
      { slug: "cash", labelAr: "نقداً", labelEn: "Cash", sortOrder: 1 },
      { slug: "transfer", labelAr: "حوالة بنكية", labelEn: "Bank Transfer", requiresReference: true, sortOrder: 2 },
      { slug: "kuraimi", labelAr: "كريمي", labelEn: "Kuraimi", requiresReference: true, sortOrder: 3 },
      { slug: "jawali", labelAr: "جوالي", labelEn: "Jawali", requiresReference: true, sortOrder: 4 },
      { slug: "bank", labelAr: "بنك", labelEn: "Bank", requiresReference: true, requiresReceipt: true, sortOrder: 5 },
    ];

    await tx.insert(paymentMethodsTable).values(
      PAYMENT_METHODS.map((m) => ({ workspaceId: workspace.id, ...m }))
    );

    const CURRENCIES = [
      { fromCurrency: "USD", toCurrency: "YER", rate: "0" },
      { fromCurrency: "SAR", toCurrency: "YER", rate: "0" },
    ];

    await tx.insert(exchangeRatesTable).values(
      CURRENCIES.map((c) => ({ workspaceId: workspace.id, setBy: user.id, ...c }))
    );

    logger.info({ workspaceId: workspace.id, userId: user.id }, "New workspace registered");

    return { user, workspace, membership };
  });
}

export async function loginUser(data: {
  email: string;
  password: string;
  ip?: string;
  userAgent?: string;
}) {
  const { email, password, ip, userAgent } = data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  const recordLogin = async (userId: string | null, success: boolean, reason?: string) => {
    await db.insert(loginEventsTable).values({
      userId,
      email: email.toLowerCase(),
      success,
      failureReason: reason,
      ipAddress: ip,
      userAgent,
    }).catch(() => {});
  };

  if (!user) {
    await recordLogin(null, false, "user_not_found");
    throw new Error("البريد الإلكتروني أو كلمة المرور غير صحيحة");
  }

  if (user.status !== "active") {
    await recordLogin(user.id, false, "account_suspended");
    throw new Error("هذا الحساب موقوف. تواصل مع مسؤول النظام");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordLogin(user.id, false, "wrong_password");
    throw new Error("البريد الإلكتروني أو كلمة المرور غير صحيحة");
  }

  const [membership] = await db
    .select()
    .from(workspaceMembershipsTable)
    .where(
      and(
        eq(workspaceMembershipsTable.userId, user.id),
        eq(workspaceMembershipsTable.status, "active"),
      )
    )
    .limit(1);

  if (!membership) {
    await recordLogin(user.id, false, "no_active_workspace");
    throw new Error("لا توجد منشأة مرتبطة بهذا الحساب");
  }

  const [workspace] = await db
    .select({ status: workspacesTable.status })
    .from(workspacesTable)
    .where(eq(workspacesTable.id, membership.workspaceId))
    .limit(1);

  if (workspace?.status === "deactivated") {
    await recordLogin(user.id, false, "workspace_deactivated");
    throw new Error("مساحة العمل معطلة حالياً. تواصل مع مالك الحساب لإعادة التفعيل.");
  }

  const { permissions, roleSlugs } = await loadUserPermissions(membership.id);

  await db
    .update(usersTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(usersTable.id, user.id));

  await recordLogin(user.id, true);

  return {
    userId: user.id,
    activeWorkspaceId: membership.workspaceId,
    activeMembershipId: membership.id,
    permissions,
    roleSlugs,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
  };
}
