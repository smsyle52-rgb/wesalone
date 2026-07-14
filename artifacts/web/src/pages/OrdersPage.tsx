import { useEffect, useState } from "react";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatCurrency, statusLabels, orderChannelLabels, methodLabels } from "@/lib/utils";
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

const STATUSES = ["", "new", "confirmed", "processing", "ready", "delivered", "returned", "cancelled"];

const ORDER_NEXT: Record<string, Array<{ status: string; label: string; danger?: boolean }>> = {
  new: [{ status: "confirmed", label: "تأكيد الطلب" }, { status: "cancelled", label: "إلغاء", danger: true }],
  confirmed: [{ status: "processing", label: "بدء المعالجة" }, { status: "cancelled", label: "إلغاء", danger: true }],
  processing: [{ status: "ready", label: "جاهز للتسليم" }, { status: "cancelled", label: "إلغاء", danger: true }],
  ready: [{ status: "delivered", label: "تأكيد التسليم" }, { status: "cancelled", label: "إلغاء", danger: true }],
  delivered: [{ status: "returned", label: "إرجاع الطلب", danger: true }],
  returned: [],
  cancelled: [],
};

const NEEDS_REASON = (currentStatus: string, nextStatus: string) =>
  (nextStatus === "cancelled" && currentStatus !== "new") || nextStatus === "returned";

// التوصيل (النطاق 11)
const DELIVERY_TYPE_LABELS: Record<string, string> = {
  pickup: "استلام من المحل", local: "توصيل داخل المدينة", shipping: "شحن خارج المدينة",
};
const DELIVERY_TYPE_ICONS: Record<string, string> = { pickup: "🏪", local: "🛵", shipping: "📦" };
const DELIVERY_STATUS_LABELS: Record<string, string> = {
  preparing: "قيد التجهيز", ready: "جاهز", out_for_delivery: "خرج للتوصيل",
  handed_to_carrier: "سُلّم للمكتب", delivered: "تم التسليم",
};
// تدفّق حالة التوصيل حسب نوع التسليم — لا قفزات خلفية
const DELIVERY_FLOW: Record<string, string[]> = {
  local: ["preparing", "ready", "out_for_delivery", "delivered"],
  shipping: ["preparing", "ready", "handed_to_carrier", "delivered"],
};

function PermissionDenied() {
  return (
    <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm text-center">
      🔒 ليس لديك صلاحية لتنفيذ هذا الإجراء
    </div>
  );
}

