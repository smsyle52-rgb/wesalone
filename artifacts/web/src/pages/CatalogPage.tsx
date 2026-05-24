import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Eye, EyeOff, Megaphone, PackageSearch, Plus, RefreshCw, Search, ShoppingBag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/hooks/use-toast";

const BASE = `${import.meta.env.BASE_URL}api/catalog`;

const SYNC_STATUS_AR: Record<string, string> = {
  pending: "في الانتظار",
  synced: "متزامن",
  failed: "فشل",
  active: "نشط",
  ACTIVE: "نشط",
  PAUSED: "متوقف",
  paused: "متوقف",
};

const AVAILABILITY_AR: Record<string, string> = {
  "in stock": "متوفر",
  "out of stock": "غير متوفر",
  preorder: "طلب مسبق",
};

const AVAILABILITY_OPTIONS = [
  { value: "in stock", label: "متوفر" },
  { value: "out of stock", label: "غير متوفر" },
  { value: "preorder", label: "طلب مسبق" },
] as const;

type ProductFormState = {
  name: string;
  description: string;
  category: string;
  price: string;
  currency: "YER" | "SAR" | "USD";
  availability: "" | "in stock" | "out of stock" | "preorder";
  inventory_count: string;
  image_url: string;
  brand: string;
};

const emptyProductForm: ProductFormState = {
  name: "",
  description: "",
  category: "",
  price: "",
  currency: "YER",
  availability: "in stock",
  inventory_count: "",
  image_url: "",
  brand: "",
};

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const json = JSON.parse(text);
      if (typeof json.error === "string" && json.error.trim()) message = json.error;
    } catch {
      message = text;
    }
    throw new Error(message);
  }
  return res.json();
}

type Source = {
  id: string;
  sourceType: string;
  name: string;
  syncStatus: string;
  status: string;
  lastSyncedAt: string | null;
};

type ProductRow = {
  product: {
    id: string;
    name: string;
    description: string | null;
    price: string | null;
    currency: string | null;
    availability: string | null;
    category: string | null;
    imageUrl: string | null;
    brand: string | null;
    inventoryCount: number | null;
    isVisible: boolean;
    syncedAt: string;
  };
  sourceName: string | null;
  sourceType: string | null;
};

type PostRow = {
  post: { id: string; message: string | null; mediaUrl: string | null; permalinkUrl: string | null; publishedAt: string | null };
  sourceName: string | null;
};

type AdRow = {
  ad: { id: string; name: string; status: string | null; objective: string | null; promotedProductIds: string[] | null; syncedAt: string };
  sourceName: string | null;
};

function statusTone(status: string) {
  if (status === "synced" || status === "active" || status === "ACTIVE") return "bg-emerald-100 text-emerald-700";
  if (status === "failed" || status === "out of stock") return "bg-red-100 text-red-700";
  return "bg-muted text-muted-foreground";
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-lg bg-muted" />)}
    </div>
  );
}

function EmptyState({ title, description, onAddManual }: { title: string; description: string; onAddManual?: () => void }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-8 text-center">
      <ShoppingBag className="mb-3 h-10 w-10 text-muted-foreground" />
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      <Link href="/integrations" className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        اربط كتالوج ميتا
      </Link>
      {onAddManual && (
        <button onClick={onAddManual} className="mt-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
          أضف منتج يدوياً
        </button>
      )}
    </div>
  );
}

function buildProductPayload(form: ProductFormState) {
  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    category: form.category.trim() || undefined,
    price: form.price.trim() || undefined,
    currency: form.currency,
    availability: form.availability || undefined,
    inventory_count: form.inventory_count.trim() ? Number(form.inventory_count) : undefined,
    image_url: form.image_url.trim() || undefined,
    brand: form.brand.trim() || undefined,
  };
}

function productToForm(product: ProductRow["product"]): ProductFormState {
  return {
    name: product.name,
    description: product.description ?? "",
    category: product.category ?? "",
    price: product.price ?? "",
    currency: product.currency === "SAR" || product.currency === "USD" || product.currency === "YER" ? product.currency : "YER",
    availability: product.availability === "in stock" || product.availability === "out of stock" || product.availability === "preorder" ? product.availability : "",
    inventory_count: product.inventoryCount == null ? "" : String(product.inventoryCount),
    image_url: product.imageUrl ?? "",
    brand: product.brand ?? "",
  };
}

