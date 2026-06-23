import { Link } from "wouter";
import { Bot, BookOpen, FileText, Megaphone, Workflow, type LucideIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

type HubItem = {
  title: string;
  description: string;
  href: string;
  permission: string;
  icon: LucideIcon;
};

const items: HubItem[] = [
  {
    title: "الوكلاء",
    description: "إدارة الوكيل الذكي وتعليماته وقنواته",
    href: "/agents",
    permission: "ai:read",
    icon: Bot,
  },
  {
    title: "قاعدة المعرفة",
    description: "مصادر الإجابات والملفات والأسئلة الشائعة",
    href: "/knowledge",
    permission: "knowledge:read",
    icon: BookOpen,
  },
  {
    title: "القوالب",
    description: "قوالب الردود والرسائل المعتمدة",
    href: "/templates",
    permission: "templates:read",
    icon: FileText,
  },
  {
    title: "الأتمتة",
    description: "تدفقات العمل والمتابعات حسب المرحلة الحالية",
    href: "/automations",
    permission: "automations:read",
    icon: Workflow,
  },
  {
    title: "الحملات",
    description: "البث والقوائم التسويقية عند الحاجة",
    href: "/broadcasts",
    permission: "broadcasts:read",
    icon: Megaphone,
  },
];

export default function AutomationHubPage() {
  const { hasPermission } = useAuth();
  const visibleItems = items.filter((item) => hasPermission(item.permission));

  return (
    <div dir="rtl" className="space-y-4 lg:hidden">
      <section className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs font-bold text-primary">مركز واحد</p>
        <h2 className="mt-1 text-lg font-extrabold text-foreground">الأتمتة والذكاء</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          الوكلاء والمعرفة والقوالب والأتمتة منظمة في مكان واحد، وكل قسم يبقى على مساره ووظيفته الحالية.
        </p>
      </section>

      <section className="grid gap-3">
        {visibleItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            لا توجد أقسام متاحة حسب صلاحياتك الحالية.
          </div>
        ) : (
          visibleItems.map((item) => {
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
          })
        )}
      </section>
    </div>
  );
}
