import { useCallback, useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { LockKeyhole, Mail } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { normalizeOnboardingStatus, routeForOnboardingStatus } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { readAuthResponse } from "@/lib/authResponse";
import { AuthField, AuthLayout, OrDivider } from "@/components/auth/WesalAuthLayout";
import GoogleIdentityButton from "@/components/auth/GoogleIdentityButton";

type AuthPayload = {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified?: boolean;
    permissions?: string[];
    roleSlugs?: string[];
    isPlatformAdmin?: boolean;
  };
  workspaceId?: string;
  onboardingStatus?: unknown;
  onboardingCompleted?: boolean;
};

export default function LoginPage() {
  const [, navigate] = useLocation();
  const { setAuth } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword] = useState(false);
  const [error, setError] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const handleGoogleError = useCallback((message: string) => setError(message), []);

  const loginMut = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      return readAuthResponse<AuthPayload>(res, "تعذر تسجيل الدخول. تحقق من البيانات أو حاول لاحقًا.");
    },
    onSuccess: (data) => {
      const onboardingStatus = normalizeOnboardingStatus(data.onboardingStatus, data.onboardingCompleted === true);
      setAuth(
        {
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          emailVerified: data.user.emailVerified,
          permissions: data.user.permissions ?? [],
          roleSlugs: data.user.roleSlugs ?? [],
          isPlatformAdmin: data.user.isPlatformAdmin === true,
        },
        data.workspaceId ?? "",
        { onboardingStatus, onboardingCompleted: data.onboardingCompleted === true },
      );
      navigate(routeForOnboardingStatus(onboardingStatus));
    },
    onError: (e: Error) => setError(e.message),
  });

  const handleGoogleResponse = useCallback(async (credential: string) => {
    setGoogleLoading(true);
    setError("");
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ credential }),
      });
      const data = await readAuthResponse<any>(res, "تعذر تسجيل الدخول بحساب Google. حاول مرة أخرى.");
      const onboardingStatus = normalizeOnboardingStatus(data.onboardingStatus, data.onboardingCompleted === true);
      setAuth(
        {
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          emailVerified: data.user.emailVerified ?? true,
          permissions: data.user.permissions ?? [],
          roleSlugs: data.user.roleSlugs ?? [],
          isPlatformAdmin: data.user.isPlatformAdmin === true,
        },
        data.workspaceId ?? "",
        { onboardingStatus, onboardingCompleted: data.onboardingCompleted === true },
      );
      navigate(routeForOnboardingStatus(onboardingStatus));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGoogleLoading(false);
    }
  }, [navigate, setAuth]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loginMut.isPending || googleLoading) return;
    setError("");
    loginMut.mutate(form);
  }

  return (
    <AuthLayout
      visualTitle="منصة موحّدة لمحادثات عملائك."
      visualSubtitle="أدر واتساب، إنستغرام، ماسنجر، وتيليجرام من لوحة تحكم واحدة."
      visualBullets={["صندوق وارد موحّد", "تقارير حيّة وقابلة للتصدير", "أمان وخصوصية على أعلى مستوى"]}
    >
      <form onSubmit={submit} dir="rtl">
        <div className="reveal in" style={{ animationDelay: ".05s" }}>
          <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">مرحباً بعودتك</h1>
          <p className="text-soft mt-2 text-[14px]">سجّل دخولك للوصول إلى صندوق محادثاتك.</p>
        </div>
        {error && <div className="auth-message error mt-5">{error}</div>}
        <div className="reveal in mt-7" style={{ animationDelay: ".15s" }}>
          <GoogleIdentityButton
            label="الدخول بحساب Google"
            text="signin_with"
            busy={googleLoading}
            disabled={loginMut.isPending}
            onCredential={handleGoogleResponse}
            onError={handleGoogleError}
          />
        </div>
        <OrDivider label="أو سجّل دخولك بالبريد" />
        <div className="reveal in space-y-4" style={{ animationDelay: ".25s" }}>
          <AuthField id="login-email" label="البريد الإلكتروني" type="email" autoComplete="email" required placeholder="you@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} icon={<Mail />} />
          <div>
            <AuthField id="login-password" label="كلمة المرور" type={showPassword ? "text" : "password"} autoComplete="current-password" required placeholder="........" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} icon={<LockKeyhole />} />
            <div className="mt-3 flex justify-end text-[12.5px]">
              <a href="/forgot-password" className="font-bold transition hover:opacity-80" style={{ color: "var(--secondary)" }}>نسيت كلمة المرور؟</a>
            </div>
          </div>
        </div>
        <div className="reveal in mt-6" style={{ animationDelay: ".45s" }}>
          <button type="submit" disabled={loginMut.isPending} className={cn("btn-primary cta-pulse flex h-12 w-full items-center justify-center rounded-xl text-[14px] font-bold", loginMut.isPending && "cursor-not-allowed opacity-70")}>
            {loginMut.isPending ? "جار التحقق..." : "تسجيل الدخول"}
          </button>
        </div>
        <p className="text-soft reveal in mt-6 text-center text-[13px]" style={{ animationDelay: ".55s" }}>
          ليس لديك حساب؟ <a href="/register" className="font-bold transition hover:opacity-80" style={{ color: "var(--primary-hi)" }}>أنشئ حساباً مجاناً</a>
        </p>
      </form>
    </AuthLayout>
  );
}
