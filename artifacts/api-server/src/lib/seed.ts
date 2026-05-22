import { db, rolesTable, permissionsTable, rolePermissionsTable, plansTable } from "@workspace/db";
import { eq, and, inArray, notInArray } from "drizzle-orm";
import { logger } from "./logger";

const SYSTEM_PERMISSIONS = [
  { resource: "contacts", action: "create", slug: "contacts:create", description: "إضافة عملاء" },
  { resource: "contacts", action: "read", slug: "contacts:read", description: "عرض العملاء" },
  { resource: "contacts", action: "update", slug: "contacts:update", description: "تعديل العملاء" },
  { resource: "contacts", action: "delete", slug: "contacts:delete", description: "حذف العملاء" },
  { resource: "contacts", action: "export", slug: "contacts:export", description: "تصدير العملاء" },
  { resource: "contacts", action: "manage_channels", slug: "contacts:manage_channels", description: "إدارة قنوات التواصل" },
  { resource: "contacts", action: "manage_notes", slug: "contacts:manage_notes", description: "إدارة ملاحظات العملاء" },
  { resource: "conversations", action: "read", slug: "conversations:read", description: "عرض المحادثات" },
  { resource: "conversations", action: "create", slug: "conversations:create", description: "إنشاء المحادثات" },
  { resource: "conversations", action: "update", slug: "conversations:update", description: "تعديل المحادثات" },
  { resource: "conversations", action: "reply", slug: "conversations:reply", description: "الرد على المحادثات" },
  { resource: "conversations", action: "assign", slug: "conversations:assign", description: "تعيين المحادثات" },
  { resource: "conversations", action: "resolve", slug: "conversations:resolve", description: "إغلاق المحادثات" },
  { resource: "conversations", action: "bulk_action", slug: "conversations:bulk_action", description: "إجراءات جماعية على المحادثات" },
  { resource: "conversations", action: "close", slug: "conversations:close", description: "إغلاق المحادثات" },
  { resource: "quick_replies", action: "read", slug: "quick_replies:read", description: "عرض الردود السريعة" },
  { resource: "quick_replies", action: "write", slug: "quick_replies:write", description: "إدارة الردود السريعة" },
  { resource: "saved_views", action: "read", slug: "saved_views:read", description: "عرض العروض المحفوظة" },
  { resource: "saved_views", action: "write", slug: "saved_views:write", description: "إدارة العروض المحفوظة" },
  { resource: "sla", action: "manage", slug: "sla:manage", description: "إدارة قواعد الاستجابة" },
  { resource: "business_hours", action: "manage", slug: "business_hours:manage", description: "إدارة ساعات العمل" },
  { resource: "tickets", action: "create", slug: "tickets:create", description: "إنشاء تذاكر" },
  { resource: "tickets", action: "read", slug: "tickets:read", description: "عرض التذاكر" },
  { resource: "tickets", action: "update", slug: "tickets:update", description: "تعديل التذاكر" },
  { resource: "tickets", action: "delete", slug: "tickets:delete", description: "حذف التذاكر" },
  { resource: "tickets", action: "assign", slug: "tickets:assign", description: "تعيين التذاكر" },
  { resource: "tasks", action: "create", slug: "tasks:create", description: "إنشاء مهام" },
  { resource: "tasks", action: "read", slug: "tasks:read", description: "عرض المهام" },
  { resource: "tasks", action: "update", slug: "tasks:update", description: "تعديل المهام" },
  { resource: "tasks", action: "delete", slug: "tasks:delete", description: "حذف المهام" },
  { resource: "followups", action: "create", slug: "followups:create", description: "إنشاء متابعات" },
  { resource: "followups", action: "read", slug: "followups:read", description: "عرض المتابعات" },
  { resource: "followups", action: "update", slug: "followups:update", description: "تعديل المتابعات" },
  { resource: "followups", action: "delete", slug: "followups:delete", description: "حذف المتابعات" },
  { resource: "opportunities", action: "create", slug: "opportunities:create", description: "إنشاء فرص" },
  { resource: "opportunities", action: "read", slug: "opportunities:read", description: "عرض الفرص" },
  { resource: "opportunities", action: "update", slug: "opportunities:update", description: "تعديل الفرص" },
  { resource: "opportunities", action: "delete", slug: "opportunities:delete", description: "حذف الفرص" },
  { resource: "orders", action: "create", slug: "orders:create", description: "إنشاء طلبات" },
  { resource: "orders", action: "read", slug: "orders:read", description: "عرض الطلبات" },
  { resource: "orders", action: "update", slug: "orders:update", description: "تعديل الطلبات" },
  { resource: "orders", action: "delete", slug: "orders:delete", description: "حذف الطلبات" },
  { resource: "orders", action: "cancel", slug: "orders:cancel", description: "إلغاء الطلبات" },
  { resource: "payments", action: "create", slug: "payments:create", description: "تسجيل مدفوعات" },
  { resource: "payments", action: "read", slug: "payments:read", description: "عرض المدفوعات" },
  { resource: "payments", action: "confirm", slug: "payments:confirm", description: "تأكيد المدفوعات" },
  { resource: "payments", action: "reject", slug: "payments:reject", description: "رفض المدفوعات" },
  { resource: "payments", action: "export", slug: "payments:export", description: "تصدير المدفوعات" },
  { resource: "debts", action: "read", slug: "debts:read", description: "عرض الديون" },
  { resource: "debts", action: "create", slug: "debts:create", description: "إنشاء ديون" },
  { resource: "debts", action: "update", slug: "debts:update", description: "تحديث الديون" },
  { resource: "debts", action: "cancel", slug: "debts:cancel", description: "إلغاء الديون" },
  { resource: "debts", action: "write_off", slug: "debts:write_off", description: "شطب الديون" },
  { resource: "debts", action: "delete", slug: "debts:delete", description: "حذف الديون" },
  { resource: "collection_notes", action: "read", slug: "collection_notes:read", description: "عرض ملاحظات التحصيل" },
  { resource: "collection_notes", action: "create", slug: "collection_notes:create", description: "إضافة ملاحظات تحصيل" },
  { resource: "collection_notes", action: "update", slug: "collection_notes:update", description: "تعديل ملاحظات التحصيل" },
  { resource: "collection_notes", action: "delete", slug: "collection_notes:delete", description: "حذف ملاحظات التحصيل" },
  { resource: "ai", action: "read", slug: "ai:read", description: "عرض بيانات الذكاء الاصطناعي" },
  { resource: "ai", action: "use", slug: "ai:use", description: "استخدام الذكاء الاصطناعي" },
  { resource: "ai", action: "configure", slug: "ai:configure", description: "إعداد وكلاء الذكاء الاصطناعي" },
  { resource: "ai", action: "manage", slug: "ai:manage", description: "إدارة ذاكرة الوكلاء وإعداداتها" },
  { resource: "ai", action: "approve", slug: "ai:approve", description: "اعتماد اقتراحات الذكاء الاصطناعي" },
  { resource: "ai", action: "view_usage", slug: "ai:view_usage", description: "عرض استخدام الذكاء الاصطناعي" },
  { resource: "ai", action: "view_safety", slug: "ai:view_safety", description: "عرض أحداث الأمان" },
  { resource: "approvals", action: "read", slug: "approvals:read", description: "عرض طلبات الاعتماد" },
  { resource: "approvals", action: "approve", slug: "approvals:approve", description: "اعتماد الطلبات" },
  { resource: "approvals", action: "reject", slug: "approvals:reject", description: "رفض الطلبات" },
  { resource: "knowledge", action: "read", slug: "knowledge:read", description: "عرض قاعدة المعرفة" },
  { resource: "knowledge", action: "write", slug: "knowledge:write", description: "تعديل قاعدة المعرفة" },
  { resource: "knowledge", action: "publish", slug: "knowledge:publish", description: "نشر مقالات المعرفة" },
  { resource: "knowledge", action: "create", slug: "knowledge:create", description: "إنشاء محتوى المعرفة" },
  { resource: "knowledge", action: "update", slug: "knowledge:update", description: "تحديث محتوى المعرفة" },
  { resource: "knowledge", action: "delete", slug: "knowledge:delete", description: "أرشفة محتوى المعرفة" },
  { resource: "knowledge", action: "manage", slug: "knowledge:manage", description: "إدارة فهرس التضمينات" },
  { resource: "automation", action: "read", slug: "automation:read", description: "عرض الأتمتة" },
  { resource: "automation", action: "write", slug: "automation:write", description: "تعديل الأتمتة" },
  { resource: "automation", action: "activate", slug: "automation:activate", description: "تفعيل الأتمتة" },
  { resource: "templates", action: "read", slug: "templates:read", description: "عرض القوالب" },
  { resource: "templates", action: "write", slug: "templates:write", description: "إنشاء وتعديل القوالب" },
  { resource: "templates", action: "submit", slug: "templates:submit", description: "إرسال القوالب للمراجعة" },
  { resource: "templates", action: "delete", slug: "templates:delete", description: "حذف القوالب" },
  { resource: "broadcasts", action: "read", slug: "broadcasts:read", description: "عرض الحملات" },
  { resource: "broadcasts", action: "write", slug: "broadcasts:write", description: "إنشاء وتعديل الحملات" },
  { resource: "broadcasts", action: "send", slug: "broadcasts:send", description: "إرسال الحملات" },
  { resource: "broadcasts", action: "cancel", slug: "broadcasts:cancel", description: "إلغاء الحملات" },
  { resource: "automations", action: "read", slug: "automations:read", description: "عرض الأتمتة" },
  { resource: "automations", action: "write", slug: "automations:write", description: "إنشاء وتعديل الأتمتة" },
  { resource: "automations", action: "activate", slug: "automations:activate", description: "تفعيل الأتمتة" },
  { resource: "automations", action: "delete", slug: "automations:delete", description: "حذف الأتمتة" },
  { resource: "analytics", action: "read", slug: "analytics:read", description: "عرض التحليلات" },
  { resource: "reports", action: "read", slug: "reports:read", description: "عرض التقارير" },
  { resource: "reports", action: "create", slug: "reports:create", description: "إنشاء تعريف تقرير" },
  { resource: "reports", action: "update", slug: "reports:update", description: "تعديل تعريف تقرير" },
  { resource: "reports", action: "delete", slug: "reports:delete", description: "أرشفة تقرير" },
  { resource: "reports", action: "generate", slug: "reports:generate", description: "توليد تقرير" },
  { resource: "reports", action: "export", slug: "reports:export", description: "تصدير التقارير" },
  { resource: "channels", action: "read", slug: "channels:read", description: "عرض القنوات" },
  { resource: "channels", action: "manage", slug: "channels:manage", description: "إدارة القنوات" },
  { resource: "integrations", action: "read", slug: "integrations:read", description: "عرض التكاملات" },
  { resource: "integrations", action: "manage", slug: "integrations:manage", description: "إدارة التكاملات" },
  { resource: "integrations", action: "create", slug: "integrations:create", description: "إنشاء حسابات التكامل" },
  { resource: "integrations", action: "update", slug: "integrations:update", description: "تعديل حسابات التكامل" },
  { resource: "integrations", action: "disable", slug: "integrations:disable", description: "تعطيل حسابات التكامل" },
  { resource: "integrations", action: "replay", slug: "integrations:replay", description: "إعادة معالجة أحداث التكامل" },
  { resource: "integrations", action: "view_events", slug: "integrations:view_events", description: "عرض أحداث التكامل" },
  { resource: "integrations", action: "manage_outbox", slug: "integrations:manage_outbox", description: "إدارة رسائل التكامل المعلقة" },
  { resource: "catalog", action: "read", slug: "catalog:read", description: "\u0639\u0631\u0636 \u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a \u0627\u0644\u0645\u062a\u0632\u0627\u0645\u0646\u0629" },
  { resource: "catalog", action: "sync", slug: "catalog:sync", description: "\u0645\u0632\u0627\u0645\u0646\u0629 \u0643\u062a\u0627\u0644\u0648\u062c \u0645\u064a\u062a\u0627" },
  { resource: "catalog", action: "manage", slug: "catalog:manage", description: "\u0625\u062f\u0627\u0631\u0629 \u0645\u0635\u0627\u062f\u0631 \u0627\u0644\u0643\u062a\u0627\u0644\u0648\u062c" },
  { resource: "billing", action: "read", slug: "billing:read", description: "عرض الفواتير" },
  { resource: "billing", action: "manage", slug: "billing:manage", description: "إدارة الفواتير" },
  { resource: "team", action: "read", slug: "team:read", description: "عرض الفريق" },
  { resource: "team", action: "manage", slug: "team:manage", description: "إدارة الفريق" },
  { resource: "audit_logs", action: "read", slug: "audit_logs:read", description: "عرض سجلات التدقيق" },
  { resource: "settings", action: "read", slug: "settings:read", description: "عرض الإعدادات" },
  { resource: "settings", action: "manage", slug: "settings:manage", description: "إدارة الإعدادات" },
  { resource: "users", action: "invite", slug: "users:invite", description: "دعوة موظفين" },
  { resource: "users", action: "suspend", slug: "users:suspend", description: "إيقاف موظفين" },
  { resource: "users", action: "manage_roles", slug: "users:manage_roles", description: "إدارة الأدوار" },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: SYSTEM_PERMISSIONS.map((p) => p.slug),
  manager: SYSTEM_PERMISSIONS.map((p) => p.slug).filter(
    (s) => !["billing:manage", "users:manage_roles", "integrations:manage"].includes(s)
  ),
  agent: [
    "contacts:create", "contacts:read", "contacts:update",
    "contacts:manage_channels", "contacts:manage_notes",
    "conversations:read", "conversations:create", "conversations:update",
    "conversations:reply", "conversations:assign", "conversations:resolve", "conversations:close",
    "quick_replies:read", "quick_replies:write",
    "saved_views:read", "saved_views:write",
    "tickets:create", "tickets:read", "tickets:update", "tickets:assign",
    "tasks:create", "tasks:read", "tasks:update",
    "followups:create", "followups:read", "followups:update", "followups:delete",
    "opportunities:create", "opportunities:read", "opportunities:update", "opportunities:delete",
    "orders:create", "orders:read", "orders:update",
    "payments:create", "payments:read",
    "debts:read", "debts:create",
    "collection_notes:read", "collection_notes:create",
    "knowledge:read",
    "ai:read",
    "ai:use",
    "approvals:read",
    "analytics:read",
    "reports:read",
    "channels:read",
    "integrations:read",
    "catalog:read",
    "templates:read",
    "broadcasts:read",
    "automations:read",
    "settings:read",
    "team:read",
  ],
  accountant: [
    "contacts:read",
    "orders:read",
    "payments:create", "payments:read", "payments:confirm", "payments:reject", "payments:export",
    "debts:read", "debts:create", "debts:update", "debts:cancel", "debts:write_off",
    "collection_notes:read", "collection_notes:create", "collection_notes:update", "collection_notes:delete",
    "analytics:read",
    "reports:read", "reports:create", "reports:generate", "reports:export",
    "audit_logs:read",
    "integrations:read",
    "settings:read",
  ],
  viewer: [
    "contacts:read",
    "tickets:read",
    "tasks:read",
    "followups:read",
    "opportunities:read",
    "orders:read",
    "payments:read",
    "conversations:read",
    "quick_replies:read",
    "saved_views:read",
    "debts:read",
    "collection_notes:read",
    "knowledge:read",
    "ai:read",
    "analytics:read",
    "reports:read",
    "integrations:read",
    "catalog:read",
    "templates:read",
    "broadcasts:read",
    "automations:read",
    "settings:read",
    "team:read",
  ],
};

