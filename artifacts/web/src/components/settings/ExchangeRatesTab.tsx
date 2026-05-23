import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";

const BASE = `${import.meta.env.BASE_URL}api`;
const apiFetch = async (path: string, opts?: RequestInit) => {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "حدث خطأ غير متوقع");
  }
  return res.json();
};

const CURRENCIES: { value: "SAR" | "USD"; label: string }[] = [
  { value: "SAR", label: "ريال سعودي (SAR)" },
  { value: "USD", label: "دولار أمريكي (USD)" },
];

interface ExchangeRate {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  effectiveAt: string;
  createdAt: string;
  setBy?: string | null;
}

const emptyForm = { fromCurrency: "SAR" as "SAR" | "USD", rate: "", effectiveAt: "" };

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" });
}

function validRate(rate: string | number | null | undefined) {
  const value = Number(rate);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function ExchangeRatesTab() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("settings:manage");
  const qc = useQueryClient();

  const [addModal, setAddModal] = useState(false);
  const [editTarget, setEditTarget] = useState<ExchangeRate | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formErr, setFormErr] = useState("");
  const [filterCurrency, setFilterCurrency] = useState<"" | "SAR" | "USD">("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["exchange-rates-settings", filterCurrency],
    queryFn: () => apiFetch(`exchange-rates${filterCurrency ? `?fromCurrency=${filterCurrency}` : ""}`),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["exchange-rates-settings"] });

  const createMut = useMutation({
    mutationFn: (body: { fromCurrency: string; toCurrency: string; rate: number; effectiveAt?: string }) =>
      apiFetch("exchange-rates", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }),
    onSuccess: () => { invalidate(); setAddModal(false); setForm(emptyForm); },
    onError: (e: Error) => setFormErr(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (vars: { id: string; rate: number; effectiveAt?: string }) => {
      const { id, ...body } = vars;
      return apiFetch(`exchange-rates/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
    },
    onSuccess: () => { invalidate(); setEditTarget(null); setForm(emptyForm); },
    onError: (e: Error) => setFormErr(e.message),
  });

  const openAdd = () => {
    setForm(emptyForm); setFormErr(""); setAddModal(true);
  };

  const openEdit = (r: ExchangeRate) => {
    setForm({ fromCurrency: r.fromCurrency as "SAR" | "USD", rate: r.rate, effectiveAt: "" });
    setFormErr(""); setEditTarget(r);
  };

  const handleCreate = () => {
    const rateNum = parseFloat(form.rate);
    if (!form.rate || isNaN(rateNum) || rateNum <= 0) { setFormErr("سعر الصرف يجب أن يكون أكبر من صفر"); return; }
    createMut.mutate({
      fromCurrency: form.fromCurrency,
      toCurrency: "YER",
      rate: rateNum,
      effectiveAt: form.effectiveAt || undefined,
    });
  };

  const handleUpdate = () => {
    if (!editTarget) return;
    const rateNum = parseFloat(form.rate);
    if (!form.rate || isNaN(rateNum) || rateNum <= 0) { setFormErr("سعر الصرف يجب أن يكون أكبر من صفر"); return; }
    updateMut.mutate({ id: editTarget.id, rate: rateNum, effectiveAt: form.effectiveAt || undefined });
  };

  const rates: ExchangeRate[] = data?.rates ?? [];
  const latestRates: ExchangeRate[] = data?.latestRates ?? [];

  if (isLoading) {
    return <div className="py-16 text-center text-muted-foreground text-sm">جار التحميل...</div>;
  }

  if (isError) {
    return (
      <div className="py-16 text-center">
        <p className="text-destructive text-sm mb-3">تعذّر تحميل أسعار الصرف</p>
        <button onClick={() => refetch()} className="text-sm text-primary underline">إعادة المحاولة</button>
      </div>
    );
  }

  if (!hasPermission("payments:read")) {
    return <div className="py-16 text-center text-muted-foreground text-sm">ليس لديك صلاحية عرض أسعار الصرف</div>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Latest rates summary */}
      {latestRates.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">آخر الأسعار الفعّالة</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {latestRates.map((r) => (
              <div key={r.id} className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-baseline gap-2 justify-between">
                  <div>
                    <span className="text-lg font-bold text-foreground">{validRate(r.rate)?.toLocaleString("ar") ?? "لم يتم ضبط سعر الصرف"}</span>
                    {validRate(r.rate) && <span className="text-xs text-muted-foreground ms-1">ر.ي</span>}
                  </div>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary" dir="ltr">
                    1 {r.fromCurrency}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{fmt(r.effectiveAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Header + filter */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label htmlFor="exchange-rate-filter-currency" className="text-sm text-muted-foreground">تصفية:</label>
          <select id="exchange-rate-filter-currency" name="exchangeRateFilterCurrency" value={filterCurrency} onChange={e => setFilterCurrency(e.target.value as any)}
            className="text-sm px-2 py-1 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/30">
            <option value="">الكل</option>
            <option value="SAR">SAR</option>
            <option value="USD">USD</option>
          </select>
        </div>
        {canManage && (
          <button onClick={openAdd}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            + إضافة سعر صرف
          </button>
        )}
      </div>

      {/* Rates list */}
      {rates.length === 0 ? (
        <div className="bg-card rounded-xl border border-border py-16 text-center">
          <p className="text-muted-foreground text-sm">لا توجد أسعار صرف مسجّلة</p>
          {canManage && (
            <button onClick={openAdd} className="mt-3 text-sm text-primary underline">أضف سعر صرف</button>
          )}
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {rates.map((r, i) => {
            const rate = validRate(r.rate);

            return (
            <div key={r.id} className={`flex items-center gap-4 px-4 py-3 ${i < rates.length - 1 ? "border-b border-border/50" : ""}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-foreground" dir="ltr">
                    1 {r.fromCurrency} = {rate ? rate.toLocaleString("ar", { minimumFractionDigits: 2 }) : "لم يتم ضبط سعر الصرف"} {rate ? r.toCurrency : ""}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{fmt(r.effectiveAt)}</div>
              </div>
              {canManage && (
                <button onClick={() => openEdit(r)}
                  className="text-xs px-2.5 py-1.5 rounded border border-border hover:bg-muted transition-colors shrink-0">
                  تعديل
                </button>
              )}
            </div>
          );
          })}
        </div>
      )}

      {/* Add Modal */}
      {addModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && setAddModal(false)}>
          <div className="bg-background rounded-xl border border-border shadow-2xl w-full max-w-sm p-5" dir="rtl">
            <h3 className="text-base font-semibold mb-4">إضافة سعر صرف جديد</h3>
            {formErr && (
              <div className="mb-3 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">{formErr}</div>
            )}
            <RateForm form={form} setForm={setForm} showCurrency />
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setAddModal(false)}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">إلغاء</button>
              <button onClick={handleCreate} disabled={createMut.isPending}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {createMut.isPending ? "جار الحفظ..." : "حفظ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && setEditTarget(null)}>
          <div className="bg-background rounded-xl border border-border shadow-2xl w-full max-w-sm p-5" dir="rtl">
            <h3 className="text-base font-semibold mb-1">تعديل سعر الصرف</h3>
            <p className="text-xs text-muted-foreground mb-4" dir="ltr">
              {editTarget.fromCurrency} → {editTarget.toCurrency} · السعر الحالي: {editTarget.rate}
            </p>
            {formErr && (
              <div className="mb-3 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">{formErr}</div>
            )}
            <RateForm form={form} setForm={setForm} showCurrency={false} />
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setEditTarget(null)}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">إلغاء</button>
              <button onClick={handleUpdate} disabled={updateMut.isPending}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {updateMut.isPending ? "جار الحفظ..." : "حفظ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RateForm({ form, setForm, showCurrency }: {
  form: { fromCurrency: "SAR" | "USD"; rate: string; effectiveAt: string };
  setForm: (f: any) => void;
  showCurrency: boolean;
}) {
  const idPrefix = showCurrency ? "exchange-rate-add" : "exchange-rate-edit";

  return (
    <div className="space-y-3">
      {showCurrency && (
        <div>
          <label htmlFor={`${idPrefix}-from-currency`} className="block text-sm font-medium mb-1">العملة المصدر</label>
          <select id={`${idPrefix}-from-currency`} name="fromCurrency" value={form.fromCurrency} onChange={e => setForm({ ...form, fromCurrency: e.target.value as any })}
            className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
            {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      )}
      <div>
        <label htmlFor={`${idPrefix}-rate`} className="block text-sm font-medium mb-1">
          سعر الصرف <span className="text-muted-foreground text-xs font-normal">(كم ريال يمني لكل وحدة)</span>
        </label>
        <input
          id={`${idPrefix}-rate`}
          name="rate"
          type="number" min="0.0001" step="any" value={form.rate}
          onChange={e => setForm({ ...form, rate: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="مثال: 530.5" dir="ltr" />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-effective-at`} className="block text-sm font-medium mb-1">
          تاريخ التفعيل <span className="text-muted-foreground text-xs font-normal">(اختياري — افتراضي: الآن)</span>
        </label>
        <input
          id={`${idPrefix}-effective-at`}
          name="effectiveAt"
          type="datetime-local" value={form.effectiveAt}
          onChange={e => setForm({ ...form, effectiveAt: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
      </div>
    </div>
  );
}
