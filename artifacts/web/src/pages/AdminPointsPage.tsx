/**
 * AdminPointsPage — واجهة إدارة المنصة للنقاط
 *
 * مقتصر على مديري المنصة (PLATFORM_ADMIN_EMAILS).
 * لا يظهر في قائمة مالك المتجر العادي.
 *
 * يتيح:
 *  - قائمة طلبات مراجعة إثباتات الدفع عبر workspaces
 *  - اعتماد أو رفض بسبب إلزامي
 *  - إدارة حزم الشحن (إضافة / تعديل / إخفاء)
 *  - عرض ledger لمتجر بعينه
 *  - تعديل إداري موجب مع سبب
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";

const BASE = `${import.meta.env.BASE_URL}api`;

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const json = await res.json().catch(() => ({ error: "خطأ" }));
    throw new Error(json.error ?? "خطأ في الخادم");
  }
  return res.json();
}

type Order = {
  id: string;
  workspaceId: string;
  productNameSnapshot: string;
  pointsSnapshot: number;
  priceCentsSnapshot: number;
  currencySnapshot: string;
  status: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
};

type Product = {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  points: number;
  priceCents: number;
  currency: string;
  isActive: boolean;
  sortOrder: number;
};

const statusLabels: Record<string, string> = {
  under_review:    "قيد المراجعة",
  pending_payment: "ينتظر الدفع",
  approved:        "مُعتمد",
  rejected:        "مرفوض",
  cancelled:       "ملغي",
};

export default function AdminPointsPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"orders" | "products" | "ledger" | "adjust">("orders");
  const [statusFilter, setStatusFilter] = useState("under_review");
  const [rejectReason, setRejectReason] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [ledgerWsId, setLedgerWsId] = useState("");
  const [adjustWsId, setAdjustWsId] = useState("");
  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Queries ──
  const ordersQ = useQuery<{ orders: Order[] }>({
    queryKey: ["admin-point-orders", statusFilter],
    queryFn: () => apiFetch(`admin/points/purchase-orders?status=${statusFilter}`),
    enabled: activeTab === "orders",
  });

  const productsQ = useQuery<{ products: Product[] }>({
    queryKey: ["admin-point-products"],
    queryFn: () => apiFetch("admin/points/topup-products"),
    enabled: activeTab === "products",
  });

  const ledgerQ = useQuery<{ entries: Array<{ id: string; transactionType: string; microPoints: number; reason: string; createdAt: string }> }>({
    queryKey: ["admin-ledger", ledgerWsId],
    queryFn: () => apiFetch(`admin/points/ledger/${ledgerWsId}`),
    enabled: activeTab === "ledger" && ledgerWsId.length === 36,
  });

  // ── Mutations ──
  const approve = useMutation({
    mutationFn: (id: string) => apiFetch(`admin/points/purchase-orders/${id}/approve`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-point-orders"] }); setActionError(null); },
    onError: (e: Error) => setActionError(e.message),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch(`admin/points/purchase-orders/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-point-orders"] }); setRejectingId(null); setRejectReason(""); setActionError(null); },
    onError: (e: Error) => setActionError(e.message),
  });

  const toggleProduct = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch(`admin/points/topup-products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-point-products"] }),
  });

  const adjust = useMutation({
    mutationFn: () =>
      apiFetch("admin/points/adjustment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: adjustWsId, points: Number(adjustPoints), reason: adjustReason }),
      }),
    onSuccess: () => { setAdjustPoints(""); setAdjustReason(""); setActionError(null); },
    onError: (e: Error) => setActionError(e.message),
  });

  return (
    <div className="mx-auto max-w-4xl p-4 pb-16">
      <PageHeader title="إدارة النقاط — المنصة" />

      {/* تبويبات */}
      <div className="mb-4 flex gap-2 border-b border-border">
        {(["orders", "products", "ledger", "adjust"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setActionError(null); }}
            className={`pb-2 px-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground"
            }`}
          >
            {{ orders: "الطلبات", products: "الحزم", ledger: "Ledger", adjust: "تعديل إداري" }[tab]}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* ── الطلبات ──────────────────────────────────── */}
      {activeTab === "orders" && (
        <div>
          <div className="mb-4 flex gap-2">
            {["under_review", "pending_payment", "approved", "rejected", "all"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  statusFilter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                }`}
              >
                {statusLabels[s] ?? "الكل"}
              </button>
            ))}
          </div>

          {ordersQ.isLoading && <p className="text-center py-8 text-muted-foreground">جارٍ التحميل…</p>}
          {ordersQ.data?.orders.length === 0 && (
            <p className="text-center py-8 text-muted-foreground text-sm">لا توجد طلبات</p>
          )}

          <div className="space-y-3">
            {ordersQ.data?.orders.map((o) => (
              <div key={o.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{o.productNameSnapshot}</p>
                    <p className="text-sm text-muted-foreground">
                      {o.pointsSnapshot.toLocaleString("ar")} نقطة · ${(o.priceCentsSnapshot / 100).toFixed(0)} {o.currencySnapshot}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Workspace: <code className="text-[10px]">{o.workspaceId}</code>
                    </p>
                    <p className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleString("ar")}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    o.status === "under_review" ? "bg-blue-100 text-blue-800" :
                    o.status === "approved" ? "bg-green-100 text-green-800" :
                    o.status === "rejected" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-600"
                  }`}>
                    {statusLabels[o.status] ?? o.status}
                  </span>
                </div>

                {o.rejectionReason && (
                  <p className="mt-2 text-xs text-red-600">سبب الرفض: {o.rejectionReason}</p>
                )}

                {o.status === "under_review" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => approve.mutate(o.id)}
                      disabled={approve.isPending}
                      className="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white font-medium hover:bg-green-700 disabled:opacity-60"
                    >
                      اعتماد وإضافة النقاط
                    </button>
                    {rejectingId !== o.id ? (
                      <button
                        onClick={() => setRejectingId(o.id)}
                        className="rounded-lg border border-red-200 px-4 py-1.5 text-sm text-red-600 hover:bg-red-50"
                      >
                        رفض
                      </button>
                    ) : (
                      <div className="flex gap-2 flex-1">
                        <input
                          className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                          placeholder="سبب الرفض (إلزامي)"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                        />
                        <button
                          onClick={() => reject.mutate({ id: o.id, reason: rejectReason })}
                          disabled={reject.isPending || !rejectReason.trim()}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-60"
                        >
                          تأكيد الرفض
                        </button>
                        <button onClick={() => setRejectingId(null)} className="text-sm text-muted-foreground">إلغاء</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── الحزم ──────────────────────────────────── */}
      {activeTab === "products" && (
        <div className="space-y-3">
          {productsQ.isLoading && <p className="text-center py-8 text-muted-foreground">جارٍ التحميل…</p>}
          {productsQ.data?.products.map((p) => (
            <div key={p.id} className={`rounded-xl border border-border bg-card p-4 flex items-center justify-between ${!p.isActive ? "opacity-50" : ""}`}>
              <div>
                <p className="font-medium">{p.nameAr} <span className="text-xs text-muted-foreground">({p.slug})</span></p>
                <p className="text-sm text-muted-foreground">{p.points.toLocaleString("ar")} نقطة · ${(p.priceCents / 100).toFixed(0)} {p.currency}</p>
              </div>
              <button
                onClick={() => toggleProduct.mutate({ id: p.id, isActive: !p.isActive })}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
                  p.isActive
                    ? "border-red-200 text-red-600 hover:bg-red-50"
                    : "border-green-200 text-green-600 hover:bg-green-50"
                }`}
              >
                {p.isActive ? "إخفاء" : "تفعيل"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Ledger ─────────────────────────────────── */}
      {activeTab === "ledger" && (
        <div>
          <div className="mb-4 flex gap-2">
            <input
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="Workspace ID (UUID)"
              value={ledgerWsId}
              onChange={(e) => setLedgerWsId(e.target.value)}
            />
          </div>
          {ledgerQ.isLoading && <p className="text-muted-foreground text-sm">جارٍ التحميل…</p>}
          <div className="space-y-2">
            {ledgerQ.data?.entries.map((e) => {
              const pts = Math.abs(Math.floor(e.microPoints / 1_000_000));
              const isCredit = e.microPoints > 0;
              return (
                <div key={e.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">{e.reason ?? e.transactionType}</p>
                    <p className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString("ar")}</p>
                  </div>
                  <span className={`font-bold ${isCredit ? "text-green-600" : "text-red-600"}`}>
                    {isCredit ? "+" : "-"}{pts.toLocaleString("ar")} نقطة
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── تعديل إداري ───────────────────────────── */}
      {activeTab === "adjust" && (
        <div className="rounded-xl border border-border bg-card p-5 max-w-md">
          <h3 className="font-semibold mb-4">إضافة نقاط إدارياً</h3>
          <p className="text-sm text-muted-foreground mb-4">موجب فقط — الخصم متاح في مرحلة لاحقة.</p>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Workspace ID</label>
              <input
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder="UUID"
                value={adjustWsId}
                onChange={(e) => setAdjustWsId(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">عدد النقاط (موجب)</label>
              <input
                type="number"
                min="1"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder="مثال: 1000"
                value={adjustPoints}
                onChange={(e) => setAdjustPoints(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">سبب التعديل (إلزامي)</label>
              <textarea
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                rows={2}
                placeholder="مثال: تعويض بسبب خطأ تقني في الفوترة"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
              />
            </div>
          </div>
          <button
            onClick={() => adjust.mutate()}
            disabled={adjust.isPending || !adjustWsId || !adjustPoints || Number(adjustPoints) <= 0 || adjustReason.trim().length < 5}
            className="mt-4 w-full rounded-lg bg-primary py-2.5 text-primary-foreground font-medium disabled:opacity-60"
          >
            {adjust.isPending ? "جارٍ التعديل…" : "تأكيد الإضافة"}
          </button>
        </div>
      )}
    </div>
  );
}