const SYSTEM_PLANS = [
  {
    name: "تجربة مجانية",
    slug: "trial",
    key: "trial",
    nameAr: "تجربة مجانية",
    priceYer: "0",
    priceYerAnnual: "0",
    billingCycle: "monthly",
    sortOrder: 10,
    limits: { channels: 3, agents: 3, monthly_messages: 1000, team_members: 5, contacts: 500 },
    features: ["inbox", "ai_agent", "catalog", "analytics", "campaigns"],
  },
  {
    name: "المبتدئ",
    slug: "starter",
    key: "starter",
    nameAr: "البداية",
    priceYer: "15000",
    priceYerAnnual: "144000",
    priceUsd: "20",
    billingCycle: "monthly",
    sortOrder: 20,
    limits: { channels: 2, agents: 1, monthly_messages: 2000, team_members: 3, contacts: 1000 },
    features: ["inbox", "ai_agent", "catalog"],
  },
  {
    name: "المحترف",
    slug: "growth",
    key: "growth",
    nameAr: "النمو",
    priceYer: "35000",
    priceYerAnnual: "336000",
    priceUsd: "50",
    billingCycle: "monthly",
    sortOrder: 30,
    limits: { channels: 5, agents: 3, monthly_messages: 10000, team_members: 10, contacts: 10000 },
    features: ["inbox", "ai_agent", "catalog", "analytics", "campaigns"],
  },
  {
    name: "الفريق",
    slug: "business",
    key: "business",
    nameAr: "الأعمال",
    priceYer: "75000",
    priceYerAnnual: "720000",
    priceUsd: "100",
    billingCycle: "monthly",
    sortOrder: 40,
    limits: { channels: 10, agents: 10, monthly_messages: 50000, team_members: 30, contacts: 50000 },
    features: ["inbox", "ai_agent", "catalog", "analytics", "campaigns", "priority_support"],
  },
];

