import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { NotificationCenter } from "@/components/NotificationCenter";
import { MobileBottomNav } from "@/components/MobileBottomNav";

type NavItem = {
  path: string;
  key: string;
  permission?: string;
  icon: LucideIcon;
  tourId?: string;
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
      { path: "/inbox", key: "inbox", permission: "conversations:read", icon: Inbox, tourId: "nav-inbox" },
      { path: "/integrations", key: "integrations", permission: "channels:read", icon: Plug, tourId: "nav-integrations" },
    ],
  },
  {
    slug: "intelligence",
    key: "groupIntelligence",
    items: [
      { path: "/agents", key: "agents", permission: "ai:read", icon: Bot, tourId: "nav-agents" },
      { path: "/knowledge", key: "knowledge", permission: "knowledge:read", icon: BookOpen },
      { path: "/templates", key: "templates", permission: "templates:read", icon: FileText },
      { path: "/broadcasts", key: "broadcasts", permission: "broadcasts:read", icon: Megaphone },
      { path: "/automations", key: "automations", permission: "automations:read", icon: Workflow },
    ],
  },
  {
    slug: "store",
    key: "groupStore",
    items: [
      { path: "/inventory", key: "inventory", permission: "products:read", icon: ShoppingBag },
      { path: "/orders", key: "orders", permission: "orders:read", icon: Package },
      { path: "/payments", key: "payments", permission: "payments:read", icon: CreditCard },
    ],
  },
  {
    slug: "customers",
    key: "groupCustomers",
    items: [
      { path: "/contacts", key: "contacts", permission: "contacts:read", icon: Users, tourId: "nav-contacts" },
      { path: "/opportunities", key: "opportunities", permission: "opportunities:read", icon: Target },
      { path: "/debts", key: "debts", permission: "debts:read", icon: ReceiptText },
      { path: "/tasks", key: "tasks", permission: "tasks:read", icon: CheckSquare },
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
      { path: "/settings?tab=billing", key: "billing", permission: "settings:read", icon: CreditCard },
      { path: "/settings", key: "settings", permission: "settings:read", icon: Settings },
    ],
  },
];

const mobileTitles: Array<{ match: (location: string) => boolean; title: string; description?: string }> = [
  { match: (location) => location === "/dashboard", title: "الرئيسية", description: "ملخص سريع ليوم العمل" },
  { match: (location) => location.startsWith("/inbox"), title: "الوارد", description: "محادثات العملاء" },
  { match: (location) => location.startsWith("/contacts"), title: "العملاء", description: "جهات الاتصال" },
  { match: (location) => location.startsWith("/automation-hub"), title: "الأتمتة والذكاء", description: "الوكلاء والمعرفة والقوالب" },
  { match: (location) => location.startsWith("/more"), title: "المزيد", description: "كل الأدوات حسب صلاحياتك" },
  { match: (location) => location.startsWith("/integrations"), title: "القنوات", description: "واتساب وإنستغرام وماسنجر" },
  { match: (location) => location.startsWith("/settings"), title: "الإعدادات", description: "النشاط والفريق والأمان" },
  { match: (location) => location.startsWith("/orders"), title: "الطلبات" },
  { match: (location) => location.startsWith("/payments"), title: "المدفوعات" },
  { match: (location) => location.startsWith("/inventory"), title: "المخزون" },
  { match: (location) => location.startsWith("/agents"), title: "الوكلاء" },
  { match: (location) => location.startsWith("/knowledge"), title: "قاعدة المعرفة" },
  { match: (location) => location.startsWith("/templates"), title: "القوالب" },
  { match: (location) => location.startsWith("/broadcasts"), title: "الحملات" },
  { match: (location) => location.startsWith("/analytics"), title: "التحليلات" },
  { match: (location) => location.startsWith("/reports"), title: "التقارير" },
  { match: (location) => location.startsWith("/audit-logs"), title: "سجل النشاط" },
  { match: (location) => location.startsWith("/tasks"), title: "المهام" },
];

async function fetchWorkspaceShellInfo() {
  const res = await fetch(`${import.meta.env.BASE_URL}api/workspace`, { credentials: "include" });
  if (!res.ok) return null;
  return res.json() as Promise<{ workspace?: { name?: string; settings?: Record<string, unknown> } }>;
}

function readCollapsedGroups() {
  if (typeof window === "undefined") return {};

  return navGroups.reduce<Record<string, boolean>>((acc, group) => {
    acc[group.slug] = window.localStorage.getItem(`sidebar.group.${group.slug}`) === "collapsed";
    return acc;
  }, {});
}

