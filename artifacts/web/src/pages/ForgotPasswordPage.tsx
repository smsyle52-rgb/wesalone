import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { AuthField, AuthLayout } from "@/components/auth/WesalAuthLayout";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/auth/forgot-password`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "تعذر إرسال رابط الاستعادة");
      return json;
    },
    onSuccess: (data) => { setError(""); setMessage(data.message ?? "إذا كان البريد مسجلاً فسيصلك رابط الاستعادة."); },
    onError: (err: Error) => { setMessage(""); setError(err.message); },
  });
  return (
    <AuthLayout visualTitle="استعد وصولك بأمان." visualSubtitle="إعادة التعيين تتم عبر رابط آمن يصل إلى بريدك المسجل." visualBullets={["طلب استعادة آمن", "لا يتم تغيير أي بيانات دون تحقق", "يمكنك العودة للدعم عند الحاجة"]}>
      <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }} dir="rtl">
        <div className="reveal in" style={{ animationDelay: ".05s" }}>
          <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">نسيت كلمة المرور؟</h1>
          <p className="text-soft mt-2 text-[14px] leading-relaxed">لا بأس - أدخل بريدك الإلكتروني وسنرسل لك رابطاً لإعادة تعيين كلمة المرور.</p>
        </div>
        {message && <div className="auth-message success mt-5">{message}</div>}
        {error && <div className="auth-message error mt-5">{error}</div>}
        <div className="reveal in mt-7" style={{ animationDelay: ".15s" }}>
          <AuthField id="forgot-email" label="البريد الإلكتروني" type="email" autoComplete="email" required placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} icon={<Mail />} />
        </div>
        <div className="reveal in mt-6" style={{ animationDelay: ".25s" }}>
          <button type="submit" disabled={mutation.isPending || !email} className="btn-primary cta-pulse flex h-12 w-full items-center justify-center rounded-xl text-[14px] font-bold disabled:cursor-not-allowed disabled:opacity-50">
            {mutation.isPending ? "جار الإرسال..." : "إرسال رابط إعادة التعيين"}
          </button>
        </div>
        <div className="reveal in mt-6 text-center" style={{ animationDelay: ".35s" }}>
          <a href="/login" className="text-soft inline-flex items-center gap-1.5 text-[13px] transition hover:text-[color:var(--fg)]">
            العودة لتسجيل الدخول
          </a>
        </div>
      </form>
    </AuthLayout>
  );
}
