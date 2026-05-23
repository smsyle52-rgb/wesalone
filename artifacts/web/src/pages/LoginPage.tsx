import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const [, navigate] = useLocation();
  const { setAuth } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");

  const loginMut = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "خطأ في تسجيل الدخول");
      return json;
    },
    onSuccess: (data) => {
      setAuth({
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        emailVerified: data.user.emailVerified,
        permissions: data.user.permissions ?? [],
        roleSlugs: data.user.roleSlugs ?? [],
      }, data.workspaceId ?? "");
      navigate("/dashboard");
    },
    onError: (e: Error) => setError(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    loginMut.mutate(form);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10 p-4" dir="rtl">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary text-white text-2xl font-bold mb-4">خ</div>
          <h1 className="text-2xl font-bold text-foreground">خدماتك</h1>
          <p className="text-muted-foreground text-sm mt-1">سجّل الدخول إلى حسابك</p>
        </div>

        <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm text-center">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-foreground mb-1.5">البريد الإلكتروني</label>
              <input
                id="login-email"
                name="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                placeholder="example@company.com"
                autoComplete="email"
                required
                dir="ltr"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-foreground mb-1.5">كلمة المرور</label>
              <input
                id="login-password"
                name="password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>
            <div className="text-left">
              <a href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
                نسيت كلمة المرور؟
              </a>
            </div>
            <button
              type="submit"
              disabled={loginMut.isPending}
              className={cn(
                "w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm transition-all",
                loginMut.isPending ? "opacity-60 cursor-not-allowed" : "hover:bg-primary/90 active:scale-95"
              )}
            >
              {loginMut.isPending ? "جار التحقق..." : "تسجيل الدخول"}
            </button>
          </form>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            ليس لديك حساب؟{" "}
            <a href="/register" className="text-primary font-medium hover:underline">
              أنشئ مساحة عمل
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
