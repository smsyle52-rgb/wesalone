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
  under_review: "قيد المراجعة",
  confirmed: "تم التأكيد",
  rejected: "مرفوض",
  cancelled: "ملغي",
  expired: "منتهي",
  all: "كل الطلبات",
};

export default function AdminPaymentsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("under_review");
  const [selected, setSelected] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-payments", status],
    queryFn: () => apiFetch(`admin/payments?status=${status}`),
  });

  const confirm = useMutation({
    mutationFn: (id: string) => apiFetch(`admin/payments/${id}/confirm`, { method: "POST" }),
    onSuccess: () => {
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["admin-payments"] });
    },
  });

  const reject = useMutation({
    mutationFn: (id: string) => apiFetch(`admin/payments/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: rejectReason }),
    }),
    onSuccess: () => {
      setRejectReason("");
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["admin-payments"] });
    },
  });

  const stats = data?.stats ?? {};
  const amountEntries = Object.entries(stats.amountsByCurrency ?? {});

  return (
    <div className="space-y-6">
      <PageHeader title="إدارة وصال ون" subtitle="مراجعة دفعات الاشتراكات اليدوية وتفعيل الباقات بعد التحقق من الإيصالات." />

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="طلبات تنتظر المراجعة" value={stats.underReview ?? 0} />
        <Stat label="دفعات مؤكدة اليوم" value={stats.confirmedToday ?? 0} />
        <Stat label="دفعات مرفوضة" value={stats.rejected ?? 0} />
        <Stat label="قيمة الدفعات" value={amountEntries.length ? amountEntries.map(([c, v]) => `${Number(v).toLocaleString("ar-u-nu-latn")} ${c}`).join(" · ") : "0"} />
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
        <label className="text-sm font-semibold">الحالة</label>
        <select className="ms-3 rounded-lg border border-border bg-background px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
          {["under_review", "confirmed", "rejected", "cancelled", "expired", "all"].map((item) => (
            <option key={item} value={item}>{statusLabels[item]}</option>
          ))}
        </select>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error instanceof Error ? error.message : "تعذر تحميل المدفوعات"}</div>}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">جار تحميل طلبات الدفع...</div>
      ) : (data?.submissions ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">لا توجد طلبات دفع بهذه الحالة</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr_.8fr] gap-3 border-b border-border bg-secondary/60 px-4 py-3 text-xs font-black text-muted-foreground">
            <span>مساحة العمل</span>
            <span>صاحب الحساب</span>
            <span>الباقة</span>
            <span>المبلغ</span>
            <span>الإجراء</span>
          </div>
          {data.submissions.map((item: any) => (
            <button key={item.id} type="button" onClick={() => setSelected(item)} className="grid w-full grid-cols-[1.2fr_1fr_1fr_1fr_.8fr] gap-3 border-b border-border/60 px-4 py-4 text-start text-sm last:border-0 hover:bg-secondary/40">
              <div>
                <div className="font-bold text-foreground">{item.workspaceName}</div>
                <div className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("ar-u-nu-latn")}</div>
              </div>
              <div>
                <div className="font-bold">{item.ownerName ?? "غير محدد"}</div>
                <div className="text-xs text-muted-foreground">{item.ownerEmail ?? "-"}</div>
              </div>
              <div>{item.planNameAr ?? item.planName} · {item.billingCycle === "annual" ? "سنوي" : "شهري"}</div>
              <div>{Number(item.amount ?? 0).toLocaleString("ar-u-nu-latn")} {item.amountCurrency}</div>
              <div><span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold">{statusLabels[item.status] ?? item.status}</span></div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-2xl sm:max-w-2xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-primary">{statusLabels[selected.status] ?? selected.status}</p>
                <h2 className="mt-1 text-2xl font-black">{selected.workspaceName}</h2>
              </div>
              <button className="rounded-lg border border-border px-3 py-2 text-sm font-bold" onClick={() => setSelected(null)}>إغلاق</button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Info label="صاحب الحساب" value={`${selected.ownerName ?? "-"} · ${selected.ownerEmail ?? "-"}`} />
              <Info label="الباقة" value={`${selected.planNameAr ?? selected.planName} · ${selected.billingCycle === "annual" ? "سنوي" : "شهري"}`} />
              <Info label="المبلغ" value={`${Number(selected.amount ?? 0).toLocaleString("ar-u-nu-latn")} ${selected.amountCurrency}`} />
              <Info label="طريقة التحويل" value={selected.paymentMethod} />
              <Info label="رقم المرجع" value={selected.reference || "-"} />
              <Info label="تاريخ الإرسال" value={new Date(selected.createdAt).toLocaleString("ar-u-nu-latn")} />
            </div>
            {selected.receiptNote && <Info className="mt-3" label="ملاحظة العميل" value={selected.receiptNote} />}
            {selected.rejectionReason && <Info className="mt-3" label="سبب الرفض" value={selected.rejectionReason} />}
            {selected.receiptFileUrl && (
              <a className="mt-4 inline-flex rounded-lg border border-border px-4 py-2 text-sm font-black text-primary" href={selected.receiptFileUrl} target="_blank" rel="noreferrer">عرض الإيصال</a>
            )}
            {selected.status === "under_review" && (
              <div className="mt-5 space-y-3 border-t border-border pt-4">
                <button disabled={confirm.isPending} onClick={() => confirm.mutate(selected.id)} className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-black text-primary-foreground disabled:opacity-50">تأكيد الدفع</button>
                <textarea className="min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="سبب الرفض إلزامي" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
                <button disabled={reject.isPending || rejectReason.trim().length < 2} onClick={() => reject.mutate(selected.id)} className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700 disabled:opacity-50">رفض الطلب</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-black text-foreground">{value}</p>
    </div>
  );
}

function Info({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-lg border border-border bg-secondary/40 p-3 ${className}`}>
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}
