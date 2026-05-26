import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type NotificationItem = {
  id: string;
  type: string;
  titleAr: string;
  bodyAr: string;
  link?: string | null;
  isRead: boolean;
  createdAt: string;
};

async function fetchNotifications() {
  const res = await fetch(`${import.meta.env.BASE_URL}api/workspace/notifications`, { credentials: "include" });
  if (!res.ok) throw new Error("تعذر تحميل التنبيهات");
  return res.json() as Promise<{ notifications: NotificationItem[]; unreadCount: number }>;
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["workspace-notifications"],
    queryFn: fetchNotifications,
    refetchInterval: 60_000,
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`${import.meta.env.BASE_URL}api/workspace/notifications/${id}/read`, {
        method: "POST",
        credentials: "include",
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace-notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await fetch(`${import.meta.env.BASE_URL}api/workspace/notifications/read-all`, {
        method: "POST",
        credentials: "include",
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace-notifications"] }),
  });

  const notifications = query.data?.notifications ?? [];
  const unreadCount = query.data?.unreadCount ?? 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm transition hover:border-primary/30 hover:text-primary"
        aria-label="التنبيهات"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -end-1 min-w-5 rounded-full bg-accent px-1.5 py-0.5 text-xs font-bold text-white shadow">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute end-0 top-12 z-40 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <div className="text-sm font-bold text-foreground">التنبيهات</div>
              <div className="text-xs text-muted-foreground">{unreadCount} غير مقروءة</div>
            </div>
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              تعليم الكل
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">لا توجد تنبيهات حتى الآن.</div>
            ) : notifications.map((item) => (
              <a
                key={item.id}
                href={item.link ?? "#"}
                onClick={() => {
                  if (!item.isRead) markRead.mutate(item.id);
                  setOpen(false);
                }}
                className={cn(
                  "block border-b border-border px-4 py-3 transition last:border-b-0 hover:bg-muted/50",
                  !item.isRead && "bg-primary/5",
                )}
              >
                <div className="flex items-start gap-3">
                  <span className={cn("mt-1 h-2 w-2 rounded-full", item.isRead ? "bg-muted" : "bg-accent")} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-foreground">{item.titleAr}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.bodyAr}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString("ar-u-nu-latn")}
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
