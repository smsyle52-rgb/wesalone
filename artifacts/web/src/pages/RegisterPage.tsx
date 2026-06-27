import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

const COUNTRY_CODES = [
  { code: "+966", label: "🇸🇦 +966" },
  { code: "+967", label: "🇾🇪 +967" },
  { code: "+971", label: "🇦🇪 +971" },
  { code: "+965", label: "🇰🇼 +965" },
  { code: "+973", label: "🇧🇭 +973" },
  { code: "+974", label: "🇶🇦 +974" },
  { code: "+968", label: "🇴🇲 +968" },
  { code: "+962", label: "🇯🇴 +962" },
  { code: "+963", label: "🇸🇾 +963" },
  { code: "+961", label: "🇱🇧 +961" },
  { code: "+20", label: "🇪🇬 +20" },
  { code: "+1", label: "🇺🇸 +1" },
  { code: "+44", label: "🇬🇧 +44" },
];

function normalizePhone(countryCode: string, local: string): string {
  const digits = local.replace(/\D/g, "");
  if (!digits) return "";
  const stripped = digits.replace(/^0+/, "");
  return `${countryCode}${stripped}`;
}

function PasswordRequirements({ password }: { password: string }) {
  const checks = [
    { label: "8 أحرف على الأقل", ok: password.length >= 8 },
    { label: "حرف كبير (A-Z) أو حرف صغير (a-z)", ok: /[a-zA-Z]/.test(password) },
    { label: "رقم (0-9)", ok: /\d/.test(password) },
  ];
  if (!password) return null;
  return (
    <ul className="mt-1.5 space-y-0.5">
      {checks.map((c) => (
        <li key={c.label} className={cn("flex items-center gap-1.5 text-xs", c.ok ? "text-green-600" : "text-muted-foreground")}>
          <span>{c.ok ? "✓" : "○"}</span>
          {c.label}
        </li>
      ))}
    </ul>
  );
}


