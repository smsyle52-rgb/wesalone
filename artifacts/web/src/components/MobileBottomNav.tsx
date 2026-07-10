import { Bot, Inbox, LayoutDashboard, MoreHorizontal, type LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

type MobileBottomNavItem = {
  path: string;
  label: string;
  permission?: string;
  icon: LucideIcon;
};

type MobileBottomNavProps = {
  location: string;
  hasPermission: (permission: string) => boolean;
};

// أربعة أقسام فقط بطلب المالك (تبسيط الشريط السفلي، 8 يوليو): العملاء انتقلت إلى
// "المزيد" (MorePage.tsx) بدل أن تشغل تبويباً أساسياً. "الوكلاء" تفتح نفس مركز
// automation-hub (وكلاء + معرفة + قوالب) — تسمية أوضح فقط، لا تغيير في الوجهة.
const routeItems: MobileBottomNavItem[] = [
  { path: "/dashboard", label: "الرئيسية", icon: LayoutDashboard },
  { path: "/inbox", label: "الوارد", permission: "conversations:read", icon: Inbox },
  { path: "/automation-hub", label: "الوكلاء", permission: "ai:read", icon: Bot },
  { path: "/more", label: "المزيد", icon: MoreHorizontal },
];

function isActiveRoute(location: string, path: string) {
  return location === path || location.startsWith(`${path}/`);
}

function itemClassName(active = false) {
  return cn(
    "app-touch-target flex min-h-[3.5rem] flex-col items-center justify-center gap-1 rounded-xl px-1 text-[0.68rem] font-bold leading-tight transition-colors sm:text-[0.72rem]",
    active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
  );
}

export function MobileBottomNav({ location, hasPermission }: MobileBottomNavProps) {
  const visibleItems = routeItems.filter((item) => !item.permission || hasPermission(item.permission));

  return (
    <nav
      dir="rtl"
      aria-label="التنقل السفلي"
      className="app-bottom-nav fixed inset-x-0 bottom-0 z-[15] border-t border-border bg-card/95 px-2 pb-[calc(0.5rem+var(--app-safe-bottom))] pt-2 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur supports-[backdrop-filter]:bg-card/90 lg:hidden"
    >
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))` }}>
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = isActiveRoute(location, item.path);

          return (
            <Link
              key={item.path}
              href={item.path}
              aria-current={active ? "page" : undefined}
              className={itemClassName(active)}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