const TOUR_STEPS = [
  { target: "nav-inbox", title: "صندوق الوارد", text: "هنا يصلك كل شيء — رسائل العملاء من واتساب وإنستغرام وماسنجر في مكان واحد. لن تفوتك رسالة بعد اليوم." },
  { target: "nav-agents", title: "ضوابط الوكيل", text: "من صفحة الوكلاء تستطيع تفعيل الوكيل أو إيقافه، وتعديل تعليماته وأسلوب رده في أي وقت." },
  { target: "nav-agents", title: "التحويل للإنسان", text: "داخل أي محادثة ستجد زر «حوّل للإنسان» — اضغطه لتولي المحادثة يدوياً وإيقاف الوكيل مؤقتاً لتلك المحادثة." },
  { target: "nav-contacts", title: "العملاء", text: "سجل موحد لكل عميل تفاعل معك عبر أي قناة، مع تاريخ طلباته ومحادثاته وبياناته الكاملة." },
  { target: "nav-integrations", title: "إعدادات القناة", text: "من صفحة القنوات تستطيع ربط قنوات جديدة أو تعديل إعدادات القنوات الحالية في أي وقت." },
  { target: "nav-integrations", title: "قطع وإعادة الاتصال", text: "إذا واجهت مشكلة في قناة، استخدم «قطع الاتصال» ثم «إعادة الاتصال» لاستعادة الخدمة دون فقدان الإعدادات." },
] as const;

type TourRect = { top: number; left: number; right: number; bottom: number; width: number; height: number } | null;

