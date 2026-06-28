import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { AuthLayout, GoogleIcon } from "@/components/auth/WesalAuthLayout";

declare global { interface Window { google?: { accounts: { id: { initialize: (cfg: object) => void; prompt: () => void; }; }; }; } }

export default function LoginPage() {
  const [, navigate] = useLocation();
  const { setAuth } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";

  const loginMut = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(data) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "خطأ في تسجيل الدخول");
      return json;
    },
    onSuccess: (data) => {
      setAuth({ id: data.user.id, name: data.user.name, email: data.user.email, emailVerified: data.user.emailVerified, permissions: data.user.permissions ?? [], roleSlugs: data.user.roleSlugs ?? [] }, data.workspaceId ?? "");
      navigate("/dashboard");
    },
    onError: (e: Error) => setError(e.message),
  });

  async function handleGoogleResponse(credential: string) {
    setGoogleLoading(true); setError("");
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/auth/google`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ credential }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "خطأ في تسجيل الدخول بـGoogle");
      setAuth({ id: data.user.id, name: data.user.name, email: data.user.email, emailVerified: data.user.emailVerified ?? true, permissions: data.user.permissions ?? [], roleSlugs: data.user.roleSlugs ?? [] }, data.workspaceId ?? "", { onboardingCompleted: !data.isNewUser });
      navigate(data.isNewUser ? "/onboarding" : "/dashboard");
    } catch (e) { setError((e as Error).message); } finally { setGoogleLoading(false); }
  }

  function triggerGoogleSignIn() {
    if (!GOOGLE_CLIENT_ID) { setError("تسجيل الدخول بـGoogle غير مهيأ."); return; }
    const init = () => { window.google?.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r: { credential: string }) => handleGoogleResponse(r.credential) }); window.google?.accounts.id.prompt(); };
    if (window.google) { init(); return; }
    const script = document.createElement("script"); script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.defer = true; script.onload = init; document.head.appendChild(script);
  }

  function submit(e: React.FormEvent) { e.preventDefault(); setError(""); loginMut.mutate(form); }

  return <AuthLayout title="كل محادثات عملائك، وفريقك، ووكلائك الأذكياء في مكان واحد" subtitle="ادخل إلى مساحة عملك وتابع المحادثات والطلبات والأتمتة من لوحة عربية مصممة لتسريع العمل." bullets={["صندوق وارد موحّد لكل القنوات", "وكلاء ذكاء اصطناعي يعملون 24/7", "تحويل سلس للموظف عند الحاجة"]}>
    <div className="mb-6"><div className="mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold" style={{ borderColor: "var(--auth-line)", color: "var(--auth-secondary)", background: "rgba(34,211,238,.08)" }}><Sparkles className="h-3.5 w-3.5"/>أهلاً بعودتك</div><h1 className="text-3xl font-black tracking-tight">تسجيل الدخول</h1><p className="auth-soft mt-2 text-sm leading-6">أدخل بياناتك للعودة إلى مساحة عمل وصال ون.</p></div>
    <div className="auth-card rounded-[24px] p-5 sm:p-7">
      {error && <div className="mb-4 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-center text-sm font-medium text-red-300">{error}</div>}
      {GOOGLE_CLIENT_ID && <><button type="button" onClick={triggerGoogleSignIn} disabled={googleLoading || loginMut.isPending} className="auth-secondary-button flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold disabled:opacity-60">{googleLoading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"/> : <GoogleIcon/>}المتابعة باستخدام Google</button><div className="auth-mute my-5 flex items-center gap-3 text-[11px]"><div className="auth-divider h-px flex-1"/><span>أو بالبريد الإلكتروني</span><div className="auth-divider h-px flex-1"/></div></>}
      <form onSubmit={submit} className="space-y-4">
        <div><label htmlFor="login-email" className="mb-1.5 block text-xs font-bold">البريد الإلكتروني</label><div className="relative"><Mail className="auth-mute absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2"/><input id="login-email" name="email" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} className="auth-input ps-10 text-sm" placeholder="example@company.com" autoComplete="email" required dir="ltr"/></div></div>
        <div><div className="mb-1.5 flex items-center justify-between"><label htmlFor="login-password" className="text-xs font-bold">كلمة المرور</label><a href="/forgot-password" className="auth-link text-[11px] font-bold">نسيت كلمة المرور؟</a></div><div className="relative"><LockKeyhole className="auth-mute absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2"/><input id="login-password" name="password" type={showPassword?"text":"password"} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} className="auth-input px-10 text-sm" placeholder="••••••••" autoComplete="current-password" required dir="ltr"/><button type="button" onClick={()=>setShowPassword(v=>!v)} className="auth-mute absolute end-3 top-1/2 -translate-y-1/2 p-1" aria-label={showPassword?"إخفاء كلمة المرور":"إظهار كلمة المرور"}>{showPassword?<EyeOff className="h-4 w-4"/>:<Eye className="h-4 w-4"/>}</button></div></div>
        <button type="submit" disabled={loginMut.isPending} className={cn("auth-primary h-12 w-full rounded-xl text-sm font-black",loginMut.isPending&&"cursor-not-allowed opacity-60")}>{loginMut.isPending?"جار التحقق...":"تسجيل الدخول"}</button>
      </form>
      <p className="auth-soft mt-5 text-center text-sm">ليس لديك حساب؟ <a href="/register" className="auth-link font-black">ابدأ مجاناً</a></p>
    </div>
  </AuthLayout>;
}
