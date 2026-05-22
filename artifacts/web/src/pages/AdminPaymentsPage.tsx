import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";

const BASE = `${import.meta.env.BASE_URL}api`;

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json.error ?? text);
    } catch {
      throw new Error(text);
    }
  }
  return res.json();
}

const statusLabels: Record<string, string> = {
  pending: "قيد المراجعة",
  confirmed: "مؤكد",
  rejected: "مرفوض",
};

export default function AdminPaymentsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("pending");
  const [rejectReason, setRejectReason] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-payments", status],
    queryFn: () => apiFetch(`admin/payments?status=${status}`),
  });

  const confirm = useMutation({
    mutationFn: (id: string) => apiFetch(`admin/payments/${id}/confirm`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-payments"] }),
  });

  const reject = useMutation({
    mutationFn: (id: string) => apiFetch(`admin/payments/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: rejectReason || "لم يتم قبول بيانات الدفع" }),
    }),
    onSuccess: () => {
      setRejectReason("");
      qc.invalidateQueries({ queryKey: ["admin-payments"] });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="مراجعة المدفوعات"
        subtitle="تأكيد التحويلات اليدوية وتفعيل الاشتراكات بعد مراجعة بيانات الدفع."
      />

      <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
        <label className="text-sm font-semibold">الحالة</label>
        <select className="ms-3 rounded-lg border border-border bg-background px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="pending">قيد المراجعة</option>
          <option value="confirmed">مؤكد</option>
          <option value="rejected">مرفوض</option>
          <option value="all">الكل</option>
        </select>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error instanceof Error ? error.message : "تعذر تحميل المدفوعات"}</div>}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">جار تحميل طلبات الدفع...</div>
      ) : (data?.submissions ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">لا توجد طلبات دفع بهذه الحالة</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1.4fr] gap-3 border-b border-border bg-secondary/60 px-4 py-3 text-xs font-black text-muted-foreground">
            <span>المنشأة</span>
            <span>الباقة</span>
            <span>المبلغ</span>
            <span>الحالة</span>
            <span>الإجراء</span>
          </div>
          {data.submissions.map((item: any) => (
            <div key={item.id} className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1.4fr] gap-3 border-b border-border/60 px-4 py-4 text-sm last:border-0">
              <div>
                <div className="font-bold text-foreground">{item.workspaceName}</div>
                <div className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("ar")}</div>
              </div>
              <div>{item.planNameAr ?? item.planName}</div>
              <div>
                <div className="font-bold">{Number(item.amountYer).toLocaleString("ar")} ريال</div>
                <div className="text-xs text-muted-foreground">{item.paymentMethod} · {item.reference || "بدون مرجع"}</div>
              </div>
              <div><span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold text-muted-foreground">{statusLabels[item.status] ?? item.status}</span></div>
              <div className="space-y-2">
                {item.status === "pending" ? (
                  <>
                    <div className="flex gap-2">
                      <button onClick={() => confirm.mutate(item.id)} disabled={confirm.isPending} className="rounded-lg bg-accent px-3 py-2 text-xs font-black text-white disabled:opacity-50">تأكيد</button>
                      <button onClick={() => reject.mutate(item.id)} disabled={reject.isPending} className="rounded-lg border border-border px-3 py-2 text-xs font-black text-foreground disabled:opacity-50">رفض</button>
                    </div>
                    <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs" placeholder="سبب الرفض عند الحاجة" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">تمت المراجعة</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