export default function RegisterPage() {
  const [, navigate] = useLocation();
  const { setAuth } = useAuth();
  const [form, setForm] = useState({ workspaceName: "", ownerName: "", email: "", password: "", phone: "", countryCode: "+966", website: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);

  const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";

  const registerMut = useMutation({
    mutationFn: async (data: typeof form) => {
      const phone = normalizePhone(data.countryCode, data.phone);
      const res = await fetch(`${import.meta.env.BASE_URL}api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          workspaceName: data.workspaceName,
          ownerName: data.ownerName,
          email: data.email,
          password: data.password,
          phone: phone || undefined,
          website: data.website,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "خطأ في إنشاء الحساب");
      return json;
    },
    onSuccess: (data) => {
      setAuth(
        {
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          emailVerified: data.user.emailVerified,
          permissions: data.user.permissions ?? [],
          roleSlugs: data.user.roleSlugs ?? [],
        },
        data.workspaceId ?? data.workspace?.id ?? "",
        { onboardingCompleted: false },
      );
      navigate("/onboarding");
    },
    onError: (e: Error) => setError(e.message),
  });

  async function handleGoogleResponse(credential: string) {
    setGoogleLoading(true);
    setError("");
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ credential }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "خطأ في تسجيل الدخول بـGoogle");
      setAuth(
        {
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          emailVerified: data.user.emailVerified,
          permissions: data.user.permissions ?? [],
          roleSlugs: data.user.roleSlugs ?? [],
        },
        data.workspaceId ?? "",
        { onboardingCompleted: !data.isNewUser },
      );
      navigate(data.isNewUser ? "/onboarding" : "/dashboard");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGoogleLoading(false);
    }
  }

  function triggerGoogleSignIn() {
    if (!GOOGLE_CLIENT_ID) {
      setError("تسجيل الدخول بـGoogle غير مهيأ بعد.");
      return;
    }
    if (!window.google) {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.defer = true;
      s.onload = () => {
        window.google?.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (r: { credential: string }) => handleGoogleResponse(r.credential),
        });
        window.google?.accounts.id.prompt();
      };
      document.head.appendChild(s);
    } else {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (r: { credential: string }) => handleGoogleResponse(r.credential),
      });
      window.google.accounts.id.prompt();
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    registerMut.mutate(form);
  };

  const passwordStrong = form.password.length >= 8 && /[a-zA-Z]/.test(form.password) && /\d/.test(form.password);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10 p-4" dir="rtl">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary text-white text-2xl font-bold mb-3">و</div>
          <h1 className="text-2xl font-bold text-foreground">وصال ون</h1>
          <p className="text-muted-foreground text-sm mt-1">أنشئ مساحة عملك في دقيقة</p>
          <p className="text-xs text-green-600 font-medium mt-1">ابدأ مجاناً — لا يُطلب بطاقة دفع</p>
        </div>

        <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm text-center">
              {error}
            </div>
          )}

          {/* Google button */}
          {GOOGLE_CLIENT_ID && (
            <>
              <button
                type="button"
                onClick={triggerGoogleSignIn}
                disabled={googleLoading || registerMut.isPending}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-input bg-background py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors disabled:opacity-60"
              >
                {googleLoading ? (
                  <span className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                ) : (
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                )}
                المتابعة بـGoogle
              </button>
              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">أو بالبريد الإلكتروني</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Honeypot */}
            <input type="text" name="website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />

            <div>
              <label htmlFor="reg-workspace" className="block text-sm font-medium text-foreground mb-1.5">اسم الشركة / المساحة</label>
              <input id="reg-workspace" name="workspaceName" type="text" value={form.workspaceName} onChange={(e) => setForm({ ...form, workspaceName: e.target.value })} className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors" placeholder="شركتي للتجارة" autoComplete="organization" required />
            </div>

            <div>
              <label htmlFor="reg-name" className="block text-sm font-medium text-foreground mb-1.5">اسمك</label>
              <input id="reg-name" name="ownerName" type="text" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors" placeholder="محمد أحمد" autoComplete="name" required />
            </div>

            <div>
              <label htmlFor="reg-email" className="block text-sm font-medium text-foreground mb-1.5">البريد الإلكتروني</label>
              <input id="reg-email" name="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors" placeholder="example@company.com" autoComplete="email" required dir="ltr" />
            </div>

            <div>
              <label htmlFor="reg-phone" className="block text-sm font-medium text-foreground mb-1.5">رقم الجوال <span className="text-xs text-muted-foreground">(اختياري)</span></label>
              <div className="flex gap-1.5">
                <select value={form.countryCode} onChange={(e) => setForm({ ...form, countryCode: e.target.value })} className="shrink-0 rounded-lg border border-input bg-background px-2 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" dir="ltr">
                  {COUNTRY_CODES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
                <input id="reg-phone" name="phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="flex-1 px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors" placeholder="5xxxxxxxx" dir="ltr" autoComplete="tel-national" />
              </div>
            </div>

            <div>
              <label htmlFor="reg-password" className="block text-sm font-medium text-foreground mb-1.5">كلمة المرور</label>
              <div className="relative">
                <input id="reg-password" name="password" type={showPassword ? "text" : "password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full px-3 py-2.5 pe-10 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors" placeholder="••••••••" autoComplete="new-password" required minLength={8} dir="ltr" />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <PasswordRequirements password={form.password} />
            </div>

            <button
              type="submit"
              disabled={registerMut.isPending || !passwordStrong}
              className={cn(
                "w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm transition-all",
                registerMut.isPending || !passwordStrong ? "opacity-60 cursor-not-allowed" : "hover:bg-primary/90 active:scale-95"
              )}
            >
              {registerMut.isPending ? "جار الإنشاء..." : "إنشاء الحساب"}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            بإنشاء الحساب أنت توافق على{" "}
            <a href="/terms" className="text-primary hover:underline">شروط الخدمة</a>
            {" "}و{" "}
            <a href="/privacy" className="text-primary hover:underline">سياسة الخصوصية</a>
          </p>

          <div className="mt-3 text-center text-sm text-muted-foreground">
            لديك حساب؟{" "}
            <a href="/login" className="text-primary font-medium hover:underline">تسجيل الدخول</a>
          </div>
        </div>
      </div>
    </div>
  );
}