function GuidedTour({ tourDone, onComplete }: { tourDone: boolean; onComplete: () => void }) {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<TourRect>(null);

  const currentStep = TOUR_STEPS[step];

  const measureTarget = useCallback(() => {
    if (!currentStep) return;
    const el = document.querySelector(`[data-tour="${currentStep.target}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
    } else {
      setRect(null);
    }
  }, [currentStep]);

  useEffect(() => {
    if (tourDone) return;
    const flag = sessionStorage.getItem("show-tour");
    if (flag === "1") {
      sessionStorage.removeItem("show-tour");
      setActive(true);
    }
  }, [tourDone]);

  useEffect(() => {
    if (!active) return;
    measureTarget();
    const onResize = () => measureTarget();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [active, measureTarget]);

  function advance() {
    if (step < TOUR_STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      finish();
    }
  }

  function finish() {
    setActive(false);
    onComplete();
  }

  if (!active || tourDone) return null;

  const PAD = 6;
  const isMobile = !rect || rect.width === 0;

  return (
    <div className="fixed inset-0 z-[9998]" dir="rtl" aria-modal="true" role="dialog">
      {isMobile ? (
        <div className="pointer-events-none absolute inset-0 bg-black/60" />
      ) : (
        <>
          <div className="pointer-events-none absolute bg-black/60" style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top - PAD) }} />
          <div className="pointer-events-none absolute bg-black/60" style={{ top: rect.top - PAD, left: 0, width: Math.max(0, rect.left - PAD), height: rect.height + PAD * 2 }} />
          <div className="pointer-events-none absolute bg-black/60" style={{ top: rect.top - PAD, left: rect.right + PAD, right: 0, height: rect.height + PAD * 2 }} />
          <div className="pointer-events-none absolute bg-black/60" style={{ top: rect.bottom + PAD, left: 0, right: 0, bottom: 0 }} />
          <div className="pointer-events-none absolute rounded-xl ring-2 ring-primary ring-offset-2" style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} />
        </>
      )}

      {/* Tooltip */}
      {isMobile ? (
        <div className="absolute bottom-24 inset-x-4 rounded-2xl border border-border bg-card shadow-2xl p-5 space-y-4">
          <div>
            <p className="text-xs font-bold text-primary">{step + 1} / {TOUR_STEPS.length}</p>
            <h3 className="mt-1 text-base font-extrabold text-foreground">{currentStep.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{currentStep.text}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={advance} className="flex-1 rounded-lg bg-primary py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90">
              {step < TOUR_STEPS.length - 1 ? "التالي" : "فهمت"}
            </button>
            <button onClick={finish} className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50">تخطي الجولة</button>
          </div>
        </div>
      ) : (
        <div
          className="absolute w-72 rounded-2xl border border-border bg-card shadow-2xl p-5 space-y-4"
          style={{
            top: Math.max(8, rect.top + rect.height / 2 - 80),
            right: window.innerWidth - rect.left + 16,
          }}
        >
          <div>
            <p className="text-xs font-bold text-primary">{step + 1} / {TOUR_STEPS.length}</p>
            <h3 className="mt-1 text-base font-extrabold text-foreground">{currentStep.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{currentStep.text}</p>
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={advance} className="w-full rounded-lg bg-primary py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90">
              {step < TOUR_STEPS.length - 1 ? "التالي" : "فهمت"}
            </button>
            <button onClick={finish} className="w-full rounded-lg border border-border py-2 text-sm text-muted-foreground hover:bg-muted/50">تخطي الجولة</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, clearAuth, hasPermission } = useAuth();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(readCollapsedGroups);
  const qc = useQueryClient();
  const { t, i18n } = useTranslation("common");
  const direction = i18n.language?.startsWith("en") ? "ltr" : "rtl";
  const languageLabel = i18n.language?.startsWith("en") ? "AR" : "EN";
  const mobileHeader = mobileTitles.find((item) => item.match(location)) ?? {
    match: () => true,
    title: t("brand.name"),
    description: undefined,
  };
  const workspaceQuery = useQuery({
    queryKey: ["workspace-shell-info"],
    queryFn: fetchWorkspaceShellInfo,
    staleTime: 5 * 60_000,
  });
  const workspace = workspaceQuery.data?.workspace;
  const tourDone = workspace?.settings?.tour_completed === true;

  const completeTour = useCallback(async () => {
    try {
      await fetch(`${import.meta.env.BASE_URL}api/workspace`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { tour_completed: true } }),
      });
      qc.invalidateQueries({ queryKey: ["workspace-shell-info"] });
    } catch { /* non-critical */ }
  }, [qc]);
  const workspaceName =
    workspace?.name ||
    (typeof workspace?.settings?.companyName === "string" ? workspace.settings.companyName : "") ||
    (typeof workspace?.settings?.business_name === "string" ? workspace.settings.business_name : "") ||
    t("brand.name");

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

  const resendVerificationMut = useMutation({
    mutationFn: async () => {
      await fetch(`${import.meta.env.BASE_URL}api/auth/resend-verification`, {
        method: "POST",
        credentials: "include",
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth"] }),
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
      <aside
        className={cn(
          "hidden w-72 flex-col border-s border-sidebar-border bg-sidebar lg:relative lg:flex lg:translate-x-0",
        )}
      >
        <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-lg font-bold text-white">
            و
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
              <div key={group.slug} className="mb-4 rounded-xl border border-sidebar-border/50 bg-sidebar-accent/10 p-2">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.slug)}
                  className="mb-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-sidebar-foreground/55 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/80"
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
                          data-tour={item.tourId}
                          className={cn(
                            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition-colors",
                            active
                              ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                              : "text-sidebar-foreground/72 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
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
        <header className="flex min-h-[4.25rem] items-center justify-between border-b border-border bg-card px-4 py-2 lg:hidden">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-black text-primary">
                {workspaceName.trim().slice(0, 1) || "و"}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-primary">{workspaceName}</p>
                <h1 className="truncate text-base font-extrabold leading-tight text-foreground">{mobileHeader.title}</h1>
              </div>
            </div>
            {mobileHeader.description && (
              <p className="mt-0.5 truncate pe-3 text-xs text-muted-foreground">{mobileHeader.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <NotificationCenter />
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-sm font-black text-primary">
              {user?.name?.trim().slice(0, 1) ?? "م"}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto pb-[calc(5.75rem+env(safe-area-inset-bottom))] lg:pb-0">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
            <div className="mb-4 hidden items-center justify-end lg:flex">
              <NotificationCenter />
            </div>
            {user && user.emailVerified === false ? (
              <div className="flex min-h-[70vh] items-center justify-center" dir="rtl">
                <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-3xl">
                    ✉️
                  </div>
                  <h2 className="mb-2 text-xl font-bold text-amber-900">تأكيد البريد الإلكتروني مطلوب</h2>
                  <p className="mb-1 text-sm text-amber-800">
                    أرسلنا رابط تأكيد إلى
                  </p>
                  <p className="mb-4 font-semibold text-amber-900">{user.email}</p>
                  <p className="mb-6 text-sm text-amber-700">
                    يجب تأكيد بريدك الإلكتروني من <strong>support@wesal.one</strong> قبل استخدام النظام.
                  </p>
                  <button
                    type="button"
                    onClick={() => resendVerificationMut.mutate()}
                    className="w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60"
                    disabled={resendVerificationMut.isPending || resendVerificationMut.isSuccess}
                  >
                    {resendVerificationMut.isPending
                      ? "جار الإرسال..."
                      : resendVerificationMut.isSuccess
                      ? "✅ تم إرسال الرابط — تحقق من بريدك"
                      : "إعادة إرسال رابط التأكيد"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { fetch(`${import.meta.env.BASE_URL}api/auth/logout`, { method: "POST", credentials: "include" }).then(() => window.location.href = "/login"); }}
                    className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm text-amber-800 hover:bg-amber-50"
                  >
                    تسجيل الخروج
                  </button>
                </div>
              </div>
            ) : (
              children
            )}
          </div>
        </main>
        <MobileBottomNav location={location} hasPermission={hasPermission} />
      </div>
      <GuidedTour tourDone={tourDone} onComplete={completeTour} />
    </div>
  );
}
