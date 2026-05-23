import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}

const headerKeysByTitle: Record<string, string> = {
  "التحليلات": "analytics",
  "المساعد الذكي": "agents",
  "سجلات النشاط": "auditLogs",
  "المتابعات": "followups",
  "الديون والتحصيل": "debts",
  "جهات الاتصال": "contacts",
  "القنوات": "integrations",
  "صندوق الوارد": "inbox",
  "الفرص": "opportunities",
  "الطلبات": "orders",
  "المدفوعات": "payments",
  "التقارير": "reports",
  "الإعدادات": "settings",
  "المهام": "tasks",
  "التذاكر": "tickets",
  "ابدأ تشغيل نشاطك": "businessSetup",
};

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  const { t } = useTranslation("pages");
  const headerKey = headerKeysByTitle[title];
  const translatedTitle = headerKey ? t(`headers.${headerKey}.title`, { defaultValue: title }) : title;
  const translatedSubtitle =
    headerKey && subtitle ? t(`headers.${headerKey}.subtitle`, { defaultValue: subtitle }) : subtitle;

  return (
    <div className={cn("mb-7 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div>
        <h1 className="text-2xl font-extrabold text-foreground">{translatedTitle}</h1>
        {translatedSubtitle && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{translatedSubtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
