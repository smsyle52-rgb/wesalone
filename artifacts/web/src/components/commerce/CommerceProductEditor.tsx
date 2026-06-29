import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commerceApi } from "./api";

export function CommerceProductEditor() {
  const queryClient = useQueryClient();
  const locationsQuery = useQuery({ queryKey: ["commerce-locations"], queryFn: () => commerceApi("inventory/locations") });
  const locations: Array<{ id: string; name: string; isDefault: boolean }> = locationsQuery.data?.locations ?? [];
  const [form, setForm] = useState({ name: "", sku: "", barcode: "", price: "0", stock: "0", locationId: "" });
  const [message, setMessage] = useState("");
  const mutation = useMutation({
    mutationFn: () => commerceApi("products", {
      method: "POST",
      body: JSON.stringify({
        name: form.name.trim(),
        images: [],
        status: "active",
        deliveryPolicy: "all",
        variants: [{
          title: "افتراضي",
          sku: form.sku.trim() || null,
          barcode: form.barcode.trim() || null,
          optionValues: {},
          price: Number(form.price),
          currency: "YER",
          lowStockThreshold: 0,
          initialStock: Number(form.stock),
          locationId: form.locationId || locations.find((location) => location.isDefault)?.id,
        }],
      }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commerce-products"] });
      queryClient.invalidateQueries({ queryKey: ["commerce-levels"] });
      setForm({ name: "", sku: "", barcode: "", price: "0", stock: "0", locationId: "" });
      setMessage("تم حفظ المنتج والمتغير");
    },
    onError: (error: Error) => setMessage(error.message),
  });

  return <details className="mb-3 rounded-2xl border bg-white p-4">
    <summary className="cursor-pointer font-semibold text-blue-700">+ منتج ومتغير افتراضي</summary>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="اسم المنتج" className="rounded-xl border px-3 py-2" />
      <input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="SKU" className="rounded-xl border px-3 py-2" />
      <input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} placeholder="Barcode" className="rounded-xl border px-3 py-2" />
      <input type="number" min="0" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="السعر" className="rounded-xl border px-3 py-2" />
      <input type="number" min="0" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} placeholder="الرصيد الافتتاحي" className="rounded-xl border px-3 py-2" />
      <select value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })} className="rounded-xl border px-3 py-2">
        <option value="">الموقع الافتراضي</option>
        {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
      </select>
      <button type="button" disabled={!form.name.trim() || mutation.isPending} onClick={() => mutation.mutate()} className="rounded-xl bg-blue-600 px-4 py-2 text-white disabled:opacity-50 sm:col-span-2">حفظ</button>
      {message && <p className="text-sm text-gray-600 sm:col-span-2">{message}</p>}
    </div>
  </details>;
}
