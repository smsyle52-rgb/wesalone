import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { commerceApi } from "./api";
import { CommerceProductEditor } from "./CommerceProductEditor";
import { CommerceProductsTab } from "./CommerceProductsTab";
import { CommerceVariantEditor } from "./CommerceVariantEditor";
import type { CommerceProduct } from "./types";

export function CommerceProductsPanel() {
  const query = useQuery({ queryKey: ["commerce-products"], queryFn: () => commerceApi("products") });
  const products: CommerceProduct[] = query.data?.products ?? [];
  const [selectedProduct, setSelectedProduct] = useState<CommerceProduct | null>(null);
  return <div>
    <CommerceProductEditor />
    {selectedProduct && <CommerceVariantEditor product={selectedProduct} onClose={() => setSelectedProduct(null)} />}
    {query.isLoading
      ? <p className="p-8 text-center text-sm text-gray-500">جاري تحميل المنتجات...</p>
      : <CommerceProductsTab products={products} onSelect={setSelectedProduct} />}
  </div>;
}
