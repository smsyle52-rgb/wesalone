import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Boxes,
  Camera,
  CircleDollarSign,
  ImageIcon,
  Package,
  PencilLine,
  Plus,
  Search,
  Truck,
} from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { uploadProductImage } from "@/lib/imageUpload";

const BASE = `${import.meta.env.BASE_URL}api`;

const apiFetch = async (path: string, opts?: RequestInit) => {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      throw new Error(j.error ?? text);
    } catch {
      throw new Error(text);
    }
  }
  return res.json();
};

const DELIVERY_LABELS: Record<string, string> = {
  all: "توصيل لكل مكان",
  local: "داخل المدينة",
  pickup_only: "استلام من المحل",
};

const CURRENCIES = ["YER", "SAR", "USD"] as const;
type Currency = (typeof CURRENCIES)[number];

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
    <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-6 text-center text-sm text-yellow-800">
      ليس لديك صلاحية لتنفيذ هذا الإجراء
    </div>
  );
}

function stockTone(quantity: number | null) {
  if (quantity === null) return "text-muted-foreground";
  if (quantity === 0) return "text-destructive";
  if (quantity < 5) return "text-amber-600";
  return "text-emerald-600";
}

function surfaceInputClassName() {
  return "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";
}

export default function ProductsPage() {
  const { user } = useAuth();
  const perms = new Set(user?.permissions ?? []);
  const canRead = perms.has("products:read");
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
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

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
        return apiFetch(`products/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      return apiFetch("products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setModalOpen(false);
      setEditing(null);
      setErr("");
      setUploadErr("");
    },
    onError: (e: Error) => setErr(e.message),
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => apiFetch(`products/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
  });

  const qtyMut = useMutation({
    mutationFn: ({ id, adjustment }: { id: string; adjustment: number }) =>
      apiFetch(`products/${id}/quantity`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustment }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setQtyModal(null);
      setQtyAdj("");
      setErr("");
    },
    onError: (e: Error) => setErr(e.message),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setErr("");
    setUploadErr("");
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
    setUploadErr("");
    setModalOpen(true);
  };

  if (!canRead) return <div className="p-8"><PermissionDenied /></div>;

  const products: Product[] = data?.products ?? [];
  const activeProducts = products.filter((p) => !p.isArchived);
  const archivedProducts = products.filter((p) => p.isArchived);
  const lowStockProducts = activeProducts.filter(
    (p) => p.quantityAvailable !== null && p.quantityAvailable > 0 && p.quantityAvailable < 5,
  );
  const unlimitedProducts = activeProducts.filter((p) => p.quantityAvailable === null);

  const columns = [
    {
      key: "name",
      label: "المنتج",
      render: (p: Product) => (
        <div className="flex items-center gap-3">
          {p.imageUrl ? (
            <img src={p.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-border object-cover" />
          ) : (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Package size={18} />
            </span>
          )}
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{p.name}</div>
            {p.sku && <div className="mt-0.5 text-xs text-muted-foreground">SKU: {p.sku}</div>}
            {p.isArchived && <span className="text-xs text-muted-foreground">(مؤرشف)</span>}
          </div>
        </div>
      ),
    },
    {
      key: "price",
      label: "السعر",
      render: (p: Product) => (
        <div className="text-sm font-semibold">
          {Number(p.price).toLocaleString("ar-YE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} {p.currency}
          {p.unit && <span className="font-normal text-muted-foreground"> / {p.unit}</span>}
        </div>
      ),
    },
    {
      key: "quantity",
      label: "المخزون",
      render: (p: Product) => (
        <div className="flex items-center gap-2">
          {p.quantityAvailable === null ? (
            <span className="text-xs text-muted-foreground">غير محدود</span>
          ) : (
            <span className={`text-sm font-semibold ${stockTone(p.quantityAvailable)}`}>{p.quantityAvailable}</span>
          )}
          {canUpdate && p.quantityAvailable !== null && (
            <button
              onClick={() => {
                setQtyModal(p);
                setQtyAdj("");
                setErr("");
              }}
              className="text-xs text-primary hover:underline"
            >
              تعديل
            </button>
          )}
        </div>
      ),
    },
    {
      key: "delivery",
      label: "التوصيل",
      render: (p: Product) => (
        <span className="text-xs text-muted-foreground">{DELIVERY_LABELS[p.deliveryPolicy] ?? p.deliveryPolicy}</span>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (p: Product) => (
        <div className="flex items-center justify-end gap-2">
          {canUpdate && !p.isArchived && (
            <button onClick={() => openEdit(p)} className="text-xs text-primary hover:underline">
              تعديل
            </button>
          )}
          {canDelete && !p.isArchived && (
            <button
              onClick={() => {
                if (confirm(`أرشفة "${p.name}"؟`)) archiveMut.mutate(p.id);
              }}
              className="text-xs text-red-500 hover:underline"
            >
              أرشفة
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="المخزون"
        subtitle="إدارة منتجاتك وكمياتها المتاحة"
        actions={
          canCreate ? (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90"
            >
              <Plus size={16} />
              منتج جديد
            </button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">المنتجات النشطة</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{activeProducts.length}</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
              <Boxes size={18} />
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">مخزون منخفض</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{lowStockProducts.length}</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-amber-500/10 text-amber-600">
              <Package size={18} />
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">مخزون مفتوح</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{unlimitedProducts.length}</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-sky-500/10 text-sky-600">
              <Truck size={18} />
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">المؤرشف</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{archivedProducts.length}</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Archive size={18} />
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="ابحث باسم المنتج أو الرمز..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-background py-2 pr-10 pl-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded"
              />
              عرض المؤرشف
            </label>
            <div className="inline-flex h-11 items-center rounded-lg bg-muted px-3 text-sm font-medium text-muted-foreground">
              {products.length} منتج
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <DataTable
          columns={columns}
          data={products}
          isLoading={isLoading}
          emptyMessage="لا توجد منتجات بعد. أضف أول منتج ليظهر هنا."
          keyExtractor={(p: Product) => p.id}
        />
      </div>

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        title={editing ? "تعديل المنتج" : "منتج جديد"}
      >
        <div className="space-y-4" dir="rtl">
          {err && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{err}</div>}

          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-border bg-background">
                {form.imageUrl ? (
                  <img src={form.imageUrl} alt="" className="h-full w-full rounded-xl object-cover" />
                ) : (
                  <Package size={20} className="text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{editing ? "تعديل بيانات المنتج" : "إضافة منتج جديد"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  أدخل الاسم والسعر والكمية والصورة لتجهيز المنتج للعرض والطلبات.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">اسم المنتج *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={surfaceInputClassName()}
                placeholder="مثال: عسل سدر"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">الوصف</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className={`${surfaceInputClassName()} resize-none`}
                placeholder="وصف اختياري للمنتج"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">السعر *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  className={surfaceInputClassName()}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">العملة</label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as Currency }))}
                  className={surfaceInputClassName()}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">الوحدة</label>
                <input
                  type="text"
                  value={form.unit}
                  onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                  className={surfaceInputClassName()}
                  placeholder="كيلو / قطعة / علبة"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">SKU / رمز المنتج</label>
                <input
                  type="text"
                  value={form.sku}
                  onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                  className={surfaceInputClassName()}
                  placeholder="اختياري"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">الكمية المتاحة</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.quantityAvailable}
                onChange={(e) => setForm((f) => ({ ...f, quantityAvailable: e.target.value }))}
                className={surfaceInputClassName()}
                placeholder="اتركه فارغًا = غير محدود"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">سياسة التوصيل</label>
              <select
                value={form.deliveryPolicy}
                onChange={(e) => setForm((f) => ({ ...f, deliveryPolicy: e.target.value }))}
                className={surfaceInputClassName()}
              >
                <option value="all">توصيل لكل مكان</option>
                <option value="local">داخل المدينة فقط</option>
                <option value="pickup_only">استلام من المحل فقط</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">صورة المنتج</label>
              <div className="rounded-xl border border-border bg-background p-3">
                <div className="flex items-center gap-3">
                  {form.imageUrl ? (
                    <img src={form.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-border object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                      <ImageIcon size={24} />
                    </div>
                  )}

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <label className="inline-block">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        disabled={uploading}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) return;
                          setUploadErr("");
                          setUploading(true);
                          try {
                            const url = await uploadProductImage(file);
                            setForm((f) => ({ ...f, imageUrl: url }));
                          } catch (er) {
                            setUploadErr((er as Error).message);
                          } finally {
                            setUploading(false);
                          }
                        }}
                      />
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium ${
                          uploading ? "cursor-wait opacity-50" : "cursor-pointer text-foreground hover:bg-muted"
                        }`}
                      >
                        <Camera size={14} />
                        {uploading ? "جاري الرفع..." : form.imageUrl ? "تغيير الصورة" : "رفع صورة"}
                      </span>
                    </label>

                    {form.imageUrl && !uploading && (
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, imageUrl: "" }))}
                        className="mr-3 text-xs text-red-500 hover:underline"
                      >
                        إزالة
                      </button>
                    )}

                    {uploadErr && <p className="text-xs text-red-600">{uploadErr}</p>}
                  </div>
                </div>
              </div>

              <input
                type="url"
                value={form.imageUrl}
                onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="أو الصق رابط صورة مباشر https://..."
                dir="ltr"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => saveMut.mutate(form)}
              disabled={saveMut.isPending || !form.name.trim()}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <CircleDollarSign size={16} />
              {saveMut.isPending ? "جاري الحفظ..." : editing ? "حفظ التعديلات" : "إضافة المنتج"}
            </button>
            <button
              onClick={() => {
                setModalOpen(false);
                setEditing(null);
              }}
              className="rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted"
            >
              إلغاء
            </button>
          </div>
        </div>
      </Modal>

      {qtyModal && (
        <Modal
          open={!!qtyModal}
          onClose={() => {
            setQtyModal(null);
            setQtyAdj("");
          }}
          title={`تعديل كمية: ${qtyModal.name}`}
        >
          <div className="space-y-4" dir="rtl">
            {err && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{err}</div>}

            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-background text-primary">
                  <PencilLine size={18} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">تعديل رصيد المخزون</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    أدخل رقمًا موجبًا للإضافة أو سالبًا للخصم من الكمية الحالية.
                  </p>
                </div>
              </div>
            </div>

            <div className="text-sm text-muted-foreground">
              الكمية الحالية: <strong>{qtyModal.quantityAvailable}</strong>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                التعديل (موجب = إضافة، سالب = خصم)
              </label>
              <input
                type="number"
                step="1"
                value={qtyAdj}
                onChange={(e) => setQtyAdj(e.target.value)}
                className={surfaceInputClassName()}
                placeholder="مثال: +10 أو -3"
              />
            </div>

            {qtyAdj !== "" && !isNaN(Number(qtyAdj)) && (
              <div className="text-sm text-muted-foreground">
                الكمية بعد التعديل: <strong>{Math.max(0, (qtyModal.quantityAvailable ?? 0) + Number(qtyAdj))}</strong>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  const adj = Number(qtyAdj);
                  if (!qtyAdj || isNaN(adj) || adj === 0) {
                    setErr("أدخل رقمًا غير صفر");
                    return;
                  }
                  qtyMut.mutate({ id: qtyModal.id, adjustment: adj });
                }}
                disabled={qtyMut.isPending}
                className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {qtyMut.isPending ? "جاري الحفظ..." : "تطبيق التعديل"}
              </button>
              <button
                onClick={() => {
                  setQtyModal(null);
                  setQtyAdj("");
                }}
                className="rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted"
              >
                إلغاء
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