export default function CatalogPage({ tab = "products" }: { tab?: "products" | "posts" | "ads" }) {
  const { t } = useTranslation("pages");
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState("");
  const [category, setCategory] = useState("");
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [productForm, setProductForm] = useState<ProductFormState>(emptyProductForm);
  const [productFormError, setProductFormError] = useState("");

  const sourceQuery = useQuery<{ sources: Source[] }>({ queryKey: ["catalog-sources"], queryFn: () => apiFetch("sources") });
  const productsQuery = useQuery<{ products: ProductRow[] }>({
    queryKey: ["catalog-products", search, availability, category],
    queryFn: () => apiFetch(`products?${new URLSearchParams({ search, availability, category }).toString()}`),
    enabled: tab === "products",
  });
  const postsQuery = useQuery<{ posts: PostRow[] }>({ queryKey: ["catalog-posts"], queryFn: () => apiFetch("posts"), enabled: tab === "posts" });
  const adsQuery = useQuery<{ ads: AdRow[] }>({ queryKey: ["catalog-ads"], queryFn: () => apiFetch("ads"), enabled: tab === "ads" });

  const syncMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`sources/${id}/sync`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["catalog-sources"] });
    },
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, isVisible }: { id: string; isVisible: boolean }) => apiFetch(`products/${id}`, { method: "PATCH", body: JSON.stringify({ isVisible }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["catalog-products"] });
    },
  });
  const saveProductMutation = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ReturnType<typeof buildProductPayload> }) => apiFetch(id ? `products/${id}` : "products", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(body),
    }),
    onSuccess: () => {
      setProductModalOpen(false);
      setEditingProduct(null);
      setProductForm(emptyProductForm);
      setProductFormError("");
      toast({ title: "تم حفظ المنتج", description: "تم تحديث قائمة المنتجات ومعرفة الوكيل." });
      void qc.invalidateQueries({ queryKey: ["catalog-products"] });
      void qc.invalidateQueries({ queryKey: ["catalog-sources"] });
    },
    onError: (error) => {
      setProductFormError(error instanceof Error && error.message ? error.message : "تعذر حفظ المنتج. حاول مرة أخرى.");
    },
  });

  function openCreateProduct() {
    setEditingProduct(null);
    setProductForm(emptyProductForm);
    setProductFormError("");
    setProductModalOpen(true);
  }

  function openEditProduct(row: ProductRow) {
    setEditingProduct(row);
    setProductForm(productToForm(row.product));
    setProductFormError("");
    setProductModalOpen(true);
  }

  function closeProductModal() {
    if (saveProductMutation.isPending) return;
    setProductModalOpen(false);
    setEditingProduct(null);
    setProductForm(emptyProductForm);
    setProductFormError("");
  }

  const categories = useMemo(() => {
    const values = productsQuery.data?.products.map((row) => row.product.category).filter(Boolean) as string[] | undefined;
    return Array.from(new Set(values ?? []));
  }, [productsQuery.data?.products]);

  const currentQuery = tab === "products" ? productsQuery : tab === "posts" ? postsQuery : adsQuery;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("catalog.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("catalog.subtitle")}</p>
        </div>
        <div className="flex rounded-lg border border-border bg-card p-1">
          {(["products", "posts", "ads"] as const).map((nextTab) => (
            <button
              key={nextTab}
              onClick={() => setLocation(nextTab === "products" ? "/catalog" : `/catalog/${nextTab}`)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === nextTab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              {t(`catalog.tabs.${nextTab}`)}
            </button>
          ))}
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        {["commerce_catalog", "page_posts", "ads"].map((type) => {
          const source = sourceQuery.data?.sources.find((item) => item.sourceType === type);
          const title = t(`catalog.sources.${type}`);
          return (
            <div key={type} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{source?.name ?? t("catalog.noSource")}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs ${statusTone(source?.syncStatus ?? "pending")}`}>
                  {SYNC_STATUS_AR[source?.syncStatus ?? "pending"] ?? source?.syncStatus ?? "في الانتظار"}
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{source?.lastSyncedAt ? new Date(source.lastSyncedAt).toLocaleString() : t("catalog.neverSynced")}</span>
                <button
                  disabled={!source || syncMutation.isPending}
                  onClick={() => source && syncMutation.mutate(source.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-foreground disabled:opacity-40"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("catalog.syncNow")}
                </button>
              </div>
            </div>
          );
        })}
      </section>

      {currentQuery.isError && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <span className="inline-flex items-center gap-2"><AlertCircle className="h-4 w-4" />{t("catalog.loadError")}</span>
          <button onClick={() => currentQuery.refetch()} className="underline">{t("catalog.retry")}</button>
        </div>
      )}

      {tab === "products" && (
        <section className="rounded-lg border border-border bg-card">
          <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("catalog.search")} className="w-full rounded-md border border-border bg-background py-2 pe-3 ps-9 text-sm" />
            </div>
            <select value={availability} onChange={(e) => setAvailability(e.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
              <option value="">{t("catalog.allAvailability")}</option>
              <option value="in stock">متوفر</option>
              <option value="out of stock">غير متوفر</option>
              <option value="preorder">طلب مسبق</option>
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
              <option value="">{t("catalog.allCategories")}</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <button onClick={openCreateProduct} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4" />
              أضف منتج
            </button>
          </div>
          <div className="p-4">
            {productsQuery.isLoading ? <SkeletonRows /> : productsQuery.data?.products.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b border-border text-start">
                      <th className="p-3 text-start">{t("catalog.table.image")}</th>
                      <th className="p-3 text-start">{t("catalog.table.name")}</th>
                      <th className="p-3 text-start">{t("catalog.table.price")}</th>
                      <th className="p-3 text-start">{t("catalog.table.availability")}</th>
                      <th className="p-3 text-start">{t("catalog.table.source")}</th>
                      <th className="p-3 text-start">{t("catalog.table.syncedAt")}</th>
                      <th className="p-3 text-start">{t("catalog.table.visibility")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productsQuery.data.products.map(({ product, sourceName, sourceType }) => (
                      <tr
                        key={product.id}
                        onClick={() => sourceType === "manual" && openEditProduct({ product, sourceName, sourceType })}
                        className={`border-b border-border/60 ${sourceType === "manual" ? "cursor-pointer hover:bg-muted/40" : ""}`}
                      >
                        <td className="p-3">{product.imageUrl ? <img src={product.imageUrl} alt="" className="h-10 w-10 rounded-md object-cover" /> : <PackageSearch className="h-8 w-8 text-muted-foreground" />}</td>
                        <td className="p-3 font-medium">{product.name}</td>
                        <td className="p-3">{product.price ?? "-"} {product.currency ?? "YER"}</td>
                        <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs ${statusTone(product.availability ?? "")}`}>{AVAILABILITY_AR[product.availability ?? ""] ?? product.availability ?? "-"}</span></td>
                        <td className="p-3">{sourceName ?? "-"}</td>
                        <td className="p-3">{new Date(product.syncedAt).toLocaleString()}</td>
                        <td className="p-3">
                          <button onClick={(event) => { event.stopPropagation(); toggleMutation.mutate({ id: product.id, isVisible: !product.isVisible }); }} className="rounded-md border border-border p-2">
                            {product.isVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="لا توجد منتجات بعد" description="اربط كتالوج ميتا من صفحة التكاملات، أو أضف منتجاتك يدوياً لتظهر هنا ويستفيد منها الوكيل." onAddManual={openCreateProduct} />}
          </div>
        </section>
      )}

      {tab === "posts" && (
        <section className="grid gap-3">
          {postsQuery.isLoading ? <SkeletonRows /> : postsQuery.data?.posts.length ? postsQuery.data.posts.map(({ post, sourceName }) => (
            <article key={post.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                {post.mediaUrl ? <img src={post.mediaUrl} alt="" className="h-16 w-16 rounded-md object-cover" /> : <Megaphone className="h-8 w-8 text-muted-foreground" />}
                <div>
                  <p className="text-sm text-foreground">{post.message ?? "-"}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{sourceName ?? "-"} · {post.publishedAt ? new Date(post.publishedAt).toLocaleString() : "-"}</p>
                </div>
              </div>
            </article>
          )) : <EmptyState title="لا توجد منشورات متزامنة بعد" description="بعد ربط صفحة ميتا وتشغيل المزامنة ستظهر المنشورات الأخيرة هنا كمرجع للفريق والوكيل." />}
        </section>
      )}

      {tab === "ads" && (
        <section className="grid gap-3">
          {adsQuery.isLoading ? <SkeletonRows /> : adsQuery.data?.ads.length ? adsQuery.data.ads.map(({ ad, sourceName }) => (
            <article key={ad.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="font-semibold text-foreground">{ad.name}</h3>
                  <p className="text-xs text-muted-foreground">{sourceName ?? "-"} · {ad.objective ?? "-"}</p>
                </div>
                <span className={`w-fit rounded-full px-2 py-1 text-xs ${statusTone(ad.status ?? "")}`}>{ad.status ?? "-"}</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{t("catalog.promotedProducts")}: {(ad.promotedProductIds ?? []).join(", ") || "-"}</p>
            </article>
          )) : <EmptyState title="لا توجد إعلانات متزامنة بعد" description="اربط حساب الإعلانات وشغّل المزامنة حتى يعرف الفريق الحملات النشطة وما تروّج له." />}
        </section>
      )}

      <Modal open={productModalOpen} onClose={closeProductModal} title={editingProduct ? "تعديل المنتج" : "أضف منتج"} size="lg">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const body = buildProductPayload(productForm);
            if (!body.name) {
              setProductFormError("اسم المنتج مطلوب.");
              return;
            }
            setProductFormError("");
            saveProductMutation.mutate({ id: editingProduct?.product.id, body });
          }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm font-medium text-foreground">
              الاسم *
              <input value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" required />
            </label>
            <label className="block text-sm font-medium text-foreground">
              الفئة
              <input value={productForm.category} onChange={(event) => setProductForm({ ...productForm, category: event.target.value })} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </label>
          </div>
          <label className="block text-sm font-medium text-foreground">
            الوصف
            <textarea value={productForm.description} onChange={(event) => setProductForm({ ...productForm, description: event.target.value })} rows={3} className="mt-1 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </label>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm font-medium text-foreground">
              السعر
              <input type="number" min="0" step="0.01" value={productForm.price} onChange={(event) => setProductForm({ ...productForm, price: event.target.value })} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </label>
            <label className="block text-sm font-medium text-foreground">
              العملة
              <select value={productForm.currency} onChange={(event) => setProductForm({ ...productForm, currency: event.target.value as ProductFormState["currency"] })} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="YER">YER</option>
                <option value="SAR">SAR</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-foreground">
              التوفّر
              <select value={productForm.availability} onChange={(event) => setProductForm({ ...productForm, availability: event.target.value as ProductFormState["availability"] })} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                {AVAILABILITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm font-medium text-foreground">
              الكمية
              <input type="number" min="0" step="1" value={productForm.inventory_count} onChange={(event) => setProductForm({ ...productForm, inventory_count: event.target.value })} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </label>
            <label className="block text-sm font-medium text-foreground">
              العلامة التجارية
              <input value={productForm.brand} onChange={(event) => setProductForm({ ...productForm, brand: event.target.value })} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </label>
          </div>
          <label className="block text-sm font-medium text-foreground">
            رابط الصورة
            <input type="url" value={productForm.image_url} onChange={(event) => setProductForm({ ...productForm, image_url: event.target.value })} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="https://example.com/product.jpg" />
            <span className="mt-1 block text-xs text-muted-foreground">رفع الصور غير متاح حالياً؛ الصق رابط الصورة الآن.</span>
          </label>
          {productFormError && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{productFormError}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeProductModal} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">إلغاء</button>
            <button type="submit" disabled={saveProductMutation.isPending || !productForm.name.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {saveProductMutation.isPending ? "جار الحفظ..." : "حفظ المنتج"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
