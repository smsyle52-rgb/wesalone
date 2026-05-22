import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Eye, EyeOff, Megaphone, PackageSearch, RefreshCw, Search, ShoppingBag } from "lucide-react";
import { useTranslation } from "react-i18next";

const BASE = `${import.meta.env.BASE_URL}api/catalog`;

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
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
    price: string | null;
    currency: string | null;
    availability: string | null;
    category: string | null;
    imageUrl: string | null;
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

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-8 text-center">
      <ShoppingBag className="mb-3 h-10 w-10 text-muted-foreground" />
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      <Link href="/integrations" className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        /integrations
      </Link>
    </div>
  );
}

export default function CatalogPage({ tab = "products" }: { tab?: "products" | "posts" | "ads" }) {
  const { t } = useTranslation("pages");
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState("");
  const [category, setCategory] = useState("");

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
                  {source?.syncStatus ?? "pending"}
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
              <option value="in stock">in stock</option>
              <option value="out of stock">out of stock</option>
              <option value="preorder">preorder</option>
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
              <option value="">{t("catalog.allCategories")}</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
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
                    {productsQuery.data.products.map(({ product, sourceName }) => (
                      <tr key={product.id} className="border-b border-border/60">
                        <td className="p-3">{product.imageUrl ? <img src={product.imageUrl} alt="" className="h-10 w-10 rounded-md object-cover" /> : <PackageSearch className="h-8 w-8 text-muted-foreground" />}</td>
                        <td className="p-3 font-medium">{product.name}</td>
                        <td className="p-3">{product.price ?? "-"} {product.currency ?? "YER"}</td>
                        <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs ${statusTone(product.availability ?? "")}`}>{product.availability ?? "-"}</span></td>
                        <td className="p-3">{sourceName ?? "-"}</td>
                        <td className="p-3">{new Date(product.syncedAt).toLocaleString()}</td>
                        <td className="p-3">
                          <button onClick={() => toggleMutation.mutate({ id: product.id, isVisible: !product.isVisible })} className="rounded-md border border-border p-2">
                            {product.isVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="لا توجد منتجات متزامنة بعد" description="اربط كتالوج ميتا من صفحة التكاملات، ثم شغّل المزامنة حتى تظهر المنتجات هنا ويستفيد منها الوكيل." />}
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
    </div>
  );
}
