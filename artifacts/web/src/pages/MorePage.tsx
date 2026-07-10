import { Link } from "wouter";
import {
  BarChart3,
  ClipboardList,
  Contact,
  CreditCard,
  Package,
  Plug,
  ReceiptText,
  ScrollText,
  Settings,
  ShoppingBag,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

type MoreItem = {
  title: string;
  description: string;
  href: string;
  permission: string;
  icon: LucideIcon;
};

type MoreGroup = {
  label: string;
  items: MoreItem[];
};

// مجموعات مطابقة لتصنيف القائمة الجانبية في الديسكتوب (navGroups في Layout.tsx) —
// نفس الترتيب المنطقي: قنوات → متجر → عملاء → تحليلات → إعداد. الرئيسية/الوارد/الوكلاء
// موجودة في الشريط السفلي فلا تتكرر هنا؛ «العملاء» انتقلت هنا (8 يوليو) لتبسيط الشريط
// السفلي إلى 4 أقسام فقط.
// أُزيل رابط «الحملات» (/broadcasts): الباك-إند غير مُركَّب فعلياً (يطابق استثناء
// الديسكتوب الصريح في Layout.tsx) — لا نعرض رابطاً سيفشل بـ404.
const moreGroups: MoreGroup[] = [
  {
    label: "القنوات",
    items: [
      { title: "التكاملات والقنوات", description: "واتساب وإنستغرام وماسنجر", href: "/integrations", permission: "channels:read", icon: Plug },
    ],
  },
  {
    label: "المتجر",
    items: [
      { title: "المخزون", description: "المنتجات والكميات والأسعار", href: "/inventory", permission: "products:read", icon: ShoppingBag },
      { title: "الطلبات", description: "متابعة الطلبات وحالاتها", href: "/orders", permission: "orders:read", icon: Package },
      { title: "المدفوعات", description: "التأكيدات وطرق الدفع", href: "/payments", permission: "payments:read", icon: CreditCard },
    ],
  },
  {
    label: "العملاء",
    items: [
      { title: "جهات الاتصال", description: "قائمة العملاء وبياناتهم", href: "/contacts", permission: "contacts:read", icon: Contact },
      { title: "الفرص", description: "فرص البيع الجارية والمتوقعة", href: "/opportunities", permission: "opportunities:read", icon: Target },
      { title: "الديون", description: "المستحقات المالية على العملاء", href: "/debts", permission: "debts:read", icon: ReceiptText },
      { title: "المهام", description: "المهام والمتابعات اليومية", href: "/tasks", permission: "tasks:read", icon: ClipboardList },
    ],
  },
  {
    label: "التحليلات",
    items: [
      { title: "التحليلات", description: "مؤشرات الأداء العامة", href: "/analytics", permission: "analytics:read", icon: BarChart3 },
      { title: "التقارير", description: "تقارير مفصّلة وقابلة للتصدير", href: "/reports", permission: "reports:read", icon: ClipboardList },
      { title: "سجل النشاط", description: "سجل تدقيق كل الإجراءات الحساسة", href: "/audit-logs", permission: "audit_logs:read", icon: ScrollText },
    ],
  },
  {
    label: "الإعداد",
    items: [
      { title: "الفوترة والاشتراك", description: "الباقة والنقاط والفواتير", href: "/billing", permission: "settings:read", icon: CreditCard },
      // إصلاح (3 يوليو): كانت تستخدم صلاحية "users:read" غير الممنوحة لأي دور —
      // حتى المالك لا يراها. صفحة الإعدادات نفسها تعرض تبويب الفريق بلا قيد إضافي
      // عن settings:read، فوُحِّدت الصلاحية هنا لتطابقها.
      { title: "الفريق والصلاحيات", description: "الأعضاء والأدوار والدعوات", href: "/settings?tab=users", permission: "settings:read", icon: Users },
      { title: "الإعدادات", description: "النشاط التجاري والأمان والفوترة", href: "/settings", permission: "settings:read", icon: Settings },
    ],
  },
];

export default function MorePage() {
  const { hasPermission } = useAuth();
  const visibleGroups = moreGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => hasPermission(item.permission)) }))
    .filter((group) => group.items.length > 0);

  return (
    <div dir="rtl" className="space-y-4 lg:hidden">
      <section className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs font-bold text-primary">حسب صلاحياتك</p>
        <h2 className="mt-1 text-lg font-extrabold text-foreground">المزيد</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          الأقسام الأقل استخداما هنا حتى يبقى شريط الجوال السفلي مختصرا وواضحا.
        </p>
      </section>

      {visibleGroups.map((group) => (
        <section key={group.label} className="space-y-2">
          <h3 className="px-1 text-xs font-bold text-muted-foreground">{group.label}</h3>
          <div className="grid grid-cols-1 gap-3">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <span className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/30 hover:bg-muted/30">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-extrabold text-foreground">{item.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.description}</span>
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
