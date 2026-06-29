import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commerceApi } from "./api";
import type { CommerceProduct } from "./types";

export function CommerceVariantEditor({ product, onClose }: { product: CommerceProduct; onClose: () => void }) {
  const queryClient = useQueryClient();
  const locationsQuery = useQuery({ queryKey: ["commerce-locations"], queryFn: () => commerceApi("inventory/locations") });
  const locations: Array<{ id: string; name: string; isDefault: boolean }> = locationsQuery.data?.locations ?? [];
  const [form, setForm] = useState({ title: "", sku: "", barcode: "", color: "", size: "", measurement: "", price: "0", cost: "", stock: "0", locationId: "" });
  const [message, setMessage] = useState("");
  const mutation = useMutation({
    mutationFn: () => {
      const optionValues: Record<string, string> = {};
      if (form.color.trim()) optionValues["اللون"] = form.color.trim();
      if (form.size.trim()) optionValues["الحجم"] = form.size.trim();
      if (form.measurement.trim()) optionValues["المقاس"] = form.measurement.trim();
      return commerceApi(`products/${product.id}/variants`, {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim() || "متغير",
          sku: form.sku.trim() || null,
          barcode: form.barcode.trim() || null,
          optionValues,
          price: Number(form.price),
          cost: form.cost ? Number(form.cost) : null,
          currency: product.currency || "YER",
          lowStockThreshold: 0,
          initialStock: Number(form.stock),
          locationId: form.locationId || locations.find((location) => location.isDefault)?.id,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commerce-products"] });
      queryClient.invalidateQueries({ queryKey: ["commerce-levels"] });
      setMessage("تم حفظ المتغير");
      onClose();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  return <div className="mb-3 rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
    <div className="mb-3 flex items-center justify-between"><strong>متغير جديد: {product.name}</strong><button type="button" onClick={onClose} className="text-sm text-gray-500">إغلاق</button></div>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="اسم المتغير" className="rounded-xl border px-3 py-2" />
      <input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="SKU" className="rounded-xl border px-3 py-2" />
      <input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} placeholder="Barcode" className="rounded-xl border px-3 py-2" />
      <input value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} placeholder="اللون" className="rounded-xl border px-3 py-2" />
      <input value={form.size} onChange={(event) => setForm({ ...form, size: event.target.value })} placeholder="الحجم" className="rounded-xl border px-3 py-2" />
      <input value={form.measurement} onChange={(event) => setForm({ ...form, measurement: event.target.value })} placeholder="المقاس" className="rounded-xl border px-3 py-2" />
      <input type="number" min="0" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="السعر" className="rounded-xl border px-3 py-2" />
      <input type="number" min="0" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} placeholder="التكلفة" className="rounded-xl border px-3 py-2" />
      <input type="number" min="0" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} placeholder="الرصيد الافتتاحي" className="rounded-xl border px-3 py-2" />
      <select value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })} className="rounded-xl border px-3 py-2"><option value="">الموقع الافتراضي</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select>
      <button type="button" disabled={mutation.isPending || Number(form.price) < 0} onClick={() => mutation.mutate()} className="rounded-xl bg-blue-600 px-4 py-2 text-white disabled:opacity-50 lg:col-span-2">حفظ المتغير</button>
      {message && <p className="text-sm text-gray-600 lg:col-span-3">{message}</p>}
    </div>
  </div>;
}
