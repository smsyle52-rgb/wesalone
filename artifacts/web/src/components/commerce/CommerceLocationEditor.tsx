import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commerceApi } from "./api";

export function CommerceLocationEditor() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", type: "warehouse", isDefault: false });
  const [message, setMessage] = useState("");
  const mutation = useMutation({
    mutationFn: () => commerceApi("inventory/locations", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commerce-locations"] });
      setForm({ name: "", type: "warehouse", isDefault: false });
      setMessage("تم حفظ الموقع");
    },
    onError: (error: Error) => setMessage(error.message),
  });
  return <details className="mb-3 rounded-2xl border bg-white p-4">
    <summary className="cursor-pointer font-semibold text-blue-700">+ موقع تخزين</summary>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="اسم الموقع" className="rounded-xl border px-3 py-2" />
      <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className="rounded-xl border px-3 py-2">
        <option value="warehouse">مخزن رئيسي</option><option value="branch">فرع</option>
        <option value="showroom">معرض</option><option value="point_of_sale">نقطة بيع</option>
        <option value="virtual">موقع افتراضي</option>
      </select>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isDefault} onChange={(event) => setForm({ ...form, isDefault: event.target.checked })} />الموقع الافتراضي</label>
      <button type="button" disabled={!form.name.trim() || mutation.isPending} onClick={() => mutation.mutate()} className="rounded-xl bg-blue-600 px-4 py-2 text-white disabled:opacity-50">حفظ الموقع</button>
      {message && <p className="text-sm text-gray-600 sm:col-span-2">{message}</p>}
    </div>
  </details>;
}
