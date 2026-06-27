import { useQuery } from "@tanstack/react-query";
import { commerceApi } from "./api";
import { CommerceProductsTab } from "./CommerceProductsTab";
import type { CommerceProduct } from "./types";

export function CommerceProductsPanel() {
  const query = useQuery({ queryKey: ["commerce-products"], queryFn: () => commerceApi("products") });
  const products: CommerceProduct[] = query.data?.products ?? [];
  if (query.isLoading) return <p className="p-8 text-center text-sm text-gray-500">جاري تحميل المنتجات...</p>;
  return <CommerceProductsTab products={products} onSelect={() => undefined} />;
}
