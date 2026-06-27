import type { CommerceProduct } from "./types";

export function CommerceProductsTab(props: {
  products: CommerceProduct[];
  onSelect: (product: CommerceProduct) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {props.products.map((product) => (
        <button key={product.id} type="button" onClick={() => props.onSelect(product)} className="rounded-2xl border bg-white p-4 text-right">
          <strong>{product.name}</strong>
          <span className="mt-1 block text-xs text-gray-500">{product.variantCount} متغير · متاح {product.available}</span>
        </button>
      ))}
    </div>
  );
}
