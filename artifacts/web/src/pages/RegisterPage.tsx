import { useCallback, useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { normalizeOnboardingStatus, routeForOnboardingStatus } from "@/lib/onboarding";
import RegisterForm, { type RegisterState } from "@/components/auth/RegisterForm";
import { readAuthResponse } from "@/lib/authResponse";
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
  workspace?: { id?: string };
  onboardingStatus?: unknown;
  onboardingCompleted?: boolean;
};

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
  const handleGoogleError = useCallback((message: string) => setError(message), []);

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
      return readAuthResponse<AuthPayload>(res, "تعذر إنشاء الحساب. تحقق من البيانات أو حاول لاحقًا.");
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
        data.workspaceId ?? data.workspace?.id ?? "",
        { onboardingStatus, onboardingCompleted: data.onboardingCompleted === true },
      );
      navigate(routeForOnboardingStatus(onboardingStatus));
    },
    onError: (e: Error) => setError(e.message),
  });

  const handleGoogleCredential = useCallback(async (credential: string) => {
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
          emailVerified: data.user.emailVerified,
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

  return (
    <RegisterForm
      form={form}
      setForm={setForm}
      error={error}
      pending={mutation.isPending}
      googleLoading={googleLoading}
      showPassword={showPassword}
      setShowPassword={setShowPassword}
      googleSlot={(
        <GoogleIdentityButton
          label="التسجيل بحساب Google"
          text="signup_with"
          busy={googleLoading}
          disabled={mutation.isPending}
          onCredential={handleGoogleCredential}
          onError={handleGoogleError}
        />
      )}
      onSubmit={(e) => {
        e.preventDefault();
        if (mutation.isPending || googleLoading) return;
        setError("");
        mutation.mutate(form);
      }}
      codes={CODES}
    />
  );
}