function paymentStatusBadge(pStatus: string) {
  const cfg: Record<string, { label: string; cls: string }> = {
    unpaid: { label: "غير مدفوع", cls: "bg-red-50 text-red-600 border-red-200" },
    partial: { label: "جزئي", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    paid:    { label: "مدفوع",    cls: "bg-green-50 text-green-700 border-green-200" },
  };
  const c = cfg[pStatus] ?? cfg.unpaid;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${c.cls}`}>{c.label}</span>
  );
}

function computeOrderPaymentStatus(total: string | number, paid: string | number): "unpaid" | "partial" | "paid" {
  const t = Number(total ?? 0);
  const p = Number(paid ?? 0);
  if (p <= 0) return "unpaid";
  if (p >= t) return "paid";
  return "partial";
}

const emptyCreateForm = { contactId: "", channel: "manual", currency: "YER", notes: "", deliveryType: "pickup", deliveryFee: "0", codEnabled: false };
const emptyItemForm = { name: "", description: "", quantity: "1", unitPrice: "0", currency: "YER" };
const emptyPayForm = { amount: "", currency: "YER", paymentMethodId: "", reference: "", notes: "" };
const emptyEditForm = {
  channel: "manual", discount: "0", notes: "", deliveryType: "pickup", deliveryFee: "0", codEnabled: false,
  deliveryAgentPhone: "", carrierName: "", carrierPhone: "", deliveryReceiptUrl: "", deliveryAddress: "",
};

export default function OrdersPage() {
  const { hasPermission } = useAuth();
  const qc = useQueryClient();

  const canRead = hasPermission("orders:read");
  const canCreate = hasPermission("orders:create");
  const canUpdate = hasPermission("orders:update");
  const canDelete = hasPermission("orders:delete");
  const canCancel = hasPermission("orders:cancel");
  const canCreatePayment = hasPermission("payments:create");

  const [statusFilter, setStatusFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [search, setSearch] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<"view" | "edit">("view");
  const [editForm, setEditForm] = useState(emptyEditForm);

  const [showItemForm, setShowItemForm] = useState(false);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState(emptyItemForm);
  const [inventorySearch, setInventorySearch] = useState("");
  const [showInventoryPicker, setShowInventoryPicker] = useState(false);

  const [pendingStatus, setPendingStatus] = useState<{ status: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [returnedReason, setReturnedReason] = useState("");

  const [showPayModal, setShowPayModal] = useState(false);
  const [payForm, setPayForm] = useState(emptyPayForm);

  // ── Queries ─────────────────────────────────────────────────────
  const params = new URLSearchParams();
  if (statusFilter) params.set("status", statusFilter);
  if (channelFilter) params.set("channel", channelFilter);
  if (search) params.set("search", search);
  params.set("limit", "50");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["orders", statusFilter, channelFilter, search],
    queryFn: () => apiFetch(`orders?${params}`),
    enabled: canRead,
  });

  const { data: contacts } = useQuery({
    queryKey: ["contacts-mini"],
    queryFn: () => apiFetch("contacts?limit=200"),
    enabled: canRead,
  });

  const { data: detailData, refetch: refetchDetail } = useQuery({
    queryKey: ["order-detail", selectedOrderId],
    queryFn: () => apiFetch(`orders/${selectedOrderId}`),
    enabled: !!selectedOrderId,
  });

  const { data: payMethodsData } = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => apiFetch("payment-methods"),
    enabled: showPayModal,
  });

  const { data: orderPayments } = useQuery({
    queryKey: ["order-payments", selectedOrderId],
    queryFn: () => apiFetch(`payments?orderId=${selectedOrderId}&limit=20`),
    enabled: !!selectedOrderId && hasPermission("payments:read"),
  });

  const { data: inventoryData } = useQuery({
    queryKey: ["inventory-picker", inventorySearch],
    queryFn: () => apiFetch(`products?${inventorySearch ? `search=${encodeURIComponent(inventorySearch)}` : ""}`),
    enabled: showInventoryPicker && hasPermission("products:read"),
    staleTime: 60_000,
  });

  const orders: any[] = data?.orders ?? [];
  const counts: Record<string, number> = data?.counts ?? {};
  const selectedOrder = detailData?.order ?? null;
  // عند فتح وضع التعديل، نملأ النموذج من بيانات الطلب الحالية
  useEffect(() => {
    if (detailMode === "edit" && selectedOrder) {
      setEditForm({
        channel: selectedOrder.channel ?? "manual",
        discount: String(selectedOrder.discount ?? "0"),
        notes: selectedOrder.notes ?? "",
        deliveryType: selectedOrder.deliveryType ?? "pickup",
        deliveryFee: String(selectedOrder.deliveryFee ?? "0"),
        codEnabled: !!selectedOrder.codEnabled,
        deliveryAgentPhone: selectedOrder.deliveryAgentPhone ?? "",
        carrierName: selectedOrder.carrierName ?? "",
        carrierPhone: selectedOrder.carrierPhone ?? "",
        deliveryReceiptUrl: selectedOrder.deliveryReceiptUrl ?? "",
        deliveryAddress: selectedOrder.deliveryAddress ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailMode, selectedOrder?.id]);
  const items: any[] = detailData?.items ?? [];
  const payMethods: any[] = payMethodsData?.methods ?? [];
  const orderPaymentsList: any[] = orderPayments?.payments ?? [];

  // ── Mutations ────────────────────────────────────────────────────
  const createOrder = useMutation({
    mutationFn: (body: any) => apiFetch("orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setShowCreate(false);
      setCreateForm(emptyCreateForm);
    },
  });

  const changeStatus = useMutation({
    mutationFn: ({ orderId, status, cancelReason, returnedReason }: any) =>
      apiFetch(`orders/${orderId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, cancelReason, returnedReason }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["order-detail", selectedOrderId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setPendingStatus(null);
      setCancelReason("");
      setReturnedReason("");
    },
  });

  const deleteOrder = useMutation({
    mutationFn: (id: string) => apiFetch(`orders/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setSelectedOrderId(null);
    },
  });

  const updateOrder = useMutation({
    mutationFn: (body: any) => apiFetch(`orders/${selectedOrderId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      refetchDetail();
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setDetailMode("view");
    },
  });

  const changeDeliveryStatus = useMutation({
    mutationFn: (deliveryStatus: string) =>
      apiFetch(`orders/${selectedOrderId}/delivery-status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deliveryStatus }) }),
    onSuccess: () => {
      refetchDetail();
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const addItem = useMutation({
    mutationFn: (body: any) => apiFetch(`orders/${selectedOrderId}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      refetchDetail();
      qc.invalidateQueries({ queryKey: ["orders"] });
      setShowItemForm(false);
      setEditItemId(null);
      setItemForm(emptyItemForm);
    },
  });

  const updateItem = useMutation({
    mutationFn: ({ itemId, body }: any) => apiFetch(`orders/${selectedOrderId}/items/${itemId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      refetchDetail();
      qc.invalidateQueries({ queryKey: ["orders"] });
      setShowItemForm(false);
      setEditItemId(null);
      setItemForm(emptyItemForm);
    },
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => apiFetch(`orders/${selectedOrderId}/items/${itemId}`, { method: "DELETE" }),
    onSuccess: () => {
      refetchDetail();
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const createPayment = useMutation({
    mutationFn: (body: any) => apiFetch("payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order-payments", selectedOrderId] });
      qc.invalidateQueries({ queryKey: ["order-detail", selectedOrderId] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setShowPayModal(false);
      setPayForm(emptyPayForm);
    },
  });

  // ── Helpers ──────────────────────────────────────────────────────
  function openEditItem(item: any) {
    setEditItemId(item.id);
    setItemForm({ name: item.name, description: item.description ?? "", quantity: String(item.quantity), unitPrice: String(item.unitPrice), currency: item.currency });
    setShowItemForm(true);
  }

  function handleItemSave() {
    const body = { name: itemForm.name, description: itemForm.description || undefined, quantity: Number(itemForm.quantity), unitPrice: Number(itemForm.unitPrice), currency: itemForm.currency };
    if (editItemId) {
      updateItem.mutate({ itemId: editItemId, body });
    } else {
      addItem.mutate(body);
    }
  }

  function handleEditSave() {
    const isPickup = editForm.deliveryType === "pickup";
    // نرسل حقول التوصيل المناسبة فقط؛ غير المعنيّة null لتنظيف القيم القديمة عند تغيير النوع
    updateOrder.mutate({
      channel: editForm.channel,
      discount: Number(editForm.discount) || 0,
      notes: editForm.notes || null,
      deliveryType: editForm.deliveryType,
      deliveryFee: Number(editForm.deliveryFee) || 0,
      codEnabled: editForm.codEnabled,
      deliveryAgentPhone: editForm.deliveryType === "local" ? (editForm.deliveryAgentPhone || null) : null,
      carrierName: editForm.deliveryType === "shipping" ? (editForm.carrierName || null) : null,
      carrierPhone: editForm.deliveryType === "shipping" ? (editForm.carrierPhone || null) : null,
      deliveryReceiptUrl: editForm.deliveryType === "shipping" ? (editForm.deliveryReceiptUrl || null) : null,
      deliveryAddress: isPickup ? null : (editForm.deliveryAddress || null),
    });
  }

  function handleStatusClick(next: { status: string; danger?: boolean }) {
    if (!selectedOrder) return;
    if (NEEDS_REASON(selectedOrder.status, next.status)) {
      setPendingStatus({ status: next.status });
    } else {
      changeStatus.mutate({ orderId: selectedOrder.id, status: next.status });
    }
  }

  function confirmStatusWithReason() {
    if (!selectedOrder || !pendingStatus) return;
    changeStatus.mutate({
      orderId: selectedOrder.id,
      status: pendingStatus.status,
      cancelReason: pendingStatus.status === "cancelled" ? cancelReason : undefined,
      returnedReason: pendingStatus.status === "returned" ? returnedReason : undefined,
    });
  }

  function handlePaySubmit() {
    if (!selectedOrder || !payForm.amount || !payForm.paymentMethodId) return;
    createPayment.mutate({
      orderId: selectedOrder.id,
      contactId: selectedOrder.contactId ?? undefined,
      paymentMethodId: payForm.paymentMethodId,
      amount: Number(payForm.amount),
      currency: payForm.currency,
      reference: payForm.reference || undefined,
      notes: payForm.notes || undefined,
    });
  }

  // ── Table columns ─────────────────────────────────────────────────
  const columns = [
    { key: "orderNumber", label: "رقم الطلب", render: (r: any) => <span className="font-mono text-xs font-semibold text-primary">{r.orderNumber}</span> },
    { key: "contactName", label: "العميل", render: (r: any) => <span className="text-sm text-foreground">{r.contactName ?? "—"}</span> },
    { key: "channel", label: "القناة", render: (r: any) => <span className="text-xs text-muted-foreground">{orderChannelLabels[r.channel] ?? r.channel}</span> },
    { key: "totalAmount", label: "الإجمالي", render: (r: any) => <span className="font-semibold text-sm">{formatCurrency(r.totalAmount ?? 0, r.currency)}</span> },
    { key: "delivery", label: "التوصيل", render: (r: any) => (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground whitespace-nowrap">{DELIVERY_TYPE_ICONS[r.deliveryType] ?? ""} {DELIVERY_TYPE_LABELS[r.deliveryType] ?? "—"}</span>
        {r.deliveryStatus && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 w-fit">{DELIVERY_STATUS_LABELS[r.deliveryStatus]}</span>}
      </div>
    )},
    { key: "payStatus", label: "الدفع", render: (r: any) => (
      <div className="flex flex-col gap-0.5">
        {paymentStatusBadge(computeOrderPaymentStatus(r.totalAmount, r.paidAmount))}
        {r.codEnabled && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 w-fit">عند الاستلام</span>}
      </div>
    )},
    { key: "status", label: "الحالة", render: (r: any) => <StatusBadge status={r.status} /> },
    { key: "createdAt", label: "التاريخ", render: (r: any) => <span className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</span> },
    { key: "actions", label: "", render: (r: any) => (
      <div className="flex gap-1.5">
        <button onClick={() => { setSelectedOrderId(r.id); setDetailMode("view"); }}
          className="text-xs px-2 py-1 bg-muted hover:bg-muted/70 rounded text-muted-foreground transition-colors inline-flex items-center gap-1">
          👁 تفاصيل
        </button>
        {canUpdate && !["cancelled", "returned"].includes(r.status) && (
          <button onClick={() => { setSelectedOrderId(r.id); setDetailMode("edit"); }}
            className="text-xs px-2 py-1 bg-primary/10 hover:bg-primary/20 rounded text-primary transition-colors inline-flex items-center gap-1">
            ✏️ تعديل
          </button>
        )}
      </div>
    )},
  ];

  const nextActions = selectedOrder ? (ORDER_NEXT[selectedOrder.status] ?? []) : [];
  const isTerminal = selectedOrder && ["cancelled", "returned"].includes(selectedOrder.status);
  const itemSaveLoading = addItem.isPending || updateItem.isPending;

  const totalPaid = Number(selectedOrder?.paidAmount ?? 0);
  const totalAmount = Number(selectedOrder?.totalAmount ?? 0);
  const remaining = Math.max(0, totalAmount - totalPaid);
  const orderPayStatus = selectedOrder ? computeOrderPaymentStatus(selectedOrder.totalAmount, selectedOrder.paidAmount) : "unpaid";

  return (
    <div dir="rtl">
      <PageHeader
        title="الطلبات"
        subtitle="إدارة طلبات العملاء ومتابعة مراحل التنفيذ"
        actions={
          canCreate ? (
            <button onClick={() => setShowCreate(true)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
              + طلب جديد
            </button>
          ) : (
            <button disabled className="px-4 py-2 rounded-lg bg-primary/40 text-primary-foreground text-sm font-semibold cursor-not-allowed opacity-50">
              + طلب جديد
            </button>
          )
        }
      />

      {!canRead ? <PermissionDenied /> : (
        <>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 w-full sm:w-48"
              placeholder="بحث برقم الطلب..." />
            <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="">كل القنوات</option>
              {Object.entries(orderChannelLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3">
            {STATUSES.map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                {s === "" ? "الكل" : statusLabels[s] ?? s}
                {s && counts[s] ? ` (${counts[s]})` : ""}
                {s === "" && Object.values(counts).reduce((a, b) => a + b, 0) ? ` (${Object.values(counts).reduce((a, b) => a + b, 0)})` : ""}
              </button>
            ))}
          </div>
          {isError && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm flex items-center justify-between">
              <span>تعذّر تحميل الطلبات</span>
              <button onClick={() => refetch()} className="text-xs underline">إعادة المحاولة</button>
            </div>
          )}
          <DataTable columns={columns} data={orders} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="لا توجد طلبات" />
        </>
      )}

      {/* ── Create Order Modal ──────────────────────────────────── */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); setCreateForm(emptyCreateForm); }} title="طلب جديد">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">العميل</label>
            <select value={createForm.contactId} onChange={(e) => setCreateForm({ ...createForm, contactId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="">بدون عميل</option>
              {contacts?.contacts?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">القناة</label>
              <select value={createForm.channel} onChange={(e) => setCreateForm({ ...createForm, channel: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                {Object.entries(orderChannelLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">العملة</label>
              <select value={createForm.currency} onChange={(e) => setCreateForm({ ...createForm, currency: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="YER">ريال يمني</option>
                <option value="SAR">ريال سعودي</option>
                <option value="USD">دولار</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">نوع التسليم</label>
              <select value={createForm.deliveryType} onChange={(e) => setCreateForm({ ...createForm, deliveryType: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="pickup">🏪 استلام من المحل</option>
                <option value="local">🛵 توصيل داخل المدينة</option>
                <option value="shipping">📦 شحن خارج المدينة</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">رسوم التوصيل</label>
              <input type="number" value={createForm.deliveryFee} onChange={(e) => setCreateForm({ ...createForm, deliveryFee: e.target.value })}
                disabled={createForm.deliveryType === "pickup"}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50" dir="ltr" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={createForm.codEnabled} onChange={(e) => setCreateForm({ ...createForm, codEnabled: e.target.checked })} />
            <span>الدفع عند الاستلام</span>
          </label>
          <div>
            <label className="block text-sm font-medium mb-1">ملاحظات</label>
            <textarea value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              rows={2} placeholder="تفاصيل الطلب..." />
          </div>
          {createOrder.isError && (
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">
              {(createOrder.error as Error)?.message}
            </div>
          )}
          <button
            onClick={() => createOrder.mutate({
              contactId: createForm.contactId || undefined,
              channel: createForm.channel,
              currency: createForm.currency,
              notes: createForm.notes || undefined,
              deliveryType: createForm.deliveryType,
              deliveryFee: createForm.deliveryType === "pickup" ? 0 : (Number(createForm.deliveryFee) || 0),
              codEnabled: createForm.codEnabled,
            })}
            disabled={createOrder.isPending}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {createOrder.isPending ? "جار الإنشاء..." : "إنشاء الطلب"}
          </button>
        </div>
      </Modal>

      {/* ── Order Detail / Edit Modal ────────────────────────────── */}
      <Modal
        open={!!selectedOrderId}
        onClose={() => { setSelectedOrderId(null); setDetailMode("view"); setPendingStatus(null); setShowItemForm(false); setShowPayModal(false); }}
        title={selectedOrder ? `${detailMode === "edit" ? "تعديل" : "طلب"} ${selectedOrder.orderNumber}` : "تفاصيل الطلب"}>
        {selectedOrder && detailMode === "edit" && (
          <OrderEditForm
            form={editForm} setForm={setEditForm}
            onSave={handleEditSave} onCancel={() => setDetailMode("view")}
            isSaving={updateOrder.isPending} error={(updateOrder.error as Error | null)?.message}
            currency={selectedOrder.currency}
          />
        )}
        {selectedOrder && detailMode === "view" && (
          <div className="space-y-4">
            {canUpdate && !isTerminal && (
              <button onClick={() => setDetailMode("edit")}
                className="w-full py-2 rounded-lg border border-primary/30 bg-primary/5 text-primary text-sm font-medium hover:bg-primary/10 transition-colors inline-flex items-center justify-center gap-1.5">
                ✏️ تعديل بيانات الطلب والتوصيل
              </button>
            )}
            {/* Order Info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">الحالة</span>
                <StatusBadge status={selectedOrder.status} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">العميل</span>
                <span className="font-medium">{selectedOrder.contactName ?? "—"}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">القناة</span>
                <span>{orderChannelLabels[selectedOrder.channel] ?? selectedOrder.channel}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">العملة</span>
                <span>{selectedOrder.currency}</span>
              </div>
              {selectedOrder.notes && (
                <div className="col-span-2 flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">ملاحظات</span>
                  <span className="text-sm text-muted-foreground">{selectedOrder.notes}</span>
                </div>
              )}
              {selectedOrder.cancelReason && (
                <div className="col-span-2 p-2 bg-destructive/10 rounded-lg">
                  <span className="text-xs text-destructive">سبب الإلغاء: {selectedOrder.cancelReason}</span>
                </div>
              )}
              {selectedOrder.returnedReason && (
                <div className="col-span-2 p-2 bg-orange-50 border border-orange-200 rounded-lg">
                  <span className="text-xs text-orange-700">سبب الإرجاع: {selectedOrder.returnedReason}</span>
                </div>
              )}
            </div>

            {/* Payment Summary */}
            <div className="bg-muted/30 border border-border rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">ملخص الدفع</span>
                {paymentStatusBadge(orderPayStatus)}
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm mt-1">
                <div>
                  <p className="text-xs text-muted-foreground">الإجمالي</p>
                  <p className="font-bold text-foreground">{formatCurrency(totalAmount, selectedOrder.currency)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">المدفوع</p>
                  <p className="font-bold text-green-700">{formatCurrency(totalPaid, selectedOrder.currency)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">المتبقي</p>
                  <p className={`font-bold ${remaining > 0 ? "text-red-600" : "text-green-700"}`}>
                    {formatCurrency(remaining, selectedOrder.currency)}
                  </p>
                </div>
              </div>
              {selectedOrder.codEnabled && (
                <div className="flex items-center gap-1.5 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1 mt-1">
                  💵 الدفع عند الاستلام — يُحصّل المتبقي ({formatCurrency(remaining, selectedOrder.currency)}) عند تسليم الطلب
                </div>
              )}
            </div>

            {/* Delivery Panel (view) */}
            {selectedOrder.deliveryType && selectedOrder.deliveryType !== "pickup" && (
              <div className="border border-border rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">التوصيل</span>
                  <span className="text-xs font-medium">{DELIVERY_TYPE_ICONS[selectedOrder.deliveryType]} {DELIVERY_TYPE_LABELS[selectedOrder.deliveryType]}</span>
                </div>
                {selectedOrder.deliveryType === "local" && selectedOrder.deliveryAgentPhone && (
                  <div className="text-sm flex justify-between"><span className="text-muted-foreground">مندوب التوصيل</span><span dir="ltr">{selectedOrder.deliveryAgentPhone}</span></div>
                )}
                {selectedOrder.deliveryType === "shipping" && (
                  <>
                    {selectedOrder.carrierName && <div className="text-sm flex justify-between"><span className="text-muted-foreground">مكتب النقل</span><span>{selectedOrder.carrierName}</span></div>}
                    {selectedOrder.carrierPhone && <div className="text-sm flex justify-between"><span className="text-muted-foreground">رقم المكتب</span><span dir="ltr">{selectedOrder.carrierPhone}</span></div>}
                    {selectedOrder.deliveryReceiptUrl && (
                      <a href={selectedOrder.deliveryReceiptUrl} target="_blank" rel="noreferrer" className="text-sm text-primary underline inline-flex items-center gap-1">📄 عرض سند الشحن</a>
                    )}
                  </>
                )}
                {selectedOrder.deliveryAddress && <div className="text-sm flex justify-between gap-2"><span className="text-muted-foreground shrink-0">العنوان</span><span className="text-left">{selectedOrder.deliveryAddress}</span></div>}
                {Number(selectedOrder.deliveryFee) > 0 && <div className="text-sm flex justify-between"><span className="text-muted-foreground">رسوم التوصيل</span><span>{formatCurrency(selectedOrder.deliveryFee, selectedOrder.currency)}</span></div>}

                {selectedOrder.deliveryStatus && (
                  <div className="pt-2 border-t border-border">
                    <div className="flex items-center gap-1.5 flex-wrap mb-2">
                      {(DELIVERY_FLOW[selectedOrder.deliveryType] ?? []).map((st) => {
                        const flow = DELIVERY_FLOW[selectedOrder.deliveryType] ?? [];
                        const done = flow.indexOf(st) <= flow.indexOf(selectedOrder.deliveryStatus);
                        return <span key={st} className={`text-[10px] px-2 py-0.5 rounded-full border ${done ? "bg-green-50 text-green-700 border-green-200" : "bg-muted text-muted-foreground border-border"}`}>{DELIVERY_STATUS_LABELS[st]}</span>;
                      })}
                    </div>
                    {canUpdate && !isTerminal && (() => {
                      const flow = DELIVERY_FLOW[selectedOrder.deliveryType] ?? [];
                      const next = flow[flow.indexOf(selectedOrder.deliveryStatus) + 1];
                      return next ? (
                        <button onClick={() => changeDeliveryStatus.mutate(next)} disabled={changeDeliveryStatus.isPending}
                          className="text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 disabled:opacity-50">
                          {changeDeliveryStatus.isPending ? "جار التحديث..." : `← ${DELIVERY_STATUS_LABELS[next]}`}
                        </button>
                      ) : null;
                    })()}
                    {changeDeliveryStatus.isError && <p className="text-xs text-destructive mt-1">{(changeDeliveryStatus.error as Error)?.message}</p>}
                  </div>
                )}
              </div>
            )}

            {/* Status Actions */}
            {!isTerminal && nextActions.length > 0 && canUpdate && !pendingStatus && (
              <div className="border-t border-border pt-3">
                <p className="text-xs text-muted-foreground mb-2 font-medium">تغيير الحالة:</p>
                <div className="flex flex-wrap gap-2">
                  {nextActions.map((a) => (
                    <button key={a.status} onClick={() => handleStatusClick(a)}
                      disabled={changeStatus.isPending || (a.status === "cancelled" && !canCancel)}
                      title={a.status === "cancelled" && !canCancel ? "ليس لديك صلاحية إلغاء الطلبات" : ""}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${a.danger ? "bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30" : "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30"}`}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Reason Input */}
            {pendingStatus && (
              <div className="border border-destructive/30 rounded-xl p-3 space-y-2 bg-destructive/5">
                <p className="text-sm font-medium text-destructive">
                  {pendingStatus.status === "cancelled" ? "سبب الإلغاء *" : "سبب الإرجاع *"}
                </p>
                <textarea
                  value={pendingStatus.status === "cancelled" ? cancelReason : returnedReason}
                  onChange={(e) => pendingStatus.status === "cancelled" ? setCancelReason(e.target.value) : setReturnedReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-destructive/30 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-destructive/30 resize-none"
                  rows={2}
                  placeholder={pendingStatus.status === "cancelled" ? "سبب الإلغاء..." : "سبب الإرجاع..."} />
                {changeStatus.isError && (
                  <p className="text-xs text-destructive">{(changeStatus.error as Error)?.message}</p>
                )}
                <div className="flex gap-2">
                  <button onClick={confirmStatusWithReason}
                    disabled={changeStatus.isPending || (pendingStatus.status === "cancelled" ? !cancelReason.trim() : !returnedReason.trim())}
                    className="flex-1 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50">
                    {changeStatus.isPending ? "جار التحديث..." : "تأكيد"}
                  </button>
                  <button onClick={() => { setPendingStatus(null); setCancelReason(""); setReturnedReason(""); }}
                    className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted">
                    إلغاء
                  </button>
                </div>
              </div>
            )}

            {/* Items */}
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">البنود ({items.length})</p>
                {!isTerminal && canUpdate && !showItemForm && (
                  <button onClick={() => { setEditItemId(null); setItemForm(emptyItemForm); setShowItemForm(true); }}
                    className="text-xs px-2 py-1 bg-primary/10 text-primary hover:bg-primary/20 rounded transition-colors">
                    + إضافة بند
                  </button>
                )}
              </div>

              {showItemForm && (
                <div className="mb-3 p-3 bg-muted/30 rounded-xl border border-border space-y-2">
                  {/* منتخب المخزون */}
                  {!editItemId && hasPermission("products:read") && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => { setShowInventoryPicker(!showInventoryPicker); setInventorySearch(""); }}
                        className="w-full text-xs text-right px-2 py-1.5 rounded-lg border border-dashed border-primary/40 text-primary hover:bg-primary/5 transition-colors"
                      >
                        📦 اختر من المخزون (اختياري)
                      </button>
                      {showInventoryPicker && (
                        <div className="absolute z-20 mt-1 w-full bg-background border border-border rounded-xl shadow-lg p-2 space-y-1.5 max-h-56 overflow-y-auto">
                          <input
                            autoFocus
                            type="search"
                            value={inventorySearch}
                            onChange={(e) => setInventorySearch(e.target.value)}
                            placeholder="ابحث عن منتج..."
                            className="w-full px-2 py-1.5 text-xs rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                          {(inventoryData?.products ?? []).length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-2">لا توجد منتجات</p>
                          ) : (
                            (inventoryData?.products ?? []).map((p: any) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                  setItemForm({ ...itemForm, name: p.name, unitPrice: p.price, description: p.description ?? "", currency: p.currency });
                                  setShowInventoryPicker(false);
                                }}
                                className="w-full text-right px-2 py-1.5 hover:bg-muted rounded-lg text-xs flex justify-between items-center gap-2"
                              >
                                <span className="font-medium truncate">{p.name}</span>
                                <span className="text-muted-foreground shrink-0">{Number(p.price).toLocaleString()} {p.currency}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium mb-1">اسم البند *</label>
                      <input value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                        className="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="مثل: خدمة تصميم شعار" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">الكمية *</label>
                      <input type="number" min="1" value={itemForm.quantity} onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })}
                        className="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">سعر الوحدة *</label>
                      <input type="number" value={itemForm.unitPrice} onChange={(e) => setItemForm({ ...itemForm, unitPrice: e.target.value })}
                        className="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium mb-1">وصف اختياري</label>
                      <input value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                        className="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="وصف مختصر..." />
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    الإجمالي: {formatCurrency(Number(itemForm.quantity) * Number(itemForm.unitPrice), selectedOrder.currency)}
                  </div>
                  {(addItem.isError || updateItem.isError) && (
                    <p className="text-xs text-destructive">{(addItem.error as Error | null)?.message ?? (updateItem.error as Error | null)?.message}</p>
                  )}
                  <div className="flex gap-2">
                    <button onClick={handleItemSave} disabled={itemSaveLoading || !itemForm.name.trim() || Number(itemForm.quantity) < 1 || Number(itemForm.unitPrice) < 0 || itemForm.unitPrice === ""}
                      className="flex-1 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50">
                      {itemSaveLoading ? "جار الحفظ..." : editItemId ? "تحديث البند" : "إضافة البند"}
                    </button>
                    <button onClick={() => { setShowItemForm(false); setEditItemId(null); setItemForm(emptyItemForm); }}
                      className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted">
                      إلغاء
                    </button>
                  </div>
                </div>
              )}

              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">لا توجد بنود بعد</p>
              ) : (
                <div className="space-y-2">
                  {items.map((item: any) => (
                    <div key={item.id} className="flex items-start justify-between gap-2 p-2 rounded-lg bg-muted/30 border border-border">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{item.name}</p>
                        {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {item.quantity} × {formatCurrency(item.unitPrice, item.currency)} = <span className="font-semibold text-foreground">{formatCurrency(item.total, item.currency)}</span>
                        </p>
                      </div>
                      {!isTerminal && canUpdate && (
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => openEditItem(item)} className="text-xs px-1.5 py-0.5 bg-muted hover:bg-muted/80 rounded text-muted-foreground">تعديل</button>
                          <button onClick={async () => { if (await confirmDialog(`حذف "${item.name}"؟`)) deleteItem.mutate(item.id); }}
                            disabled={deleteItem.isPending}
                            className="text-xs px-1.5 py-0.5 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded">حذف</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {items.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border space-y-1 text-sm">
                  {Number(selectedOrder.discount) > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>الخصم</span>
                      <span>- {formatCurrency(selectedOrder.discount, selectedOrder.currency)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-base">
                    <span>الإجمالي</span>
                    <span className="text-primary">{formatCurrency(selectedOrder.totalAmount ?? 0, selectedOrder.currency)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Payments list for this order */}
            {hasPermission("payments:read") && orderPaymentsList.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="text-xs font-semibold text-muted-foreground mb-2">الدفعات ({orderPaymentsList.length})</p>
                <div className="space-y-1.5">
                  {orderPaymentsList.map((p: any) => {
                    const label = (p.methodSnapshot as any)?.labelAr ?? methodLabels[p.method] ?? p.method;
                    return (
                      <div key={p.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-muted/20 border border-border">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{formatCurrency(p.amount, p.currency)}</span>
                          <span className="text-muted-foreground">{label}</span>
                          {p.reference && <span className="text-muted-foreground" dir="ltr">#{p.reference}</span>}
                        </div>
                        <StatusBadge status={p.status} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Register Payment Button */}
            <div className="border-t border-border pt-3">
              {canCreatePayment && !isTerminal ? (
                <button
                  onClick={() => { setPayForm({ ...emptyPayForm, currency: selectedOrder.currency }); setShowPayModal(true); }}
                  className="w-full py-2 rounded-lg border border-primary/30 bg-primary/5 text-primary text-sm font-medium hover:bg-primary/10 transition-colors flex items-center justify-center gap-2">
                  💰 تسجيل دفعة
                </button>
              ) : (
                <button disabled
                  className="w-full py-2 rounded-lg border border-dashed border-border text-muted-foreground text-sm cursor-not-allowed opacity-60 flex items-center justify-center gap-2">
                  💰 {!canCreatePayment ? "ليس لديك صلاحية تسجيل الدفعات" : "الطلب مغلق"}
                </button>
              )}
            </div>

            {/* Danger zone */}
            {canDelete && (selectedOrder.status === "new" || selectedOrder.status === "cancelled") && (
              <div className="border-t border-border pt-3">
                <button onClick={async () => { if (await confirmDialog(`حذف الطلب ${selectedOrder.orderNumber}؟ لا يمكن التراجع.`)) deleteOrder.mutate(selectedOrder.id); }}
                  disabled={deleteOrder.isPending}
                  className="w-full py-2 rounded-lg bg-destructive/10 text-destructive text-xs hover:bg-destructive/20 transition-colors disabled:opacity-50">
                  {deleteOrder.isPending ? "جار الحذف..." : "حذف الطلب"}
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Payment Modal ─────────────────────────────────────────── */}
      <Modal open={showPayModal} onClose={() => { setShowPayModal(false); setPayForm(emptyPayForm); }} title={`تسجيل دفعة — ${selectedOrder?.orderNumber ?? ""}`} size="sm">
        <div className="space-y-3">
          <div className="bg-muted/30 rounded-lg p-2.5 text-xs text-muted-foreground">
            المتبقي: <span className="font-bold text-foreground">{formatCurrency(remaining, selectedOrder?.currency ?? "YER")}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">المبلغ *</label>
              <input type="number" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="0" dir="ltr" max={remaining} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">العملة</label>
              <div className="px-3 py-2 rounded-lg border border-input bg-muted/40 text-sm text-muted-foreground">
                {selectedOrder?.currency === "YER" ? "ريال يمني" : selectedOrder?.currency === "SAR" ? "ريال سعودي" : "دولار"}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">طريقة الدفع *</label>
            <div className="grid grid-cols-3 gap-1.5">
              {payMethods.map((m: any) => (
                <button key={m.id} onClick={() => setPayForm({ ...payForm, paymentMethodId: m.id })}
                  className={`py-2 rounded-lg text-xs font-medium border transition-colors ${payForm.paymentMethodId === m.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
                  {m.labelAr}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">رقم الحوالة / المرجع</label>
            <input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="اختياري..." dir="ltr" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">ملاحظات</label>
            <textarea value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              rows={2} placeholder="اختياري..." />
          </div>
          {createPayment.isError && (
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">
              {(createPayment.error as Error)?.message ?? "حدث خطأ"}
            </div>
          )}
          <button onClick={handlePaySubmit}
            disabled={createPayment.isPending || !payForm.amount || !payForm.paymentMethodId}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {createPayment.isPending ? "جار التسجيل..." : "تسجيل الدفعة (قيد الانتظار)"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

type EditFormState = typeof emptyEditForm;

function OrderEditForm({ form, setForm, onSave, onCancel, isSaving, error, currency }: {
  form: EditFormState;
  setForm: (f: EditFormState) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  error?: string;
  currency: string;
}) {
  const isPickup = form.deliveryType === "pickup";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1">القناة</label>
          <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
            {Object.entries(orderChannelLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">الخصم ({currency})</label>
          <input type="number" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1.5">نوع التسليم</label>
        <div className="grid grid-cols-3 gap-2">
          {(["pickup", "local", "shipping"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setForm({ ...form, deliveryType: t })}
              className={`py-2 px-1 rounded-lg text-xs font-medium border transition-colors ${form.deliveryType === t ? "bg-primary/10 text-primary border-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
              {DELIVERY_TYPE_ICONS[t]}<br />{DELIVERY_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {form.deliveryType === "local" && (
        <div>
          <label className="block text-xs font-medium mb-1">رقم مندوب التوصيل</label>
          <input value={form.deliveryAgentPhone} onChange={(e) => setForm({ ...form, deliveryAgentPhone: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" placeholder="77xxxxxxx" />
        </div>
      )}

      {form.deliveryType === "shipping" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">اسم مكتب النقل</label>
              <input value={form.carrierName} onChange={(e) => setForm({ ...form, carrierName: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="مكتب النقل..." />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">رقم المكتب</label>
              <input value={form.carrierPhone} onChange={(e) => setForm({ ...form, carrierPhone: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" placeholder="77xxxxxxx" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">رابط صورة سند الشحن</label>
            <input value={form.deliveryReceiptUrl} onChange={(e) => setForm({ ...form, deliveryReceiptUrl: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" placeholder="https://..." />
            <p className="text-[11px] text-muted-foreground mt-1">الصق رابط صورة السند (من واتساب أو أي رابط https).</p>
            {form.deliveryReceiptUrl && /^https?:\/\//.test(form.deliveryReceiptUrl) && (
              <img src={form.deliveryReceiptUrl} alt="معاينة السند" className="mt-2 max-h-32 rounded-lg border border-border object-contain" />
            )}
          </div>
        </>
      )}

      {!isPickup && (
        <>
          <div>
            <label className="block text-xs font-medium mb-1">عنوان التوصيل</label>
            <input value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="الحي، الشارع، علامة مميزة..." />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">رسوم التوصيل ({currency})</label>
            <input type="number" value={form.deliveryFee} onChange={(e) => setForm({ ...form, deliveryFee: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" />
          </div>
        </>
      )}

      <label className="flex items-center gap-2 text-sm cursor-pointer py-1">
        <input type="checkbox" checked={form.codEnabled} onChange={(e) => setForm({ ...form, codEnabled: e.target.checked })} />
        <span>الدفع عند الاستلام</span>
      </label>

      <div>
        <label className="block text-xs font-medium mb-1">ملاحظات</label>
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" rows={2} placeholder="تفاصيل الطلب..." />
      </div>

      {error && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">{error}</div>}

      <div className="flex gap-2">
        <button onClick={onSave} disabled={isSaving}
          className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
          {isSaving ? "جار الحفظ..." : "حفظ التعديلات"}
        </button>
        <button onClick={onCancel} className="px-4 py-2.5 rounded-lg border border-border text-sm hover:bg-muted">إلغاء</button>
      </div>
    </div>
  );
}
