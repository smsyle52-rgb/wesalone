import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/dashboard", key: "dashboard", icon: "📊" },
  { path: "/start", key: "start", icon: "🚀" },
  { path: "/inbox", key: "inbox", icon: "💬" },
  { path: "/tickets", key: "tickets", icon: "🎫" },
  { path: "/tasks", key: "tasks", icon: "✅" },
  { path: "/followups", key: "followups", icon: "🔔" },
  { path: "/contacts", key: "contacts", icon: "👥" },
  { path: "/opportunities", key: "opportunities", icon: "💡" },
  { path: "/orders", key: "orders", icon: "📦" },
  { path: "/payments", key: "payments", icon: "💰" },
  { path: "/debts", key: "debts", icon: "📋" },
  { path: "/knowledge", key: "knowledge", icon: "📚" },
  { path: "/agents", key: "agents", icon: "🤖" },
  { path: "/integrations", key: "integrations", icon: "🔌" },
  { path: "/analytics", key: "analytics", icon: "📈" },
  { path: "/reports", key: "reports", icon: "📑" },
  { path: "/audit-logs", key: "auditLogs", icon: "🗒️" },
  { path: "/settings", key: "settings", icon: "⚙️" },
] as const;

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, clearAuth } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const qc = useQueryClient();
  const { t, i18n } = useTranslation("common");
  const direction = i18n.language?.startsWith("en") ? "ltr" : "rtl";

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

  return (
    <div className="flex h-screen overflow-hidden bg-background" dir={direction}>
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-30 w-64 bg-sidebar flex flex-col transition-transform duration-300 lg:relative lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
        )}
      >
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center text-white font-bold text-lg">
            خ
          </div>
          <div>
            <div className="text-sidebar-foreground font-bold text-base leading-tight">{t("brand.name")}</div>
            <div className="text-sidebar-foreground/50 text-xs">{t("brand.dashboard")}</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-2">
          {navItems.map((item) => {
            const active = location === item.path || location.startsWith(`${item.path}/`);
            return (
              <Link
                key={item.path}
                href={item.path}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )}
              >
                <span className="text-base">{item.icon}</span>
                <span>{t(`nav.${item.key}`)}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border px-3 py-3">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg text-sidebar-foreground/80">
            <div className="w-8 h-8 rounded-full bg-sidebar-primary/30 flex items-center justify-center text-sidebar-primary font-bold text-sm">
              {user?.name?.[0] ?? "ص"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-sidebar-accent-foreground truncate">{user?.name}</div>
              <div className="text-xs text-sidebar-foreground/50 truncate">{user?.email}</div>
            </div>
            <button
              onClick={() => logoutMut.mutate()}
              className="text-sidebar-foreground/40 hover:text-red-400 transition-colors text-xs"
              title={t("auth.logout")}
            >
              {t("auth.logout")}
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-card border-b border-border">
          <h1 className="font-bold text-foreground">{t("brand.name")}</h1>
          <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-md text-muted-foreground hover:bg-muted">
            ☰
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
