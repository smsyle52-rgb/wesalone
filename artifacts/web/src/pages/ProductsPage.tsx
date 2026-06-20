import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
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

const DELIVERY_LABELS: Record<string, string> = {
  all: "توصيل لكل مكان",
  local: "داخل المدينة",
  pickup_only: "استلام من المحل",
};
const CURRENCIES = ["YER", "SAR", "USD"] as const;
type Currency = typeof CURRENCIES[number];

interface Product {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  price: string;
  currency: string;
  unit: string | null;
  imageUrl: string | null;
  quantityAvailable: number | null;
  deliveryPolicy: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

const emptyForm = {
  name: "",
  description: "",
  sku: "",
  price: "0",
  currency: "YER" as Currency,
  unit: "",
  imageUrl: "",
  quantityAvailable: "",
  deliveryPolicy: "all",
};

function PermissionDenied() {
  return (
    <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm text-center">
      🔒 ليس لديك صلاحية لتنفيذ هذا الإجراء
    </div>
  );
}

export default function ProductsPage() {
  const { user } = useAuth();
  const perms = new Set(user?.permissions ?? []);
  const canRead   = perms.has("products:read");
  const canCreate = perms.has("products:create");
  const canUpdate = perms.has("products:update");
  const canDelete = perms.has("products:delete");

  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [qtyModal, setQtyModal] = useState<Product | null>(null);
  const [qtyAdj, setQtyAdj] = useState("");
  const [err, setErr] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["products", showArchived, search],
    queryFn: () =>
      apiFetch(`products?archived=${showArchived}${search ? `&search=${encodeURIComponent(search)}` : ""}`),
    enabled: canRead,
  });

  const saveMut = useMutation({
    mutationFn: (payload: typeof emptyForm) => {
      const body = {
        name: payload.name.trim(),
        description: payload.description.trim() || null,
        sku: payload.sku.trim() || null,
        price: Number(payload.price),
        currency: payload.currency,
        unit: payload.unit.trim() || null,
        imageUrl: payload.imageUrl.trim() || null,
        quantityAvailable: payload.quantityAvailable !== "" ? Number(payload.quantityAvailable) : null,
        deliveryPolicy: payload.deliveryPolicy,
      };
      if (editing) {
        return apiFetch(`products/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      }
      return apiFetch("products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); setModalOpen(false); setEditing(null); setErr(""); },
    onError: (e: Error) => setErr(e.message),
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => apiFetch(`products/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
  });

  const qtyMut = useMutation({
    mutationFn: ({ id, adjustment }: { id: string; adjustment: number }) =>
      apiFetch(`products/${id}/quantity`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adjustment }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); setQtyModal(null); setQtyAdj(""); },
    onError: (e: Error) => setErr(e.message),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setErr("");
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? "",
      sku: p.sku ?? "",
      price: p.price,
      currency: (p.currency as Currency) || "YER",
      unit: p.unit ?? "",
      imageUrl: p.imageUrl ?? "",
      quantityAvailable: p.quantityAvailable !== null ? String(p.quantityAvailable) : "",
      deliveryPolicy: p.deliveryPolicy,
    });
    setErr("");
    setModalOpen(true);
  };

  if (!canRead) return <div className="p-8"><PermissionDenied /></div>;

  const products: Product[] = data?.products ?? [];

  const columns = [
    {
      key: "name",
      label: "المنتج",
      render: (p: Product) => (
        <div>
          <div className="font-medium text-gray-900">{p.name}</div>
          {p.sku && <div className="text-xs text-gray-400 mt-0.5">SKU: {p.sku}</div>}
          {p.isArchived && <span className="text-xs text-gray-400">(مؤرشف)</span>}
        </div>
      ),
    },
    {
      key: "price",
      label: "السعر",
      render: (p: Product) => (
        <div className="text-sm font-semibold">
          {Number(p.price).toLocaleString("ar-YE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} {p.currency}
          {p.unit && <span className="text-gray-400 font-normal"> / {p.unit}</span>}
        </div>
      ),
    },
    {
      key: "quantity",
      label: "المخزون",
      render: (p: Product) => (
        <div className="flex items-center gap-2">
          {p.quantityAvailable === null ? (
            <span className="text-xs text-gray-400">غير محدود</span>
          ) : (
            <span className={`text-sm font-semibold ${p.quantityAvailable === 0 ? "text-red-600" : p.quantityAvailable < 5 ? "text-amber-600" : "text-green-700"}`}>
              {p.quantityAvailable}
            </span>
          )}
          {canUpdate && p.quantityAvailable !== null && (
            <button
              onClick={() => { setQtyModal(p); setQtyAdj(""); setErr(""); }}
              className="text-xs text-blue-600 hover:underline"
            >تعديل</button>
          )}
        </div>
      ),
    },
    {
      key: "delivery",
      label: "التوصيل",
      render: (p: Product) => (
        <span className="text-xs text-gray-600">{DELIVERY_LABELS[p.deliveryPolicy] ?? p.deliveryPolicy}</span>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (p: Product) => (
        <div className="flex items-center gap-2 justify-end">
          {canUpdate && !p.isArchived && (
            <button
              onClick={() => openEdit(p)}
              className="text-xs text-blue-600 hover:underline"
            >تعديل</button>
          )}
          {canDelete && !p.isArchived && (
            <button
              onClick={() => { if (confirm(`أرشفة "${p.name}"؟`)) archiveMut.mutate(p.id); }}
              className="text-xs text-red-500 hover:underline"
            >أرشفة</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="المخزون"
        subtitle="إدارة منتجاتك وكمياتها المتاحة"
        actions={
          canCreate ? (
            <button
              onClick={openCreate}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              + منتج جديد
            </button>
          ) : undefined
        }
      />

      {/* شريط البحث والفلاتر */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          placeholder="بحث باسم المنتج..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm w-60 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="rounded"
          />
          عرض المؤرشف
        </label>
        <div className="mr-auto text-sm text-gray-400">
          {products.length} منتج
        </div>
      </div>

      <DataTable
        columns={columns}
        data={products}
        isLoading={isLoading}
        emptyMessage="لا توجد منتجات — أضف أول منتج"
        keyExtractor={(p: Product) => p.id}
      />

      {/* Modal إضافة / تعديل */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        title={editing ? "تعديل المنتج" : "منتج جديد"}
      >
        <div className="space-y-4" dir="rtl">
          {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>}

          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">اسم المنتج *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="مثال: عسل سدر"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">الوصف</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
                placeholder="وصف اختياري للمنتج"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">السعر *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">العملة</label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm(f => ({ ...f, currency: e.target.value as Currency }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">الوحدة</label>
                <input
                  type="text"
                  value={form.unit}
                  onChange={(e) => setForm(f => ({ ...f, unit: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="كيلو / قطعة / علبة"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">SKU / رمز المنتج</label>
                <input
                  type="text"
                  value={form.sku}
                  onChange={(e) => setForm(f => ({ ...f, sku: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="اختياري"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">الكمية المتاحة</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.quantityAvailable}
                onChange={(e) => setForm(f => ({ ...f, quantityAvailable: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="اتركه فارغاً = غير محدود"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">سياسة التوصيل</label>
              <select
                value={form.deliveryPolicy}
                onChange={(e) => setForm(f => ({ ...f, deliveryPolicy: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="all">توصيل لكل مكان</option>
                <option value="local">داخل المدينة فقط</option>
                <option value="pickup_only">استلام من المحل فقط</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">رابط صورة المنتج</label>
              <input
                type="url"
                value={form.imageUrl}
                onChange={(e) => setForm(f => ({ ...f, imageUrl: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="https://..."
                dir="ltr"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => saveMut.mutate(form)}
              disabled={saveMut.isPending || !form.name.trim()}
              className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saveMut.isPending ? "جاري الحفظ..." : editing ? "حفظ التعديلات" : "إضافة المنتج"}
            </button>
            <button
              onClick={() => { setModalOpen(false); setEditing(null); }}
              className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              إلغاء
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal تعديل الكمية */}
      {qtyModal && (
        <Modal
          open={!!qtyModal}
          onClose={() => { setQtyModal(null); setQtyAdj(""); }}
          title={`تعديل كمية: ${qtyModal.name}`}
        >
          <div className="space-y-4" dir="rtl">
            {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>}
            <div className="text-sm text-gray-600">
              الكمية الحالية: <strong>{qtyModal.quantityAvailable}</strong>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">
                التعديل (موجب = إضافة، سالب = خصم)
              </label>
              <input
                type="number"
                step="1"
                value={qtyAdj}
                onChange={(e) => setQtyAdj(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="مثال: +10 أو -3"
              />
            </div>
            {qtyAdj !== "" && !isNaN(Number(qtyAdj)) && (
              <div className="text-sm text-gray-500">
                الكمية بعد التعديل: <strong>{Math.max(0, (qtyModal.quantityAvailable ?? 0) + Number(qtyAdj))}</strong>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  const adj = Number(qtyAdj);
                  if (!qtyAdj || isNaN(adj) || adj === 0) { setErr("أدخل رقماً غير صفر"); return; }
                  qtyMut.mutate({ id: qtyModal.id, adjustment: adj });
                }}
                disabled={qtyMut.isPending}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {qtyMut.isPending ? "جاري الحفظ..." : "تطبيق التعديل"}
              </button>
              <button
                onClick={() => { setQtyModal(null); setQtyAdj(""); }}
                className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >إلغاء</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
