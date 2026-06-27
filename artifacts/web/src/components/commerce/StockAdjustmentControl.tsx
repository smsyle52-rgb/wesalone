import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commerceApi } from "./api";
import type { StockLevel } from "./types";

export function StockAdjustmentControl({ level }: { level: StockLevel }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ adjustment: "", reason: "", movementType: "Adjustment" });
  const [message, setMessage] = useState("");
  const mutation = useMutation({
    mutationFn: () => commerceApi(`inventory/levels/${level.id}/adjust`, {
      method: "POST",
      body: JSON.stringify({
        adjustment: Number(form.adjustment),
        reason: form.reason.trim(),
        movementType: form.movementType,
        idempotencyKey: crypto.randomUUID(),
      }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commerce-levels"] });
      queryClient.invalidateQueries({ queryKey: ["commerce-movements"] });
      setForm({ adjustment: "", reason: "", movementType: "Adjustment" });
      setMessage("تم تعديل المخزون");
      setOpen(false);
    },
    onError: (error: Error) => setMessage(error.message),
  });

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-3 rounded-lg border px-3 py-1.5 text-xs">تعديل المخزون</button>;
  return <div className="mt-3 space-y-2 rounded-xl border bg-gray-50 p-3">
    <div className="grid gap-2 sm:grid-cols-3">
      <input type="number" value={form.adjustment} onChange={(event) => setForm({ ...form, adjustment: event.target.value })} placeholder="+10 أو -3" className="rounded-lg border px-2 py-1.5 text-sm" />
      <select value={form.movementType} onChange={(event) => setForm({ ...form, movementType: event.target.value })} className="rounded-lg border px-2 py-1.5 text-sm"><option value="Adjustment">تعديل</option><option value="Incoming">وارد</option><option value="Damage">تالف</option></select>
      <input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="سبب إلزامي" className="rounded-lg border px-2 py-1.5 text-sm" />
    </div>
    <div className="flex gap-2"><button type="button" disabled={!form.adjustment || Number(form.adjustment) === 0 || form.reason.trim().length < 3 || mutation.isPending} onClick={() => mutation.mutate()} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">تطبيق</button><button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-3 py-1.5 text-xs">إلغاء</button></div>
    {message && <p className="text-xs text-gray-600">{message}</p>}
  </div>;
}