export async function runSeed() {
  logger.info("Running system seed...");

  for (const perm of SYSTEM_PERMISSIONS) {
    const existing = await db
      .select({ id: permissionsTable.id })
      .from(permissionsTable)
      .where(eq(permissionsTable.slug, perm.slug))
      .limit(1);

    if (!existing.length) {
      await db.insert(permissionsTable).values(perm);
    }
  }
  logger.info(`Seeded ${SYSTEM_PERMISSIONS.length} permissions`);

  const allPermissions = await db.select().from(permissionsTable);
  const permMap = new Map(allPermissions.map((p) => [p.slug, p.id]));

  for (const [roleSlug, permSlugs] of Object.entries(ROLE_PERMISSIONS)) {
    const existing = await db
      .select({ id: rolesTable.id })
      .from(rolesTable)
      .where(and(eq(rolesTable.slug, roleSlug), eq(rolesTable.isSystem, true)))
      .limit(1);

    let roleId: string;
    if (!existing.length) {
      const [role] = await db
        .insert(rolesTable)
        .values({ name: ROLE_NAMES[roleSlug] ?? roleSlug, slug: roleSlug, isSystem: true })
        .returning({ id: rolesTable.id });
      roleId = role.id;
    } else {
      roleId = existing[0].id;
    }

    const desiredPermIds = permSlugs.map((s) => permMap.get(s)).filter(Boolean) as string[];

    if (desiredPermIds.length > 0) {
      await db.delete(rolePermissionsTable).where(
        and(
          eq(rolePermissionsTable.roleId, roleId),
          notInArray(rolePermissionsTable.permissionId, desiredPermIds)
        )
      );
      const existingRPs = await db.select({ permissionId: rolePermissionsTable.permissionId })
        .from(rolePermissionsTable)
        .where(eq(rolePermissionsTable.roleId, roleId));
      const existingPermIds = new Set(existingRPs.map((rp) => rp.permissionId));
      const toInsert = desiredPermIds.filter((pid) => !existingPermIds.has(pid));
      if (toInsert.length > 0) {
        await db.insert(rolePermissionsTable).values(toInsert.map((permissionId) => ({ roleId, permissionId })));
      }
    } else {
      await db.delete(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, roleId));
    }
  }
  logger.info("Seeded system roles and role_permissions");

  for (const plan of SYSTEM_PLANS) {
    const existing = await db
      .select({ id: plansTable.id })
      .from(plansTable)
      .where(eq(plansTable.slug, plan.slug))
      .limit(1);

    if (!existing.length) {
      await db.insert(plansTable).values(plan);
    } else {
      await db.update(plansTable).set(plan).where(eq(plansTable.id, existing[0].id));
    }
  }
  logger.info("Seeded system plans");

  logger.info("Seed complete.");
}

const ROLE_NAMES: Record<string, string> = {
  owner: "المالك",
  manager: "المدير",
  agent: "الموظف",
  accountant: "المحاسب",
  viewer: "المشاهد",
};
