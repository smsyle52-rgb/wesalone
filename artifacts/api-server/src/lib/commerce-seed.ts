import { and, eq, inArray } from "drizzle-orm";
import { db, permissionsTable, rolePermissionsTable, rolesTable } from "@workspace/db";

const COMMERCE_PERMISSIONS = [
  { resource: "inventory", action: "read", slug: "inventory:read", description: "عرض المخزون ومواقعه وحركاته" },
  { resource: "inventory", action: "manage", slug: "inventory:manage", description: "إدارة مواقع المخزون والحجوزات" },
  { resource: "inventory", action: "adjust", slug: "inventory:adjust", description: "تعديل أرصدة المخزون مع سبب" },
  { resource: "payments", action: "refund", slug: "payments:refund", description: "إنشاء واعتماد استرجاعات المدفوعات" },
] as const;

const ROLE_GRANTS: Record<string, string[]> = {
  owner: COMMERCE_PERMISSIONS.map((permission) => permission.slug),
  manager: COMMERCE_PERMISSIONS.map((permission) => permission.slug),
  agent: ["inventory:read"],
  accountant: ["inventory:read", "payments:refund"],
  viewer: ["inventory:read"],
};

export async function runCommerceSeed() {
  for (const permission of COMMERCE_PERMISSIONS) {
    const existing = await db.select({ id: permissionsTable.id })
      .from(permissionsTable)
      .where(eq(permissionsTable.slug, permission.slug))
      .limit(1);
    if (!existing.length) await db.insert(permissionsTable).values(permission);
  }

  const permissions = await db.select({ id: permissionsTable.id, slug: permissionsTable.slug })
    .from(permissionsTable)
    .where(inArray(permissionsTable.slug, COMMERCE_PERMISSIONS.map((permission) => permission.slug)));
  const permissionMap = new Map(permissions.map((permission) => [permission.slug, permission.id]));

  for (const [roleSlug, slugs] of Object.entries(ROLE_GRANTS)) {
    const roles = await db.select({ id: rolesTable.id })
      .from(rolesTable)
      .where(and(eq(rolesTable.slug, roleSlug), eq(rolesTable.isSystem, true)));
    const permissionIds = slugs.map((slug) => permissionMap.get(slug)).filter(Boolean) as string[];
    for (const role of roles) {
      const existing = await db.select({ permissionId: rolePermissionsTable.permissionId })
        .from(rolePermissionsTable)
        .where(eq(rolePermissionsTable.roleId, role.id));
      const existingIds = new Set(existing.map((record) => record.permissionId));
      const missing = permissionIds.filter((permissionId) => !existingIds.has(permissionId));
      if (missing.length) {
        await db.insert(rolePermissionsTable).values(missing.map((permissionId) => ({ roleId: role.id, permissionId })));
      }
    }
  }
}
