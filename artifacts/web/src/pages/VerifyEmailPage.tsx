import { useEffect, useMemo, useState } from "react";

export default function VerifyEmailPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get("token") ?? "", []);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("جار تأكيد البريد...");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("رابط التحقق غير صالح.");
      return;
    }
    fetch(`${import.meta.env.BASE_URL}api/auth/verify-email?token=${encodeURIComponent(token)}`, { credentials: "include" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "تعذر تأكيد البريد");
        setStatus("success");
        setMessage(json.message ?? "تم تأكيد البريد الإلكتروني بنجاح.");
      })
      .catch((err: Error) => {
        setStatus("error");
        setMessage(err.message);
      });
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10 p-4" dir="rtl">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <div className={`mx-auto mb-4 h-12 w-12 rounded-full ${status === "success" ? "bg-green-100" : status === "error" ? "bg-red-100" : "bg-primary/10"}`} />
        <h1 className="text-xl font-bold text-foreground">تأكيد البريد الإلكتروني</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <a href="/dashboard" className="mt-5 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          الذهاب إلى لوحة التحكم
        </a>
      </div>
    </div>
  );
}
