import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { AuthLayout } from "@/components/auth/WesalAuthLayout";

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
    <AuthLayout title="استعد حسابك بأمان وعد إلى عملك" subtitle="سنرسل رابطًا آمنًا إلى بريدك المسجل، ولن نكشف ما إذا كان البريد موجودًا حفاظًا على خصوصية حسابك." bullets={["رابط استعادة آمن ومحدود", "لا يتم تغيير أي بيانات دون تحقق", "يمكنك العودة للدعم عند الحاجة"]}>
      <div className="mb-6"><div className="mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold" style={{ borderColor: "var(--auth-line)", color: "var(--auth-secondary)", background: "rgba(34,211,238,.08)" }}><ShieldCheck className="h-3.5 w-3.5" /> استعادة آمنة</div><h1 className="text-3xl font-black tracking-tight">نسيت كلمة المرور؟</h1><p className="auth-soft mt-2 text-sm leading-6">أدخل بريدك الإلكتروني وسنرسل لك رابطًا لتعيين كلمة مرور جديدة.</p></div>
      <div className="auth-card rounded-[24px] p-5 sm:p-7">
        <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-blue-500/10 text-blue-400"><KeyRound className="h-5 w-5" /></div>
        {message && <div className="mb-4 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm font-medium text-emerald-300">{message}</div>}
        {error && <div className="mb-4 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm font-medium text-red-300">{error}</div>}
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
          <div><label htmlFor="forgot-email" className="mb-1.5 block text-xs font-bold">البريد الإلكتروني</label><div className="relative"><Mail className="auth-mute absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2" /><input id="forgot-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="auth-input ps-10 text-sm" placeholder="example@company.com" dir="ltr" autoComplete="email" required /></div></div>
          <button className="auth-primary h-12 w-full rounded-xl text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60" disabled={mutation.isPending}>{mutation.isPending ? "جار الإرسال..." : "إرسال رابط الاستعادة"}</button>
        </form>
        <a href="/login" className="auth-link mt-5 flex items-center justify-center gap-2 text-sm font-black"><ArrowRight className="h-4 w-4" /> العودة لتسجيل الدخول</a>
      </div>
    </AuthLayout>
  );
}
