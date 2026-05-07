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

interface PaymentMethod {
  id: string;
  slug: string;
  labelAr: string;
  labelEn?: string | null;
  isActive: boolean;
  requiresReference: boolean;
  requiresReceipt: boolean;
  sortOrder: number;
}

const emptyForm = {
  slug: "", labelAr: "", labelEn: "",
  requiresReference: false, requiresReceipt: false, sortOrder: 0,
};

export function PaymentMethodsTab() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("settings:manage");
  const qc = useQueryClient();

  const [modal, setModal] = useState<"add" | PaymentMethod | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formErr, setFormErr] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["payment-methods-settings"],
    queryFn: () => apiFetch("payment-methods?includeInactive=true"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["payment-methods-settings"] });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("payment-methods", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    onSuccess: () => { invalidate(); setModal(null); },
    onError: (e: Error) => setFormErr(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (vars: { id: string; labelAr: string; labelEn?: string; requiresReference: boolean; requiresReceipt: boolean; sortOrder: number }) => {
      const { id, ...body } = vars;
      return apiFetch(`payment-methods/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
    },
    onSuccess: () => { invalidate(); setModal(null); },
    onError: (e: Error) => setFormErr(e.message),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => apiFetch(`payment-methods/${id}/deactivate`, { method: "PATCH" }),
    onSuccess: invalidate,
  });

  const activateMut = useMutation({
    mutationFn: (id: string) => apiFetch(`payment-methods/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: true }),
    }),
    onSuccess: invalidate,
  });

  const openAdd = () => { setForm(emptyForm); setFormErr(""); setModal("add"); };
  const openEdit = (m: PaymentMethod) => {
    setForm({ slug: m.slug, labelAr: m.labelAr, labelEn: m.labelEn ?? "", requiresReference: m.requiresReference, requiresReceipt: m.requiresReceipt, sortOrder: m.sortOrder });
    setFormErr(""); setModal(m);
  };

  const handleSubmit = () => {
    if (!form.labelAr.trim()) { setFormErr("الاسم العربي مطلوب"); return; }
    if (modal === "add" && !form.slug.trim()) { setFormErr("المعرف المختصر مطلوب"); return; }
    if (modal === "add") {
      createMut.mutate({ slug: form.slug, labelAr: form.labelAr, labelEn: form.labelEn || undefined, requiresReference: form.requiresReference, requiresReceipt: form.requiresReceipt, sortOrder: form.sortOrder });
    } else {
      const m = modal as PaymentMethod;
      updateMut.mutate({ id: m.id, labelAr: form.labelAr, labelEn: form.labelEn || undefined, requiresReference: form.requiresReference, requiresReceipt: form.requiresReceipt, sortOrder: form.sortOrder });
    }
  };

  const methods: PaymentMethod[] = data?.methods ?? [];

  if (isLoading) {
    return <div className="py-16 text-center text-muted-foreground text-sm">جار التحميل...</div>;
  }

  if (isError) {
    return (
      <div className="py-16 text-center">
        <p className="text-destructive text-sm mb-3">تعذّر تحميل طرق الدفع</p>
        <button onClick={() => refetch()} className="text-sm text-primary underline">إعادة المحاولة</button>
      </div>
    );
  }

  if (!hasPermission("payments:read")) {
    return <div className="py-16 text-center text-muted-foreground text-sm">ليس لديك صلاحية عرض طرق الدفع</div>;
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">طرق الدفع المتاحة في هذه المساحة</p>
        {canManage && (
          <button onClick={openAdd}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            + إضافة طريقة
          </button>
        )}
      </div>

      {methods.length === 0 ? (
        <div className="bg-card rounded-xl border border-border py-16 text-center">
          <p className="text-muted-foreground text-sm">لا توجد طرق دفع بعد</p>
          {canManage && (
            <button onClick={openAdd} className="mt-3 text-sm text-primary underline">أضف طريقة دفع</button>
          )}
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {methods.map((m, i) => (
            <div key={m.id} className={`flex items-center gap-4 px-4 py-3 ${i < methods.length - 1 ? "border-b border-border/50" : ""}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">{m.labelAr}</span>
                  {m.labelEn && <span className="text-xs text-muted-foreground" dir="ltr">({m.labelEn})</span>}
                  {!m.isActive && (
                    <span className="px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground border border-border">معطّل</span>
                  )}
                </div>
                <div className="flex gap-3 mt-0.5 flex-wrap">
                  <span className="text-xs text-muted-foreground font-mono" dir="ltr">{m.slug}</span>
                  {m.requiresReference && <span className="text-xs text-amber-600">● مرجع مطلوب</span>}
                  {m.requiresReceipt && <span className="text-xs text-amber-600">● إيصال مطلوب</span>}
                </div>
              </div>
              {canManage && (
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => openEdit(m)}
                    className="text-xs px-2.5 py-1.5 rounded border border-border hover:bg-muted transition-colors">
                    تعديل
                  </button>
                  {m.isActive ? (
                    <button onClick={() => deactivateMut.mutate(m.id)}
                      disabled={deactivateMut.isPending}
                      className="text-xs px-2.5 py-1.5 rounded border border-destructive/30 text-destructive hover:bg-destructive/5 transition-colors disabled:opacity-40">
                      تعطيل
                    </button>
                  ) : (
                    <button onClick={() => activateMut.mutate(m.id)}
                      disabled={activateMut.isPending}
                      className="text-xs px-2.5 py-1.5 rounded border border-green-300 text-green-700 hover:bg-green-50 transition-colors disabled:opacity-40">
                      تفعيل
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="bg-background rounded-xl border border-border shadow-2xl w-full max-w-sm p-5" dir="rtl">
            <h3 className="text-base font-semibold mb-4">
              {modal === "add" ? "إضافة طريقة دفع جديدة" : "تعديل طريقة الدفع"}
            </h3>

            {formErr && (
              <div className="mb-3 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">{formErr}</div>
            )}

            <div className="space-y-3">
              {modal === "add" && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    المعرف المختصر <span className="text-muted-foreground text-xs font-normal">(slug)</span>
                  </label>
                  <input
                    value={form.slug}
                    onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="cash / hawala / bank" dir="ltr" />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">الاسم العربي</label>
                <input value={form.labelAr} onChange={e => setForm({ ...form, labelAr: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="كاش / حوالة / كريمي / جوالي / بنك..." />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  الاسم الإنجليزي <span className="text-muted-foreground text-xs font-normal">(اختياري)</span>
                </label>
                <input value={form.labelEn} onChange={e => setForm({ ...form, labelEn: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  dir="ltr" placeholder="Cash / Bank Transfer..." />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">الترتيب</label>
                <input type="number" min={0} value={form.sortOrder}
                  onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={form.requiresReference}
                    onChange={e => setForm({ ...form, requiresReference: e.target.checked })}
                    className="w-4 h-4 rounded accent-primary" />
                  <span className="text-sm">يتطلب رقماً مرجعياً</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={form.requiresReceipt}
                    onChange={e => setForm({ ...form, requiresReceipt: e.target.checked })}
                    className="w-4 h-4 rounded accent-primary" />
                  <span className="text-sm">يتطلب إيصالاً</span>
                </label>
              </div>
            </div>

            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setModal(null)}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">
                إلغاء
              </button>
              <button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {createMut.isPending || updateMut.isPending ? "جار الحفظ..." : "حفظ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
