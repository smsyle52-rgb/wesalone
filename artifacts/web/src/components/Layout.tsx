import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  BookOpen,
  Bot,
  CheckSquare,
  ChevronDown,
  ClipboardList,
  CreditCard,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Package,
  Plug,
  ReceiptText,
  ScrollText,
  Settings,
  ShoppingBag,
  Target,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  path: string;
  key: string;
  permission?: string;
  icon: LucideIcon;
};

type NavGroup = {
  slug: string;
  key: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    slug: "overview",
    key: "groupOverview",
    items: [{ path: "/dashboard", key: "dashboard", icon: LayoutDashboard }],
  },
  {
    slug: "conversations",
    key: "groupConversations",
    items: [
      { path: "/inbox", key: "inbox", permission: "conversations:read", icon: Inbox },
    ],
  },
  {
    slug: "tasks",
    key: "groupTasks",
    items: [{ path: "/tasks", key: "tasks", permission: "tasks:read", icon: CheckSquare }],
  },
  {
    slug: "customers",
    key: "groupCustomers",
    items: [
      { path: "/contacts", key: "contacts", permission: "contacts:read", icon: Users },
      { path: "/opportunities", key: "opportunities", permission: "opportunities:read", icon: Target },
      { path: "/orders", key: "orders", permission: "orders:read", icon: Package },
      { path: "/payments", key: "payments", permission: "payments:read", icon: CreditCard },
      { path: "/debts", key: "debts", permission: "debts:read", icon: ReceiptText },
    ],
  },
  {
    slug: "store",
    key: "groupStore",
    items: [
      { path: "/catalog", key: "catalog", permission: "catalog:read", icon: ShoppingBag },
    ],
  },
  {
    slug: "intelligence",
    key: "groupIntelligence",
    items: [
      { path: "/agents", key: "agents", permission: "ai:read", icon: Bot },
      { path: "/knowledge", key: "knowledge", permission: "knowledge:read", icon: BookOpen },
      { path: "/templates", key: "templates", permission: "templates:read", icon: FileText },
      { path: "/broadcasts", key: "broadcasts", permission: "broadcasts:read", icon: Megaphone },
      { path: "/automations", key: "automations", permission: "automations:read", icon: Workflow },
    ],
  },
  {
    slug: "analytics",
    key: "groupAnalytics",
    items: [
      { path: "/analytics", key: "analytics", permission: "analytics:read", icon: BarChart3 },
      { path: "/reports", key: "reports", permission: "reports:read", icon: ClipboardList },
      { path: "/audit-logs", key: "auditLogs", permission: "audit_logs:read", icon: ScrollText },
    ],
  },
  {
    slug: "setup",
    key: "groupSetup",
    items: [
      { path: "/integrations", key: "integrations", permission: "channels:read", icon: Plug },
      { path: "/settings", key: "settings", permission: "settings:read", icon: Settings },
    ],
  },
];

function readCollapsedGroups() {
  if (typeof window === "undefined") return {};

  return navGroups.reduce<Record<string, boolean>>((acc, group) => {
    acc[group.slug] = window.localStorage.getItem(`sidebar.group.${group.slug}`) === "collapsed";
    return acc;
  }, {});
}

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, clearAuth, hasPermission } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(readCollapsedGroups);
  const qc = useQueryClient();
  const { t, i18n } = useTranslation("common");
  const direction = i18n.language?.startsWith("en") ? "ltr" : "rtl";
  const languageLabel = i18n.language?.startsWith("en") ? "AR" : "EN";

  const logoutMut = useMutation({
    mutationFn: async () => {
      await fetch(`${import.meta.env.BASE_URL}api/auth/logout`, { method: "POST", credentials: "include" });
    },
    onSuccess: () => {
      clearAuth();
      qc.clear();
      window.location.href = "/login";
    },
  });

  const toggleGroup = (slug: string) => {
    setCollapsedGroups((current) => {
      const nextValue = !current[slug];
      const next = { ...current, [slug]: nextValue };
      window.localStorage.setItem(`sidebar.group.${slug}`, nextValue ? "collapsed" : "expanded");
      return next;
    });
  };

  const toggleLanguage = () => {
    const nextLanguage = i18n.language?.startsWith("en") ? "ar" : "en";
    void i18n.changeLanguage(nextLanguage);
    window.localStorage.setItem("i18nextLng", nextLanguage);
  };

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || hasPermission(item.permission)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="flex h-screen overflow-hidden bg-background" dir={direction}>
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 end-0 z-30 flex w-72 flex-col bg-sidebar transition-transform duration-300 lg:relative lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
        )}
      >
        <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-lg font-bold text-white">
            خ
          </div>
          <div>
            <div className="text-base font-bold leading-tight text-sidebar-foreground">{t("brand.name")}</div>
            <div className="text-xs text-sidebar-foreground/50">{t("brand.dashboard")}</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {visibleGroups.map((group) => {
            const collapsed = collapsedGroups[group.slug] ?? false;

            return (
              <div key={group.slug} className="mb-3">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.slug)}
                  className="mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/70"
                >
                  <span>{t(`nav.${group.key}`)}</span>
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", collapsed && "rotate-90 rtl:-rotate-90")}
                  />
                </button>

                {!collapsed && (
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const active = location === item.path || location.startsWith(`${item.path}/`);
                      const Icon = item.icon;

                      return (
                        <Link
                          key={item.path}
                          href={item.path}
                          onClick={() => setSidebarOpen(false)}
                          className={cn(
                            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                            active
                              ? "bg-sidebar-accent text-sidebar-accent-foreground"
                              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span>{t(`nav.${item.key}`)}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border px-3 py-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2 text-sidebar-foreground/80">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-primary/30 text-sm font-bold text-sidebar-primary">
              {user?.name?.[0] ?? "ص"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-sidebar-accent-foreground">{user?.name}</div>
              <div className="truncate text-xs text-sidebar-foreground/50">{user?.email}</div>
            </div>
            <button
              onClick={toggleLanguage}
              className="rounded-md px-2 py-1 text-xs font-semibold text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              title={t("language.switch")}
            >
              {languageLabel}
            </button>
            <button
              onClick={() => logoutMut.mutate()}
              className="rounded-md p-2 text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent/60 hover:text-red-400"
              title={t("auth.logout")}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3 lg:hidden">
          <h1 className="font-bold text-foreground">{t("brand.name")}</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleLanguage}
              className="rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"
              title={t("language.switch")}
            >
              {languageLabel}
            </button>
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted"
              aria-label={t("nav.openMenu")}
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
