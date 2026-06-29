import { useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { cn } from "@/lib/utils";
import TasksPage from "./TasksPage";
import FollowupsPage from "./FollowupsPage";

type TabKey = "tasks" | "followups";

export default function TasksFollowupsPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const activeTab = useMemo<TabKey>(() => {
    const tab = new URLSearchParams(search).get("tab");
    return tab === "followups" ? "followups" : "tasks";
  }, [search]);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "tasks", label: "المهام" },
    { key: "followups", label: "المتابعات" },
  ];

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => navigate(tab.key === "followups" ? "/tasks?tab=followups" : "/tasks")}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
              activeTab === tab.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "followups" ? <FollowupsPage /> : <TasksPage />}
    </div>
  );
}
