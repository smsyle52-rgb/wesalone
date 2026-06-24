/**
 * PointsWalletPage — صفحة المحفظة وشحن النقاط للتجار
 *
 * تعرض: رصيد شهري + مشترى + مجمد + حزم الشحن + سجل الطلبات + حركات المحفظة
 * لا تعرض: أسماء نماذج AI، مزودين، tokens، chunks — مخفي عن التجار
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";

const BASE = `${import.meta.env.BASE_URL}api`;

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const json = await res.json().catch(() => ({ error: "خطأ غير معروف" }));
    throw new Error(json.error ?? "خطأ في الخادم");
  }
  return res.json();
}

const orderStatusLabel: Record<string, string> = {
  pending_payment: "ينتظر تأكيد الدفع",
  under_review:    "قيد المراجعة",
  approved:        "مُعتمد ✓",
  rejected:        "مرفوض",
  cancelled:       "ملغي",
  expired:         "منتهي",
};

const orderStatusClass: Record<string, string> = {
  pending_payment: "bg-yellow-100 text-yellow-800",
  under_review:    "bg-blue-100 text-blue-800",
  approved:        "bg-green-100 text-green-800",
  rejected:        "bg-red-100 text-red-800",
  cancelled:       "bg-gray-100 text-gray-600",
  expired:         "bg-gray-100 text-gray-500",
};

type WalletData = {
  balance: {
    walletId: string;
    walletStatus: string;
    monthlyPoints: number;
    purchasedPoints: number;
    frozenPoints: number;
    totalAvailablePoints: number;
    nearestExpiry: string | null;
  };
  canTopup: boolean;
  topupBlockReason: string | null;
};

export default function PointsWalletPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"wallet" | "orders" | "ledger">("wallet");
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("kuraimi");
  const [paidAmountMinor, setPaidAmountMinor] = useState("");
  const [paidCurrency, setPaidCurrency] = useState("YER");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const walletQ = useQuery<WalletData>({
    queryKey: ["points-wallet"],
    queryFn: () => apiFetch("points/wallet"),
  });

  const productsQ = useQuery<{ products: Array<{ id: string; slug: string; nameAr: string; points: number; priceCents: number; currency: string }> }>({
    queryKey: ["topup-products"],
    queryFn: () => apiFetch("points/topup-products"),
    enabled: walletQ.data?.canTopup ?? false,
  });

  const ordersQ = useQuery<{ orders: Array<{
    id: string; productNameSnapshot: string; pointsSnapshot: number; priceCentsSnapshot: number;
    currencySnapshot: string; status: string; createdAt: string;
  }> }>({
    queryKey: ["topup-orders"],
    queryFn: () => apiFetch("points/purchase-orders"),
    enabled: activeTab === "orders",
  });

  const ledgerQ = useQuery<{ entries: Array<{ id: string; transactionType: string; microPoints: number; reason: string; createdAt: string }> }>({
    queryKey: ["points-ledger"],
    queryFn: () => apiFetch("points/ledger"),
    enabled: activeTab === "ledger",
  });

  const createOrder = useMutation({
    mutationFn: (topupProductId: string) =>
      apiFetch("points/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topupProductId }),
      }),
    onSuccess: (data) => {
      setActiveOrderId(data.order.id);
      setSelectedProduct(null);
      qc.invalidateQueries({ queryKey: ["topup-orders"] });
    },
  });

  const submitPayment = useMutation({
    mutationFn: (orderId: string) =>
      apiFetch(`points/purchase-orders/${orderId}/submit-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod,
          paidAmountMinor: paidAmountMinor.trim(),
          paidCurrency,
          paymentReference: paymentReference.trim() || null,
          paymentReceiptNote: paymentNote.trim() || null,
        }),
      }),
    onSuccess: () => {
      setActiveOrderId(null);
      setPaidAmountMinor(""); setPaymentReference(""); setPaymentNote("");
      qc.invalidateQueries({ queryKey: ["topup-orders"] });
      setRejectError(null);
    },
    onError: (e: Error) => setRejectError(e.message),
  });

  const cancelOrder = useMutation({
    mutationFn: (orderId: string) =>
      apiFetch(`points/purchase-orders/${orderId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      setActiveOrderId(null);
      qc.invalidateQueries({ queryKey: ["topup-orders"] });
    },
  });

  const wallet = walletQ.data;
  const balance = wallet?.balance;

  return (
    <div className="mx-auto max-w-3xl p-4 pb-16">
      <PageHeader title="محفظة النقاط" />

      {/* ── بطاقة الرصيد ─────────────────────────────── */}
      {walletQ.isLoading && <p className="text-center py-8 text-muted-foreground">جارٍ التحميل…</p>}
      {walletQ.error && <p className="text-center py-8 text-destructive">تعذّر تحميل المحفظة</p>}

      {balance && (
        <div className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap gap-4">
            {/* النقاط الشهرية — تُعرض فقط إذا كان هناك رصيد فعلي من grants شهرية */}
            {balance.monthlyPoints > 0 ? (
              <BalanceCard label="نقاط شهرية" value={balance.monthlyPoints} note="تنتهي مع الدورة الشهرية" />
            ) : (
              <div className="flex-1 min-w-[120px] rounded-lg border border-dashed border-border p-3 opacity-60">
                <p className="text-xs text-muted-foreground mb-1">نقاط شهرية</p>
                <p className="text-sm text-muted-foreground italic">يُفعَّل مع دورة الاشتراك</p>
              </div>
            )}
            <BalanceCard label="نقاط مشتراة" value={balance.purchasedPoints}
              note={balance.nearestExpiry ? `أقرب انتهاء: ${new Date(balance.nearestExpiry).toLocaleDateString("ar")}` : undefined}
            />
            {balance.frozenPoints > 0 && (
              <BalanceCard label="مجمّدة مؤقتاً" value={balance.frozenPoints} note="تُفعَّل بعد الترقية" dimmed />
            )}
          </div>
          <div className="mt-4 border-t border-border pt-4 flex items-center justify-between">
            <span className="text-lg font-bold">الإجمالي المتاح</span>
            <span className="text-2xl font-extrabold text-primary">{balance.totalAvailablePoints.toLocaleString("ar")} نقطة</span>
          </div>
        </div>
      )}

      {/* ── تبويبات ──────────────────────────────────── */}
      <div className="mb-4 flex gap-2 border-b border-border">
        {(["wallet", "orders", "ledger"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-2 px-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground"
            }`}
          >
            {tab === "wallet" ? "شحن الرصيد" : tab === "orders" ? "طلباتي" : "الحركات"}
          </button>
        ))}
      </div>

      {/* ── تبويب شحن الرصيد ────────────────────────── */}
      {activeTab === "wallet" && (
        <div>
          {!wallet?.canTopup && wallet && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-amber-800 mb-3">
                شحن النقاط متاح بعد الترقية إلى إحدى الباقات المدفوعة.
              </p>
              <a
                href="/settings?tab=billing"
                className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                ترقية الباقة
              </a>
            </div>
          )}

          {wallet?.canTopup && (
            <div>
              {/* اختيار الحزمة */}
              {!activeOrderId && (
                <>
                  <h3 className="mb-3 font-semibold text-foreground">اختر حزمة الشحن</h3>
                  {productsQ.isLoading && <p className="text-muted-foreground text-sm">جارٍ التحميل…</p>}
                  <div className="grid gap-3 sm:grid-cols-3">
                    {productsQ.data?.products.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedProduct(p.id)}
                        className={`rounded-xl border-2 p-4 text-right transition-all ${
                          selectedProduct === p.id
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card hover:border-primary/40"
                        }`}
                      >
                        <p className="font-bold text-lg">{p.points.toLocaleString("ar")} نقطة</p>
                        <p className="text-muted-foreground text-sm mt-1">{p.nameAr}</p>
                        <p className="mt-2 text-sm font-medium text-primary">${(p.priceCents / 100).toFixed(0)}</p>
                      </button>
                    ))}
                  </div>
                  {selectedProduct && (
                    <button
                      onClick={() => createOrder.mutate(selectedProduct)}
                      disabled={createOrder.isPending}
                      className="mt-4 w-full rounded-lg bg-primary py-2.5 text-primary-foreground font-medium disabled:opacity-60"
                    >
                      {createOrder.isPending ? "جارٍ الإنشاء…" : "إنشاء طلب الشراء"}
                    </button>
                  )}
                  {createOrder.error && (
                    <p className="mt-2 text-sm text-destructive">{(createOrder.error as Error).message}</p>
                  )}
                </>
              )}

              {/* رفع إثبات الدفع */}
              {activeOrderId && (
                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="font-semibold mb-4">أرسل إثبات الدفع</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm text-muted-foreground block mb-1">طريقة الدفع</label>
                      <select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2"
                      >
                        <option value="kuraimi">كريمي</option>
                        <option value="jawali">جوالي</option>
                        <option value="bank_transfer">تحويل بنكي</option>
                        <option value="cash">نقداً</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground block mb-1">العملة</label>
                      <select
                        value={paidCurrency}
                        onChange={(e) => setPaidCurrency(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2"
                      >
                        <option value="YER">ريال يمني (YER)</option>
                        <option value="USD">دولار أمريكي (USD)</option>
                        <option value="SAR">ريال سعودي (SAR)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground block mb-1">
                        المبلغ المدفوع (بالوحدات الصغرى — أرقام فقط)
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="\d+"
                        placeholder={paidCurrency === "YER" ? "مثال: 500000 (= 500,000 ريال)" : "مثال: 700 (= 7.00 دولار)"}
                        value={paidAmountMinor}
                        onChange={(e) => setPaidAmountMinor(e.target.value.replace(/\D/g, ""))}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground block mb-1">رقم المرجع (اختياري)</label>
                      <input
                        type="text"
                        placeholder="رقم العملية أو الإيصال"
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground block mb-1">ملاحظة (اختياري)</label>
                      <textarea
                        placeholder="أي تفاصيل إضافية عن الدفع"
                        value={paymentNote}
                        onChange={(e) => setPaymentNote(e.target.value)}
                        rows={2}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2"
                      />
                    </div>
                  </div>
                  {rejectError && <p className="mt-2 text-sm text-destructive">{rejectError}</p>}
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => submitPayment.mutate(activeOrderId)}
                      disabled={submitPayment.isPending || !paidAmountMinor.trim()}
                      className="flex-1 rounded-lg bg-primary py-2.5 text-primary-foreground font-medium disabled:opacity-60"
                    >
                      {submitPayment.isPending ? "جارٍ الإرسال…" : "إرسال الإثبات"}
                    </button>
                    <button
                      onClick={() => cancelOrder.mutate(activeOrderId)}
                      className="rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted"
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── تبويب الطلبات ───────────────────────────── */}
      {activeTab === "orders" && (
        <div className="space-y-3">
          {ordersQ.isLoading && <p className="text-muted-foreground text-sm text-center py-4">جارٍ التحميل…</p>}
          {ordersQ.data?.orders.length === 0 && (
            <p className="text-center py-8 text-muted-foreground text-sm">لا توجد طلبات بعد</p>
          )}
          {ordersQ.data?.orders.map((o) => (
            <div key={o.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{o.productNameSnapshot}</p>
                  <p className="text-sm text-muted-foreground">{o.pointsSnapshot.toLocaleString("ar")} نقطة · ${(o.priceCentsSnapshot / 100).toFixed(0)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${orderStatusClass[o.status] ?? "bg-gray-100 text-gray-600"}`}>
                  {orderStatusLabel[o.status] ?? o.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleString("ar")}</p>
              {o.status === "pending_payment" && (
                <button
                  onClick={() => { setActiveOrderId(o.id); setActiveTab("wallet"); }}
                  className="mt-2 text-xs text-primary underline"
                >
                  أكمل الدفع
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── تبويب الحركات ───────────────────────────── */}
      {activeTab === "ledger" && (
        <div className="space-y-2">
          {ledgerQ.isLoading && <p className="text-muted-foreground text-sm text-center py-4">جارٍ التحميل…</p>}
          {ledgerQ.data?.entries.length === 0 && (
            <p className="text-center py-8 text-muted-foreground text-sm">لا توجد حركات بعد</p>
          )}
          {ledgerQ.data?.entries.map((e) => {
            const pts = Math.abs(Math.floor(e.microPoints / 1_000_000));
            const isCredit = e.microPoints > 0;
            return (
              <div key={e.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{e.reason ?? e.transactionType}</p>
                  <p className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString("ar")}</p>
                </div>
                <span className={`font-bold ${isCredit ? "text-green-600" : "text-red-600"}`}>
                  {isCredit ? "+" : "-"}{pts.toLocaleString("ar")} نقطة
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BalanceCard({ label, value, note, dimmed }: { label: string; value: number; note?: string; dimmed?: boolean }) {
  return (
    <div className={`flex-1 min-w-[120px] rounded-lg border border-border p-3 ${dimmed ? "opacity-60" : ""}`}>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-bold">{value.toLocaleString("ar")}</p>
      {note && <p className="text-[11px] text-muted-foreground mt-0.5">{note}</p>}
    </div>
  );
}
