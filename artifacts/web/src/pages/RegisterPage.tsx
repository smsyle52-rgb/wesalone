import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { normalizeOnboardingStatus, routeForOnboardingStatus } from "@/lib/onboarding";
import RegisterForm, { type RegisterState } from "@/components/auth/RegisterForm";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: object) => void;
          prompt: () => void;
        };
      };
    };
  }
}

const CODES = [
  { code: "+967", label: "اليمن +967" },
  { code: "+966", label: "السعودية +966" },
  { code: "+971", label: "الإمارات +971" },
  { code: "+965", label: "الكويت +965" },
  { code: "+973", label: "البحرين +973" },
  { code: "+974", label: "قطر +974" },
  { code: "+968", label: "عُمان +968" },
  { code: "+962", label: "الأردن +962" },
  { code: "+963", label: "سوريا +963" },
  { code: "+961", label: "لبنان +961" },
  { code: "+20", label: "مصر +20" },
  { code: "+1", label: "أمريكا +1" },
  { code: "+44", label: "بريطانيا +44" },
];

function phone(code: string, local: string) {
  const digits = local.replace(/\D/g, "");
  return digits ? `${code}${digits.replace(/^0+/, "")}` : "";
}

export default function RegisterPage() {
  const [, navigate] = useLocation();
  const { setAuth } = useAuth();
  const [form, setForm] = useState<RegisterState>({
    workspaceName: "",
    ownerName: "",
    email: "",
    password: "",
    phone: "",
    countryCode: "+967",
    website: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";

  const mutation = useMutation({
    mutationFn: async (data: RegisterState) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          workspaceName: data.workspaceName,
          ownerName: data.ownerName,
          email: data.email,
          password: data.password,
          phone: phone(data.countryCode, data.phone) || undefined,
          website: data.website,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "خطأ في إنشاء الحساب");
      return json;
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
        },
        data.workspaceId ?? data.workspace?.id ?? "",
        { onboardingStatus, onboardingCompleted: data.onboardingCompleted === true },
      );
      navigate(routeForOnboardingStatus(onboardingStatus));
    },
    onError: (e: Error) => setError(e.message),
  });

  async function google(credential: string) {
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
      const onboardingStatus = normalizeOnboardingStatus(data.onboardingStatus, data.onboardingCompleted === true);
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
        { onboardingStatus, onboardingCompleted: data.onboardingCompleted === true },
      );
      navigate(routeForOnboardingStatus(onboardingStatus));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGoogleLoading(false);
    }
  }

  function startGoogle() {
    if (!clientId) {
      setError("تسجيل الدخول بـGoogle غير مهيأ بعد.");
      return;
    }
    const init = () => {
      window.google?.accounts.id.initialize({
        client_id: clientId,
        callback: (r: { credential: string }) => google(r.credential),
      });
      window.google?.accounts.id.prompt();
    };
    if (window.google) {
      init();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = init;
    document.head.appendChild(script);
  }

  return (
    <RegisterForm
      form={form}
      setForm={setForm}
      error={error}
      pending={mutation.isPending}
      googleLoading={googleLoading}
      googleEnabled
      showPassword={showPassword}
      setShowPassword={setShowPassword}
      onGoogle={startGoogle}
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        mutation.mutate(form);
      }}
      codes={CODES}
    />
  );
}
