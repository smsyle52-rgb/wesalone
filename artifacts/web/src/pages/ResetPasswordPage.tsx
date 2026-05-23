import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";

export default function ResetPasswordPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get("token") ?? "", []);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "تعذر تحديث كلمة المرور");
      return json;
    },
    onSuccess: (data) => {
      setError("");
      setMessage(data.message ?? "تم تحديث كلمة المرور بنجاح.");
    },
    onError: (err: Error) => {
      setMessage("");
      setError(err.message);
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10 p-4" dir="rtl">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-bold text-foreground">تعيين كلمة مرور جديدة</h1>
        {message && <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div>}
        {error && <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="كلمة مرور من 8 أحرف على الأقل"
            minLength={8}
            required
          />
          <button className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={mutation.isPending || !token}>
            {mutation.isPending ? "جار الحفظ..." : "تحديث كلمة المرور"}
          </button>
        </form>
        <a href="/login" className="mt-4 block text-center text-sm font-medium text-primary hover:underline">تسجيل الدخول</a>
      </div>
    </div>
  );
}
