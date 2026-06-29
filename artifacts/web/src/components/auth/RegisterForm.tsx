import { Building2, LockKeyhole, Mail, Phone, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { AuthField, AuthLayout, GoogleButton, OrDivider } from "@/components/auth/WesalAuthLayout";

export type RegisterState = {
  workspaceName: string;
  ownerName: string;
  email: string;
  password: string;
  phone: string;
  countryCode: string;
  website: string;
};

type Props = {
  form: RegisterState;
  setForm: (value: RegisterState) => void;
  error: string;
  pending: boolean;
  googleLoading: boolean;
  googleEnabled: boolean;
  showPassword: boolean;
  setShowPassword: (value: boolean) => void;
  onGoogle: () => void;
  onSubmit: (event: React.FormEvent) => void;
  codes: { code: string; label: string }[];
};

function StrengthBar({ password }: { password: string }) {
  const score = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  const labels = ["ضعيفة جداً", "ضعيفة", "متوسطة", "قوية", "قوية جداً"];
  const colors = ["#EF4444", "#F59E0B", "#F59E0B", "#22D3EE", "#10B981"];
  if (!password) return null;
  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5">
        {[0, 1, 2, 3].map((index) => <div key={index} className="h-1 flex-1 rounded-full transition-colors" style={{ background: index < score ? colors[score] : "var(--line)" }} />)}
      </div>
      <div className="mt-1 text-[11px] font-bold" style={{ color: colors[score] }}>قوة كلمة المرور: {labels[score]}</div>
    </div>
  );
}

export default function RegisterForm(props: Props) {
  const strong = props.form.password.length >= 8 && /[a-zA-Z]/.test(props.form.password) && /\d/.test(props.form.password);
  const set = (key: keyof RegisterState, value: string) => props.setForm({ ...props.form, [key]: value });

  return (
    <AuthLayout visualTitle="ابدأ بـ 14 يوم مجاناً - بدون بطاقة." visualSubtitle="أنشئ مساحة عملك واربط قنواتك في تجربة عربية موحّدة." visualBullets={["إعداد سريع بدون كود", "تكامل مع قنوات التواصل", "تحكم كامل في بيانات مساحة العمل"]}>
      <form onSubmit={props.onSubmit} dir="rtl">
        <input type="text" name="website" value={props.form.website} onChange={(event) => set("website", event.target.value)} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
        <div className="reveal in" style={{ animationDelay: ".05s" }}>
          <span className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: "rgba(34,211,238,0.15)", color: "var(--secondary)" }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--secondary)" }} />
            تجربة 14 يوم مجاناً
          </span>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-4xl">أنشئ حسابك في دقيقة</h1>
          <p className="text-soft mt-2 text-[14px]">ابدأ التجربة المجانية - بدون بطاقة ائتمان، إلغاء في أي وقت.</p>
        </div>
        {props.error && <div className="auth-message error mt-5">{props.error}</div>}
        {props.googleEnabled && (
          <>
            <div className="reveal in mt-7" style={{ animationDelay: ".15s" }}>
              <GoogleButton label="المتابعة باستخدام Google" onClick={props.onGoogle} loading={props.googleLoading} disabled={props.googleLoading || props.pending} />
            </div>
            <OrDivider label="أو سجّل بالبريد" />
          </>
        )}
        <div className="reveal in grid gap-4 sm:grid-cols-2" style={{ animationDelay: ".25s" }}>
          <AuthField id="reg-name" label="الاسم الكامل" required placeholder="أحمد السعدي" value={props.form.ownerName} onChange={(event) => set("ownerName", event.target.value)} icon={<UserRound />} />
          <AuthField id="reg-company" label="اسم الشركة" required placeholder="متجر لمسة" value={props.form.workspaceName} onChange={(event) => set("workspaceName", event.target.value)} icon={<Building2 />} />
        </div>
        <div className="reveal in mt-4" style={{ animationDelay: ".3s" }}>
          <AuthField id="reg-email" label="البريد الإلكتروني للعمل" type="email" autoComplete="email" required placeholder="ahmad@company.com" value={props.form.email} onChange={(event) => set("email", event.target.value)} icon={<Mail />} />
        </div>
        <div className="reveal in mt-4" style={{ animationDelay: ".33s" }}>
          <label htmlFor="reg-phone" className="mb-1.5 block text-[12.5px] font-bold">رقم الجوال <span className="text-mute font-normal">(اختياري)</span></label>
          <div className="flex gap-2" dir="ltr">
            <select value={props.form.countryCode} onChange={(event) => set("countryCode", event.target.value)} className="h-[46px] w-[118px] shrink-0 rounded-xl border border-line bg-[rgba(255,255,255,0.03)] px-2 text-sm outline-none" style={{ color: "var(--fg)" }}>
              {props.codes.map((country) => <option key={country.code} value={country.code}>{country.label}</option>)}
            </select>
            <div className="min-w-0 flex-1">
              <AuthField id="reg-phone" label="" type="tel" autoComplete="tel-national" placeholder="5xxxxxxxx" value={props.form.phone} onChange={(event) => set("phone", event.target.value)} icon={<Phone />} />
            </div>
          </div>
        </div>
        <div className="reveal in mt-4" style={{ animationDelay: ".35s" }}>
          <AuthField id="reg-password" label="كلمة المرور" type={props.showPassword ? "text" : "password"} autoComplete="new-password" required placeholder="8 أحرف على الأقل" value={props.form.password} onChange={(event) => set("password", event.target.value)} icon={<LockKeyhole />} hint="استخدم حروفاً وأرقاماً لزيادة القوة" />
          <StrengthBar password={props.form.password} />
        </div>
        <div className="reveal in mt-6" style={{ animationDelay: ".55s" }}>
          <button type="submit" disabled={props.pending || !strong} className={cn("btn-primary cta-pulse flex h-12 w-full items-center justify-center rounded-xl text-[14px] font-bold", (props.pending || !strong) && "cursor-not-allowed opacity-50")}>
            {props.pending ? "جار إنشاء الحساب..." : "إنشاء الحساب - ابدأ مجاناً"}
          </button>
        </div>
        <p className="text-mute reveal in mt-5 text-center text-[12.5px]" style={{ animationDelay: ".6s" }}>
          بإنشاء الحساب توافق على <a href="/terms" className="font-bold" style={{ color: "var(--primary-hi)" }}>الشروط والأحكام</a> و <a href="/privacy" className="font-bold" style={{ color: "var(--primary-hi)" }}>سياسة الخصوصية</a>
        </p>
        <p className="text-soft reveal in mt-4 text-center text-[13px]" style={{ animationDelay: ".65s" }}>
          لديك حساب بالفعل؟ <a href="/login" className="font-bold transition hover:opacity-80" style={{ color: "var(--primary-hi)" }}>سجّل دخولك</a>
        </p>
      </form>
    </AuthLayout>
  );
}
