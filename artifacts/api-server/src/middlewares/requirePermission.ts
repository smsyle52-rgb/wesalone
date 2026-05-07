import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../lib/types";

const PERMISSION_LABELS: Record<string, string> = {
  "contacts:read": "عرض العملاء",
  "contacts:create": "إضافة عملاء",
  "contacts:update": "تعديل العملاء",
  "contacts:delete": "حذف العملاء",
  "contacts:export": "تصدير العملاء",
  "contacts:manage_channels": "إدارة قنوات التواصل",
  "contacts:manage_notes": "إدارة ملاحظات العملاء",
  "tickets:read": "عرض التذاكر",
  "tickets:create": "إنشاء التذاكر",
  "tickets:update": "تعديل التذاكر",
  "tickets:delete": "حذف التذاكر",
  "tickets:assign": "تعيين التذاكر",
  "tasks:read": "عرض المهام",
  "tasks:create": "إنشاء المهام",
  "tasks:update": "تعديل المهام",
  "tasks:delete": "حذف المهام",
  "followups:read": "عرض المتابعات",
  "followups:create": "إنشاء المتابعات",
  "followups:update": "تعديل المتابعات",
  "followups:delete": "حذف المتابعات",
  "opportunities:read": "عرض الفرص",
  "opportunities:create": "إنشاء الفرص",
  "opportunities:update": "تعديل الفرص",
  "opportunities:delete": "حذف الفرص",
  "orders:read": "عرض الطلبات",
  "orders:create": "إنشاء الطلبات",
  "orders:update": "تعديل الطلبات",
  "orders:cancel": "إلغاء الطلبات",
  "orders:delete": "حذف الطلبات",
  "payments:read": "عرض المدفوعات",
  "payments:create": "تسجيل المدفوعات",
  "payments:confirm": "تأكيد المدفوعات",
  "payments:reject": "رفض المدفوعات",
  "payments:export": "تصدير المدفوعات",
  "conversations:read": "عرض المحادثات",
  "conversations:create": "إنشاء المحادثات",
  "conversations:update": "تعديل المحادثات",
  "conversations:reply": "الرد على المحادثات",
  "conversations:assign": "تعيين المحادثات",
  "conversations:resolve": "إغلاق المحادثات",
  "channels:read": "عرض القنوات",
  "channels:manage": "إدارة القنوات",
  "users:invite": "دعوة موظفين",
  "users:suspend": "إيقاف موظفين",
  "users:manage_roles": "إدارة الأدوار",
  "team:read": "عرض الفريق",
  "team:manage": "إدارة الفريق",
  "settings:read": "عرض الإعدادات",
  "settings:manage": "إدارة الإعدادات",
  "analytics:read": "عرض التحليلات",
  "reports:read": "عرض التقارير",
  "reports:create": "إنشاء تعريف تقرير",
  "reports:update": "تعديل تعريف تقرير",
  "reports:delete": "أرشفة تقرير",
  "reports:generate": "توليد تقرير",
  "reports:export": "تصدير التقارير",
  "audit_logs:read": "عرض سجلات التدقيق",
  "automation:activate": "تفعيل الأتمتة",
  "integrations:manage": "إدارة التكاملات",
  "integrations:read": "عرض التكاملات",
  "integrations:create": "إنشاء حسابات التكامل",
  "integrations:update": "تعديل حسابات التكامل",
  "integrations:disable": "تعطيل حسابات التكامل",
  "integrations:replay": "إعادة معالجة أحداث التكامل",
  "integrations:view_events": "عرض أحداث التكامل",
  "integrations:manage_outbox": "إدارة رسائل التكامل المعلقة",
  "billing:manage": "إدارة الفواتير",
  "billing:read": "عرض الفواتير",
  "debts:read": "عرض الديون",
  "debts:update": "تحديث الديون",
  "debts:write_off": "شطب الديون",
  "ai:read": "عرض بيانات الذكاء الاصطناعي",
  "ai:use": "استخدام الذكاء الاصطناعي",
  "ai:configure": "إعداد وكلاء الذكاء الاصطناعي",
  "ai:approve": "اعتماد اقتراحات الذكاء الاصطناعي",
  "ai:view_usage": "عرض استخدام الذكاء الاصطناعي",
  "ai:view_safety": "عرض أحداث الأمان",
  "approvals:read": "عرض طلبات الاعتماد",
  "approvals:approve": "اعتماد الطلبات",
  "approvals:reject": "رفض الطلبات",
  "knowledge:read": "عرض قاعدة المعرفة",
  "knowledge:create": "إنشاء محتوى المعرفة",
  "knowledge:update": "تحديث محتوى المعرفة",
  "knowledge:delete": "أرشفة محتوى المعرفة",
  "knowledge:manage": "إدارة فهرس التضمينات",
};

export function requirePermission(permissionSlug: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.sessionUser) {
      res.status(401).json({ error: "يجب تسجيل الدخول أولاً", code: "UNAUTHORIZED" });
      return;
    }

    if (!authReq.sessionUser.permissions.includes(permissionSlug)) {
      const label = PERMISSION_LABELS[permissionSlug] ?? permissionSlug;
      res.status(403).json({
        error: `ليس لديك صلاحية ${label}`,
        code: "FORBIDDEN",
        requiredPermission: permissionSlug,
      });
      return;
    }

    next();
  };
}
