/**
 * AdminSignupsPage — متابعة التسجيلات الجديدة (مديري المنصة فقط)
 *
 * يعرض كل تسجيل جديد خلال آخر N يوم وأين توقّف فعلياً في onboarding
 * (تأكيد بريد / إنشاء وكيل / ربط قناة) — بديل عن فحص SQL يدوي لكل عميل.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";

const BASE = `${import.meta.env.BASE_URL}api`;

async function apiFetch<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include" });
  if (!res.ok) {
    const json = await res.json().catch(() => ({ error: "خطأ" }));
    throw new Error(json.error ?? "خطأ في الخادم");
  }
  return res.json();
}

type Signup = {
  workspaceId: string;
  workspaceName: string;
  email: string;
  emailVerified: boolean;
  registeredAt: string;
  onboardingCompleted: boolean;
  agentDone: boolean;
  channelDone: boolean;
  stuckAt: "email_verification" | "agent" | "channel" | null;
};

const STUCK_LABELS: Record<string, { label: string; className: string }> = {
  email_verification: { label: "لم يؤكّد بريده بعد", className: "bg-amber-50 text-amber-700 border-amber-200" },
  agent: { label: "لم ينشئ وكيلاً بعد", className: "bg-amber-50 text-amber-700 border-amber-200" },
  channel: { label: "لم يربط قناة بعد", className: "bg-orange-50 text-orange-700 border-orange-200" },
};

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-muted/60 text-muted-foreground"}`}>
      {ok ? "✓" : "—"} {label}
    </span>
  );
}

export default function AdminSignupsPage() {
  const [days, setDays] = useState(14);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-signups", days],
    queryFn: () => apiFetch<{ signups: Signup[]; days: number }>(`admin/signups?days=${days}`),
  });

  const signups = data?.signups ?? [];
  const stuckCount = signups.filter((s) => !s.onboardingCompleted).length;

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="متابعة التسجيلات الجديدة"
        subtitle="كل حساب سجّل حديثاً، وأين توقّف فعلياً — بدل فحص كل عميل يدوياً."
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
          آخر
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
          >
            <option value={7}>7 أيام</option>
            <option value={14}>14 يوماً</option>
            <option value={30}>30 يوماً</option>
            <option value={60}>60 يوماً</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-semibold hover:bg-muted/60 disabled:opacity-60"
        >
          {isFetching ? "جارٍ التحديث..." : "تحديث"}
        </button>
        {!isLoading && !isError && (
          <span className="text-sm text-muted-foreground">
            {signups.length} تسجيل — {stuckCount} لم يكمل الإعداد بعد
          </span>
        )}
      </div>

      {isLoading && <div className="py-10 text-center text-sm text-muted-foreground">جارٍ التحميل...</div>}

      {isError && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      {!isLoading && !isError && signups.length === 0 && (
        <div className="py-10 text-center text-sm text-muted-foreground">لا توجد تسجيلات جديدة في هذه الفترة.</div>
      )}

      {!isLoading && !isError && signups.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs font-semibold text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-right">مساحة العمل</th>
                <th className="px-4 py-3 text-right">البريد</th>
                <th className="px-4 py-3 text-right">التسجيل</th>
                <th className="px-4 py-3 text-right">الحالة</th>
                <th className="px-4 py-3 text-right">توقّف عند</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {signups.map((s) => (
                <tr key={s.workspaceId} className={s.onboardingCompleted ? "" : "bg-amber-50/30"}>
                  <td className="px-4 py-3 font-semibold text-foreground">{s.workspaceName}</td>
                  <td className="px-4 py-3 text-muted-foreground" dir="ltr">{s.email}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(s.registeredAt).toLocaleString("ar", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge ok={s.emailVerified} label="بريد" />
                      <Badge ok={s.agentDone} label="وكيل" />
                      <Badge ok={s.channelDone} label="قناة" />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.onboardingCompleted ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        ✓ أكمل الإعداد
                      </span>
                    ) : s.stuckAt ? (
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${STUCK_LABELS[s.stuckAt].className}`}>
                        {STUCK_LABELS[s.stuckAt].label}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
