import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/dashboard", label: "لوحة التحكم", icon: "📊" },
  { path: "/inbox", label: "صندوق الوارد", icon: "💬" },
  { path: "/tickets", label: "التذاكر", icon: "🎫" },
  { path: "/tasks", label: "المهام", icon: "✅" },
  { path: "/followups", label: "المتابعات", icon: "🔔" },
  { path: "/contacts", label: "جهات الاتصال", icon: "👥" },
  { path: "/opportunities", label: "الفرص", icon: "💡" },
  { path: "/orders", label: "الطلبات", icon: "📦" },
  { path: "/payments", label: "المدفوعات", icon: "💰" },
  { path: "/debts", label: "الديون والتحصيل", icon: "📋" },
  { path: "/knowledge", label: "قاعدة المعرفة", icon: "📚" },
  { path: "/agents", label: "وكلاء الذكاء الاصطناعي", icon: "🤖" },
  { path: "/analytics", label: "التحليلات", icon: "📈" },
  { path: "/reports", label: "التقارير", icon: "📑" },
  { path: "/audit-logs", label: "سجلات النشاط", icon: "🗒️" },
  { path: "/settings", label: "الإعدادات", icon: "⚙️" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, clearAuth } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const qc = useQueryClient();

  const logoutMut = useMutation({
    mutationFn: async () => {
      await fetch(`${import.meta.env.BASE_URL}api/auth/logout`, { method: "POST", credentials: "include" });
    },
    onSuccess: () => { clearAuth(); qc.clear(); window.location.href = "/login"; },
  });

  return (
    <div className="flex h-screen overflow-hidden bg-background" dir="rtl">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 right-0 z-30 w-64 bg-sidebar flex flex-col transition-transform duration-300 lg:relative lg:translate-x-0",
        sidebarOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
      )}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center text-white font-bold text-lg">خ</div>
          <div>
            <div className="text-sidebar-foreground font-bold text-base leading-tight">خدماتك</div>
            <div className="text-sidebar-foreground/50 text-xs">لوحة التحكم</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-2">
          {navItems.map((item) => {
            const active = location === item.path || location.startsWith(item.path + "/");
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
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="border-t border-sidebar-border px-3 py-3">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg text-sidebar-foreground/80">
            <div className="w-8 h-8 rounded-full bg-sidebar-primary/30 flex items-center justify-center text-sidebar-primary font-bold text-sm">
              {user?.name?.[0] ?? "؟"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-sidebar-accent-foreground truncate">{user?.name}</div>
              <div className="text-xs text-sidebar-foreground/50 truncate">{user?.email}</div>
            </div>
            <button
              onClick={() => logoutMut.mutate()}
              className="text-sidebar-foreground/40 hover:text-red-400 transition-colors text-xs"
              title="تسجيل الخروج"
            >
              خروج
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar (mobile) */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-card border-b border-border">
          <h1 className="font-bold text-foreground">خدماتك</h1>
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-md text-muted-foreground hover:bg-muted"
          >
            ☰
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
