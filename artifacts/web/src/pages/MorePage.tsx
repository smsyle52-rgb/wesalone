import { Link } from "wouter";
import {
  BarChart3,
  CreditCard,
  Megaphone,
  Package,
  Plug,
  Settings,
  ShieldCheck,
  ShoppingBag,
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

const moreItems: MoreItem[] = [
  { title: "الطلبات", description: "متابعة الطلبات وحالاتها", href: "/orders", permission: "orders:read", icon: Package },
  { title: "المخزون", description: "المنتجات والكميات والأسعار", href: "/inventory", permission: "products:read", icon: ShoppingBag },
  { title: "الحملات", description: "البث والرسائل الجماعية", href: "/broadcasts", permission: "broadcasts:read", icon: Megaphone },
  { title: "التقارير والتحليلات", description: "مؤشرات الأداء والتقارير", href: "/analytics", permission: "analytics:read", icon: BarChart3 },
  { title: "الفريق والصلاحيات", description: "الأعضاء والأدوار والدعوات", href: "/settings?tab=users", permission: "users:read", icon: Users },
  { title: "المهام", description: "المهام والمتابعات اليومية", href: "/tasks", permission: "tasks:read", icon: ShieldCheck },
  { title: "المدفوعات", description: "التأكيدات وطرق الدفع", href: "/payments", permission: "payments:read", icon: CreditCard },
  { title: "التكاملات والقنوات", description: "واتساب وإنستغرام وماسنجر", href: "/integrations", permission: "channels:read", icon: Plug },
  { title: "الإعدادات", description: "النشاط التجاري والأمان والفوترة", href: "/settings", permission: "settings:read", icon: Settings },
];

export default function MorePage() {
  const { hasPermission } = useAuth();
  const visibleItems = moreItems.filter((item) => hasPermission(item.permission));

  return (
    <div dir="rtl" className="space-y-4 lg:hidden">
      <section className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs font-bold text-primary">حسب صلاحياتك</p>
        <h2 className="mt-1 text-lg font-extrabold text-foreground">المزيد</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          الأقسام الأقل استخداما هنا حتى يبقى شريط الجوال السفلي مختصرا وواضحا.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-3">
        {visibleItems.map((item) => {
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
      </section>
    </div>
  );
}
