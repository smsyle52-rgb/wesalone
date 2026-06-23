import { Bot, Inbox, LayoutDashboard, MoreHorizontal, Users, type LucideIcon } from "lucide-react";
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

const routeItems: MobileBottomNavItem[] = [
  { path: "/dashboard", label: "الرئيسية", icon: LayoutDashboard },
  { path: "/inbox", label: "الوارد", permission: "conversations:read", icon: Inbox },
  { path: "/contacts", label: "العملاء", permission: "contacts:read", icon: Users },
  { path: "/automation-hub", label: "الأتمتة", permission: "ai:read", icon: Bot },
  { path: "/more", label: "المزيد", icon: MoreHorizontal },
];

function isActiveRoute(location: string, path: string) {
  return location === path || location.startsWith(`${path}/`);
}

function itemClassName(active = false) {
  return cn(
    "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[0.72rem] font-bold transition-colors",
    active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
  );
}

export function MobileBottomNav({ location, hasPermission }: MobileBottomNavProps) {
  const visibleItems = routeItems.filter((item) => !item.permission || hasPermission(item.permission));

  return (
    <nav
      dir="rtl"
      aria-label="التنقل السفلي"
      className="fixed inset-x-0 bottom-0 z-[15] border-t border-border bg-card/95 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur supports-[backdrop-filter]:bg-card/90 lg:hidden"
    >
      <div className="grid grid-cols-5 gap-1">
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
