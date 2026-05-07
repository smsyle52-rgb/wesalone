import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatCurrency, statusLabels } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

const BASE = `${import.meta.env.BASE_URL}api`;
const apiFetch = async (path: string, opts?: RequestInit) => {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const text = await res.text();
    try { const j = JSON.parse(text); throw new Error(j.error ?? text); } catch { throw new Error(text); }
  }
  return res.json();
};

const STATUSES = ["", "pending", "confirmed", "rejected"];
const CURRENCIES = ["", "YER", "SAR", "USD"];

function PermissionDenied() {
  return (
    <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm text-center">
      🔒 ليس لديك صلاحية لتنفيذ هذا الإجراء
    </div>
  );
}

function payStatusBadge(status: string) {
  const cfg: Record<string, string> = {
    pending: "bg-amber-50 text-amber-700 border border-amber-200",
    confirmed: "bg-green-50 text-green-700 border border-green-200",
    rejected: "bg-red-50 text-red-600 border border-red-200",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg[status] ?? "bg-muted text-muted-foreground"}`}>
      {statusLabels[status] ?? status}
    </span>
  );
}

function validRate(rate: string | number | null | undefined) {
  const value = Number(rate);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const emptyForm = {
  amount: "", currency: "YER", paymentMethodId: "",
  orderId: "", contactId: "", reference: "", notes: "", paidAt: "",
};

export default function PaymentsPage() {
  const { hasPermission } = useAuth();
  const qc = useQueryClient();

  const canRead = hasPermission("payments:read");
  const canCreate = hasPermission("payments:create");
  const canConfirm = hasPermission("payments:confirm");
  const canReject = hasPermission("payments:reject");

  const [statusFilter, setStatusFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [selectedPayment, setSelectedPayment] = useState<any | null>(null);

  // ── Queries ──────────────────────────────────────────────────────
  const qParams = new URLSearchParams();
  if (statusFilter) qParams.set("status", statusFilter);
  if (methodFilter) qParams.set("method", methodFilter);
  if (currencyFilter) qParams.set("currency", currencyFilter);
  qParams.set("limit", "50");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["payments", statusFilter, methodFilter, currencyFilter],
    queryFn: () => apiFetch(`payments?${qParams}`),
    enabled: canRead,
  });

  const { data: contacts } = useQuery({
    queryKey: ["contacts-mini"],
    queryFn: () => apiFetch("contacts?limit=200"),
    enabled: canRead && showNew,
  });

  const { data: orders } = useQuery({
    queryKey: ["orders-mini"],
    queryFn: () => apiFetch("orders?limit=200"),
    enabled: canRead && showNew,
  });

  const { data: payMethodsData } = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => apiFetch("payment-methods"),
    enabled: canRead,
  });

  const { data: exchangeRatesData } = useQuery({
    queryKey: ["exchange-rates"],
    queryFn: () => apiFetch("exchange-rates"),
    enabled: canRead,
  });

  const payments: any[] = data?.payments ?? [];
  const payMethods: any[] = payMethodsData?.methods ?? [];
  const latestRates: any[] = exchangeRatesData?.latestRates ?? [];

  // ── Mutations ────────────────────────────────────────────────────
  const createPayment = useMutation({
    mutationFn: (body: any) => apiFetch("payments", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setShowNew(false);
      setForm(emptyForm);
    },
  });

  const confirmPayment = useMutation({
    mutationFn: (id: string) => apiFetch(`payments/${id}/confirm`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setConfirmingId(null);
      setSelectedPayment(null);
    },
  });

  const rejectPayment = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiFetch(`payments/${id}/reject`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setRejectingId(null);
      setRejectReason("");
      setSelectedPayment(null);
    },
  });

  // ── Helpers ──────────────────────────────────────────────────────
  function handleCreate() {
    if (!form.amount || !form.paymentMethodId) return;
    createPayment.mutate({
      amount: Number(form.amount),
      currency: form.currency,
      paymentMethodId: form.paymentMethodId,
      orderId: form.orderId || undefined,
      contactId: form.contactId || undefined,
      reference: form.reference || undefined,
      notes: form.notes || undefined,
      paidAt: form.paidAt || undefined,
    });
  }

  function getMethodLabel(p: any): string {
    if (p.methodSnapshot && typeof p.methodSnapshot === "object") {
      return (p.methodSnapshot as any).labelAr ?? p.method;
    }
    const pm = payMethods.find((m: any) => m.slug === p.method);
    return pm?.labelAr ?? p.method;
  }

  function getExchangeRateForCurrency(currency: string) {
    return latestRates.find((r: any) => r.fromCurrency === currency);
  }

  const selectedMethodRequiresRef = payMethods.find((m: any) => m.id === form.paymentMethodId)?.requiresReference;
  const selectedCurrencyRate = form.currency !== "YER" ? getExchangeRateForCurrency(form.currency) : null;
  const selectedRate = validRate(selectedCurrencyRate?.rate);
  const estimatedYer = form.amount && selectedRate
    ? Number(form.amount) * selectedRate
    : null;

  // ── Table columns ─────────────────────────────────────────────────
  const columns = [
    {
      key: "amount", label: "المبلغ",
      render: (r: any) => (
        <div>
          <span className="font-bold text-foreground">{formatCurrency(r.amount, r.currency)}</span>
          {r.baseAmountYer && r.currency !== "YER" && (
            <p className="text-xs text-muted-foreground">≈ {formatCurrency(r.baseAmountYer, "YER")}</p>
          )}
        </div>
      ),
    },
    { key: "method", label: "طريقة الدفع", render: (r: any) => <span className="text-sm text-foreground">{getMethodLabel(r)}</span> },
    {
      key: "order", label: "الطلب / العميل",
      render: (r: any) => (
        <div className="text-xs text-muted-foreground">
          {r.orderNumber && <p className="font-mono font-semibold text-foreground">{r.orderNumber}</p>}
          {r.contactName && <p>{r.contactName}</p>}
          {!r.orderNumber && !r.contactName && "—"}
        </div>
      ),
    },
    {
      key: "reference", label: "المرجع",
      render: (r: any) => r.reference
        ? <span className="text-xs font-mono text-muted-foreground" dir="ltr">{r.reference}</span>
        : <span className="text-xs text-muted-foreground">—</span>,
    },
    { key: "status", label: "الحالة", render: (r: any) => payStatusBadge(r.status) },
    { key: "createdAt", label: "التاريخ", render: (r: any) => <span className="text-xs text-muted-foreground">{formatDate(r.paidAt ?? r.createdAt)}</span> },
    {
      key: "actions", label: "إجراءات",
      render: (r: any) => r.status === "pending" && (canConfirm || canReject) ? (
        <div className="flex gap-1.5">
          {canConfirm && (
            <button onClick={(e) => { e.stopPropagation(); setConfirmingId(r.id); setSelectedPayment(r); }}
              className="px-2 py-1 rounded bg-green-100 text-green-700 text-xs font-medium hover:bg-green-200 transition-colors">
              تأكيد
            </button>
          )}
          {canReject && (
            <button onClick={(e) => { e.stopPropagation(); setRejectingId(r.id); setSelectedPayment(r); }}
              className="px-2 py-1 rounded bg-red-100 text-red-600 text-xs font-medium hover:bg-red-200 transition-colors">
              رفض
            </button>
          )}
        </div>
      ) : null,
    },
  ];

  return (
    <div dir="rtl">
      <PageHeader
        title="المدفوعات"
        subtitle="سجل المدفوعات اليدوية — كريمي، جوالي، بنك، نقداً"
        actions={
          canCreate ? (
            <button onClick={() => setShowNew(true)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
              + تسجيل دفعة
            </button>
          ) : (
            <button disabled className="px-4 py-2 rounded-lg bg-primary/40 text-primary-foreground text-sm font-semibold cursor-not-allowed opacity-50">
              + تسجيل دفعة
            </button>
          )
        }
      />

      {!canRead ? <PermissionDenied /> : (
        <>
          {/* Summary */}
          {data && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                <p className="text-xs text-green-600 mb-0.5">إجمالي المؤكد</p>
                <p className="font-bold text-green-800 text-sm">{formatCurrency(data.totalConfirmed, "YER")}</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-xs text-amber-600 mb-0.5">قيد الانتظار</p>
                <p className="font-bold text-amber-800 text-sm">{formatCurrency(data.totalPending, "YER")}</p>
              </div>
              <div className="bg-muted border border-border rounded-xl p-3">
                <p className="text-xs text-muted-foreground mb-0.5">الإجمالي</p>
                <p className="font-bold text-foreground text-sm">{data.total} دفعة</p>
              </div>
            </div>
          )}

          {/* Exchange Rate Info */}
          {latestRates.length > 0 && (
            <div className="flex gap-2 mb-3 flex-wrap">
              {latestRates.map((r: any) => {
                const rate = validRate(r.rate);

                return (
                  <span key={r.id} className="text-xs bg-blue-50 border border-blue-200 text-blue-700 px-2.5 py-1 rounded-full">
                    {rate ? `1 ${r.fromCurrency} = ${rate.toLocaleString("ar-YE")} ${r.toCurrency}` : `1 ${r.fromCurrency} = لم يتم ضبط سعر الصرف`}
                  </span>
                );
              })}
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="flex gap-1.5 overflow-x-auto">
              {STATUSES.map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                  {s === "" ? "كل الحالات" : statusLabels[s] ?? s}
                </button>
              ))}
            </div>
            <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="">كل الطرق</option>
              {payMethods.map((m: any) => <option key={m.id} value={m.slug}>{m.labelAr}</option>)}
            </select>
            <select value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c === "" ? "كل العملات" : c}</option>)}
            </select>
          </div>

          {!canConfirm && !canReject && (
            <div className="mb-4 px-4 py-2.5 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm">
              ⚠️ تأكيد ورفض المدفوعات يتطلب صلاحية خاصة (مدير أو محاسب)
            </div>
          )}
          {isError && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm flex items-center justify-between">
              <span>تعذّر تحميل المدفوعات</span>
              <button onClick={() => refetch()} className="text-xs underline font-medium">إعادة المحاولة</button>
            </div>
          )}

          <DataTable columns={columns} data={payments} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="لا توجد مدفوعات" />
        </>
      )}

      {/* ── Create Payment Modal ────────────────────────────────── */}
      <Modal open={showNew} onClose={() => { setShowNew(false); setForm(emptyForm); }} title="تسجيل دفعة جديدة">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">المبلغ *</label>
              <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="0" dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">العملة</label>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="YER">ريال يمني</option>
                <option value="USD">دولار</option>
                <option value="SAR">ريال سعودي</option>
              </select>
            </div>
          </div>

          {form.currency !== "YER" && (
            <div className={`text-xs p-2.5 rounded-lg ${estimatedYer ? "bg-blue-50 border border-blue-200 text-blue-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
              {estimatedYer
                ? `≈ ${formatCurrency(estimatedYer, "YER")} (سعر الصرف: ${selectedCurrencyRate?.rate})`
                : `⚠️ لا يوجد سعر صرف لـ ${form.currency} — يجب إضافته من الإعدادات قبل تسجيل الدفعة`}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1">طريقة الدفع *</label>
            <div className="grid grid-cols-3 gap-1.5">
              {payMethods.map((m: any) => (
                <button key={m.id} onClick={() => setForm({ ...form, paymentMethodId: m.id })}
                  className={`py-2 rounded-lg text-xs font-medium border transition-colors ${form.paymentMethodId === m.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
                  {m.labelAr}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">
              رقم الحوالة / المرجع {selectedMethodRequiresRef && <span className="text-destructive">*</span>}
            </label>
            <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="اختياري..." dir="ltr" />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">ربط بطلب</label>
            <select value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="">بدون طلب</option>
              {(orders?.orders ?? []).map((o: any) => (
                <option key={o.id} value={o.id}>{o.orderNumber} — {o.contactName ?? "بدون عميل"} ({formatCurrency(o.totalAmount ?? 0, o.currency)})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">العميل</label>
            <select value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="">بدون عميل</option>
              {contacts?.contacts?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">تاريخ الدفع</label>
            <input type="datetime-local" value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">ملاحظات</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              rows={2} placeholder="ملاحظات إضافية..." />
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-700">
            ⏳ الدفعة ستُسجَّل بحالة "قيد الانتظار" وتحتاج تأكيداً من المدير أو المحاسب
          </div>

          {createPayment.isError && (
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">
              {(createPayment.error as Error)?.message ?? "حدث خطأ"}
            </div>
          )}
          <button onClick={handleCreate}
            disabled={createPayment.isPending || !form.amount || !form.paymentMethodId}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {createPayment.isPending ? "جار التسجيل..." : "تسجيل الدفعة"}
          </button>
        </div>
      </Modal>

      {/* ── Confirm Modal ───────────────────────────────────────── */}
      <Modal open={!!confirmingId} onClose={() => { setConfirmingId(null); setSelectedPayment(null); }} title="تأكيد الدفعة" size="sm">
        <div className="space-y-3">
          {selectedPayment && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
              <p className="font-semibold text-green-800">{formatCurrency(selectedPayment.amount, selectedPayment.currency)}</p>
              <p className="text-xs text-green-700 mt-0.5">{getMethodLabel(selectedPayment)}{selectedPayment.reference ? ` — #${selectedPayment.reference}` : ""}</p>
              {selectedPayment.orderNumber && <p className="text-xs text-green-600">طلب: {selectedPayment.orderNumber}</p>}
            </div>
          )}
          <p className="text-sm text-muted-foreground">هل أنت متأكد من تأكيد هذه الدفعة؟ سيتم تحديث مبلغ الطلب المدفوع.</p>
          {confirmPayment.isError && (
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">
              {(confirmPayment.error as Error)?.message ?? "حدث خطأ"}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => confirmPayment.mutate(confirmingId!)}
              disabled={confirmPayment.isPending}
              className="flex-1 py-2.5 rounded-lg bg-green-600 text-white font-semibold text-sm hover:bg-green-700 disabled:opacity-50">
              {confirmPayment.isPending ? "جار التأكيد..." : "تأكيد الدفعة"}
            </button>
            <button onClick={() => { setConfirmingId(null); setSelectedPayment(null); }}
              className="flex-1 py-2.5 rounded-lg bg-muted text-foreground font-semibold text-sm hover:bg-muted/80">
              إلغاء
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Reject Modal ────────────────────────────────────────── */}
      <Modal open={!!rejectingId} onClose={() => { setRejectingId(null); setRejectReason(""); setSelectedPayment(null); }} title="رفض الدفعة" size="sm">
        <div className="space-y-3">
          {selectedPayment && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
              <p className="font-semibold text-red-800">{formatCurrency(selectedPayment.amount, selectedPayment.currency)}</p>
              <p className="text-xs text-red-700 mt-0.5">{getMethodLabel(selectedPayment)}</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">سبب الرفض <span className="text-destructive">*</span></label>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              rows={3} placeholder="أدخل سبب الرفض بوضوح..." />
            {!rejectReason.trim() && rejectReason.length > 0 && (
              <p className="text-xs text-destructive mt-1">لا يُقبل سبب فارغ أو مسافات فقط</p>
            )}
          </div>
          {rejectPayment.isError && (
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">
              {(rejectPayment.error as Error)?.message ?? "حدث خطأ"}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => rejectPayment.mutate({ id: rejectingId!, reason: rejectReason })}
              disabled={rejectPayment.isPending || !rejectReason.trim()}
              className="flex-1 py-2.5 rounded-lg bg-destructive text-destructive-foreground font-semibold text-sm hover:bg-destructive/90 disabled:opacity-50">
              {rejectPayment.isPending ? "جار الرفض..." : "رفض الدفعة"}
            </button>
            <button onClick={() => { setRejectingId(null); setRejectReason(""); setSelectedPayment(null); }}
              className="flex-1 py-2.5 rounded-lg bg-muted text-foreground font-semibold text-sm hover:bg-muted/80">
              إلغاء
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
