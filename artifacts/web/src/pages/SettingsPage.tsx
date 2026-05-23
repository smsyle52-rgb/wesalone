import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { PaymentMethodsTab } from "@/components/settings/PaymentMethodsTab";
import { ExchangeRatesTab } from "@/components/settings/ExchangeRatesTab";

const BASE = `${import.meta.env.BASE_URL}api`;
const apiFetch = async (path: string, opts?: RequestInit) => {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const text = await res.text();
    try { const j = JSON.parse(text); throw new Error(j.error ?? text); } catch { throw new Error(text); }
  }
  return res.json();
};

type Tab =
  | "workspace"
  | "users"
  | "invite"
  | "business-hours"
  | "sla"
  | "quick-replies"
  | "payment-methods"
  | "exchange-rates"
  | "notifications"
  | "security"
  | "billing"
  | "api-keys"
  | "danger";

function PasswordInput({ id, name, label, value, onChange, placeholder, autoComplete = "new-password" }: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1">{label}</label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 pe-10"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
          className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
          tabIndex={-1}
        >
          {show ? "🙈" : "👁"}
        </button>
      </div>
    </div>
  );
}

function WorkspaceTab() {
  const { user, hasPermission } = useAuth();
  const qc = useQueryClient();
  const canManage = hasPermission("settings:manage");

  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const { data: workspaceData, isLoading } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiFetch("workspace"),
  });

  const workspace = workspaceData?.workspace;

  useEffect(() => {
    if (workspace?.name) setNameInput(workspace.name);
  }, [workspace?.name]);

  const updateMut = useMutation({
    mutationFn: (body: { name: string }) =>
      apiFetch("workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      qc.setQueryData(["workspace"], data);
      setEditing(false);
      setSuccessMsg("تم حفظ التغييرات بنجاح");
      setTimeout(() => setSuccessMsg(""), 4000);
    },
  });

  const handleCancel = () => {
    setEditing(false);
    setNameInput(workspace?.name ?? "");
    updateMut.reset();
  };

  const handleSave = () => {
    if (!nameInput.trim()) return;
    updateMut.mutate({ name: nameInput.trim() });
  };

  return (
    <div className="max-w-lg space-y-4">
      {successMsg && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✓ {successMsg}</div>
      )}
      {updateMut.isError && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {(updateMut.error as Error).message}
        </div>
      )}
      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <div>
          <label htmlFor="workspace-name" className="block text-sm font-medium text-muted-foreground mb-1">اسم المنشأة / مساحة العمل</label>
          {editing ? (
            <input
              id="workspace-name"
              name="workspaceName"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") handleCancel(); }}
              autoFocus
              maxLength={100}
              className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          ) : (
            <div className="px-3 py-2.5 rounded-lg border border-input bg-muted/30 text-foreground text-sm">
              {isLoading ? "جار التحميل..." : (workspace?.name ?? "—")}
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">الباقة الحالية</label>
          <div className="px-3 py-2.5 rounded-lg border border-input bg-muted/30 text-foreground text-sm">
            {workspace?.plan ?? "تجريبي"}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">حسابك</label>
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-input bg-muted/30">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0">
              {user?.name?.[0] ?? "؟"}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{user?.name}</div>
              <div className="text-xs text-muted-foreground" dir="ltr">{user?.email}</div>
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">صلاحياتك</label>
          <div className="flex flex-wrap gap-1.5">
            {user?.roleSlugs?.map((role) => (
              <span key={role} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">{role}</span>
            ))}
          </div>
        </div>
        {editing ? (
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={!nameInput.trim() || nameInput.trim() === workspace?.name || updateMut.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {updateMut.isPending ? "جار الحفظ..." : "حفظ التغييرات"}
            </button>
            <button
              onClick={handleCancel}
              disabled={updateMut.isPending}
              className="px-4 py-2 border border-border text-sm font-medium rounded-lg hover:bg-muted transition-colors"
            >
              إلغاء
            </button>
          </div>
        ) : (
          <div className="pt-1">
            {canManage ? (
              <button
                onClick={() => { setEditing(true); updateMut.reset(); setSuccessMsg(""); }}
                className="px-4 py-2 border border-border text-sm font-medium rounded-lg hover:bg-muted transition-colors"
              >
                تعديل المعلومات
              </button>
            ) : (
              <button
                disabled
                title="لا تملك صلاحية تعديل إعدادات المنشأة"
                className="px-4 py-2 border border-border text-sm font-medium rounded-lg text-muted-foreground opacity-50 cursor-not-allowed"
              >
                تعديل المعلومات
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SecurityTab() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [successMsg, setSuccessMsg] = useState("");

  const set = (field: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [field]: v }));

  const clientError = (() => {
    if (form.newPassword && form.newPassword.length < 8) return "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل";
    if (form.confirmPassword && form.newPassword !== form.confirmPassword) return "كلمتا المرور غير متطابقتين";
    if (form.newPassword && form.currentPassword && form.newPassword === form.currentPassword)
      return "لا يمكن استخدام كلمة المرور الحالية ككلمة مرور جديدة";
    return null;
  })();

  const changeMut = useMutation({
    mutationFn: (body: object) =>
      apiFetch("auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setSuccessMsg("تم تغيير كلمة المرور بنجاح");
      setTimeout(() => setSuccessMsg(""), 5000);
    },
  });

  const handleSubmit = () => {
    if (clientError) return;
    changeMut.reset();
    setSuccessMsg("");
    changeMut.mutate({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
      confirmPassword: form.confirmPassword,
    });
  };

  const canSubmit =
    form.currentPassword.length > 0 &&
    form.newPassword.length >= 8 &&
    form.confirmPassword.length > 0 &&
    !clientError &&
    !changeMut.isPending;

  return (
    <div className="max-w-md space-y-4">
      {successMsg && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✓ {successMsg}</div>
      )}
      {changeMut.isError && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {(changeMut.error as Error).message}
        </div>
      )}
      {clientError && (form.newPassword || form.confirmPassword) && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">{clientError}</div>
      )}

      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">تغيير كلمة المرور</h3>
        <PasswordInput
          id="current-password"
          name="currentPassword"
          label="كلمة المرور الحالية"
          value={form.currentPassword}
          onChange={set("currentPassword")}
          placeholder="أدخل كلمة المرور الحالية"
          autoComplete="current-password"
        />
        <PasswordInput
          id="new-password"
          name="newPassword"
          label="كلمة المرور الجديدة"
          value={form.newPassword}
          onChange={set("newPassword")}
          placeholder="8 أحرف على الأقل"
        />
        <PasswordInput
          id="confirm-password"
          name="confirmPassword"
          label="تأكيد كلمة المرور الجديدة"
          value={form.confirmPassword}
          onChange={set("confirmPassword")}
          placeholder="أعد إدخال كلمة المرور الجديدة"
        />
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {changeMut.isPending ? "جار التغيير..." : "تغيير كلمة المرور"}
        </button>
        <p className="text-xs text-muted-foreground">
          ستبقى جلستك الحالية فعّالة بعد تغيير كلمة المرور.
        </p>
      </div>
    </div>
  );
}

function BusinessHoursTab() {
  const days = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const defaults = days.map((_, dayOfWeek) => ({ dayOfWeek, openTime: "09:00", closeTime: "17:00", isClosed: dayOfWeek === 5, timezone: "Asia/Aden" }));
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["business-hours"], queryFn: () => apiFetch("business-hours") });
  const current = days.map((_, dayOfWeek) => data?.businessHours?.find((d: any) => d.dayOfWeek === dayOfWeek) ?? defaults[dayOfWeek]);
  const save = useMutation({
    mutationFn: () => apiFetch("business-hours", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: current }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["business-hours"] }),
  });
  return (
    <div className="max-w-3xl space-y-3">
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? <div className="p-6 text-sm text-muted-foreground">جار التحميل...</div> : current.map((day, index) => (
          <div key={day.dayOfWeek} className="grid grid-cols-4 gap-3 items-center p-3 border-b border-border/50 last:border-0 text-sm">
            <div className="font-medium">{days[index]}</div>
            <div>{day.isClosed ? "مغلق" : `${day.openTime} - ${day.closeTime}`}</div>
            <div className="text-muted-foreground">{day.timezone}</div>
            <div className="text-xs text-muted-foreground">تعديل الجدول التفصيلي محفوظ للمرحلة القادمة</div>
          </div>
        ))}
      </div>
      <button onClick={() => save.mutate()} disabled={save.isPending} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">حفظ الجدول الافتراضي</button>
    </div>
  );
}

function SlaRulesTab() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "قاعدة الرد الأولى", firstResponseMinutes: 30, resolutionMinutes: 1440 });
  const { data, isLoading } = useQuery({ queryKey: ["sla-rules"], queryFn: () => apiFetch("sla-rules") });
  const create = useMutation({
    mutationFn: () => apiFetch("sla-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, active: true }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sla-rules"] }),
  });
  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4">
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? <div className="p-6 text-sm text-muted-foreground">جار التحميل...</div> : !(data?.slaRules ?? []).length ? (
          <div className="p-8 text-sm text-muted-foreground text-center">لا توجد قواعد استجابة بعد</div>
        ) : data.slaRules.map((rule: any) => (
          <div key={rule.id} className="p-4 border-b border-border/50 last:border-0">
            <div className="font-medium">{rule.name}</div>
            <div className="text-xs text-muted-foreground mt-1">مهلة الرد: {rule.firstResponseMinutes} دقيقة · الحل: {rule.resolutionMinutes ?? "غير محدد"} دقيقة</div>
          </div>
        ))}
      </div>
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold">قاعدة جديدة</h3>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" />
        <input type="number" value={form.firstResponseMinutes} onChange={(e) => setForm({ ...form, firstResponseMinutes: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" />
        <button onClick={() => create.mutate()} disabled={create.isPending} className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">حفظ</button>
      </div>
    </div>
  );
}

function QuickRepliesTab() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ shortcut: "/hello", title: "", body: "" });
  const { data, isLoading } = useQuery({ queryKey: ["quick-replies"], queryFn: () => apiFetch("quick-replies") });
  const create = useMutation({
    mutationFn: () => apiFetch("quick-replies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["quick-replies"] }); setForm({ shortcut: "/hello", title: "", body: "" }); },
  });
  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-4">
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? <div className="p-6 text-sm text-muted-foreground">جار التحميل...</div> : !(data?.quickReplies ?? []).length ? (
          <div className="p-8 text-sm text-muted-foreground text-center">لا توجد ردود سريعة بعد</div>
        ) : data.quickReplies.map((reply: any) => (
          <div key={reply.id} className="p-4 border-b border-border/50 last:border-0">
            <div className="font-medium">{reply.shortcut} · {reply.title}</div>
            <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{reply.body}</div>
          </div>
        ))}
      </div>
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold">رد سريع جديد</h3>
        <input value={form.shortcut} onChange={(e) => setForm({ ...form, shortcut: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" />
        <input placeholder="العنوان" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" />
        <textarea rows={4} placeholder="نص الرد" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none" />
        <button onClick={() => create.mutate()} disabled={create.isPending || !form.title || !form.body} className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">حفظ</button>
      </div>
    </div>
  );
}

function NotificationsTab() {
  const qc = useQueryClient();
  const [events, setEvents] = useState(["message.received", "sla.breached"]);
  const { data } = useQuery({ queryKey: ["notification-preferences"], queryFn: () => apiFetch("workspace/notification-preferences") });
  const save = useMutation({
    mutationFn: () => apiFetch("workspace/notification-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: [{ channel: "in_app", events }] }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });
  return (
    <div className="max-w-xl bg-card rounded-xl border border-border p-5 space-y-4">
      <h3 className="text-sm font-semibold">التنبيهات</h3>
      <p className="text-sm text-muted-foreground">هذه الإعدادات تُحفظ الآن، وتسليم التنبيهات الفعلي مؤجل لمرحلة لاحقة.</p>
      <div className="text-xs text-muted-foreground">الحالي: {(data?.preferences ?? []).map((p: any) => `${p.channel}: ${p.events?.length ?? 0}`).join(" · ") || "لا يوجد"}</div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={events.includes("message.received")} onChange={(e) => setEvents(e.target.checked ? [...events, "message.received"] : events.filter((x) => x !== "message.received"))} /> رسائل جديدة</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={events.includes("sla.breached")} onChange={(e) => setEvents(e.target.checked ? [...events, "sla.breached"] : events.filter((x) => x !== "sla.breached"))} /> تجاوز مهلة الرد</label>
      <button onClick={() => save.mutate()} disabled={save.isPending} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">حفظ</button>
    </div>
  );
}

function BillingTabV2() {
  const qc = useQueryClient();
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly");
  const [currency, setCurrency] = useState<"USD" | "YER" | "SAR">("YER");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("kuraimi");
  const [amountYer, setAmountYer] = useState("");
  const [reference, setReference] = useState("");
  const [receiptNote, setReceiptNote] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["billing", currency], queryFn: () => apiFetch(`workspace/billing?currency=${currency}`) });
  const submitPayment = useMutation({
    mutationFn: () => apiFetch("workspace/billing/payment-submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId: selectedPlanId || selectedPlan?.id,
        amountYer,
        amountCurrency: currency,
        exchangeRateSnapshot: selectedPlan ? (billingCycle === "annual" ? selectedPlan.displayPriceAnnual : selectedPlan.displayPriceMonthly) : null,
        paymentMethod,
        reference: reference || null,
        receiptNote: receiptNote || null,
      }),
    }),
    onSuccess: () => {
      setReference("");
      setReceiptNote("");
      qc.invalidateQueries({ queryKey: ["billing"] });
    },
  });

  const plans = data?.plans ?? [];
  const current = data?.subscription;
  const limits = current?.limits ?? {};
  const usage = data?.usage ?? {};
  const selectedPlan = plans.find((plan: any) => plan.id === selectedPlanId) ?? plans.find((plan: any) => (plan.key ?? plan.slug) !== "trial") ?? plans[0];
  const selectedDisplay = selectedPlan ? (billingCycle === "annual" ? selectedPlan.displayPriceAnnual : selectedPlan.displayPriceMonthly) : null;
  const featureLabels: Record<string, string> = {
    inbox: "صندوق وارد موحد",
    ai_agent: "وكيل ذكي",
    catalog: "كتالوج المنتجات",
    basic_automation: "أتمتة أساسية",
    automation: "أتمتة متقدمة",
    campaigns: "حملات ورسائل",
    analytics: "تقارير أساسية",
    advanced_analytics: "تحليلات متقدمة",
    vision_voice: "فهم الصور والصوت",
    everything: "كل مزايا المنصة",
    priority_support: "دعم أولوية",
  };
  const limitLabels: Record<string, string> = {
    channels: "القنوات",
    agents: "الوكلاء",
    monthly_messages: "الرسائل الشهرية",
    team_members: "أعضاء الفريق",
    contacts: "جهات الاتصال",
  };
  const prettyLimit = (value: unknown) => {
    if (value === "all" || value === "unlimited" || value === -1) return "غير محدود";
    return typeof value === "number" ? value.toLocaleString("ar") : String(value ?? "غير محدود");
  };

  function limitValue(key: string) {
    const value = limits?.[key];
    return typeof value === "number" && value >= 0 ? value : null;
  }

  function progress(currentValue: number, limit: number | null) {
    if (!limit) return 0;
    return Math.min(100, Math.round((currentValue / limit) * 100));
  }

  const usageRows = [
    { label: "الرسائل هذا الشهر", value: usage.messagesSent ?? 0, limit: limitValue("monthly_messages") },
    { label: "الوكلاء", value: usage.agents ?? 0, limit: limitValue("agents") },
    { label: "جهات الاتصال", value: usage.contacts ?? 0, limit: limitValue("contacts") },
    { label: "أعضاء الفريق", value: usage.teamMembers ?? 0, limit: limitValue("team_members") },
  ];

  if (isLoading) return <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">جار تحميل بيانات الفوترة...</div>;

  return (
    <div className="space-y-6">
      {(data?.limitWarnings ?? []).length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          وصلت حد باقتك في بعض الموارد. يمكنك الاستمرار في متابعة بياناتك، ولإضافة موارد جديدة يرجى ترقية الباقة.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <section className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
          <p className="text-sm font-bold text-primary">الباقة الحالية</p>
          <h3 className="mt-2 text-3xl font-black text-foreground">{current?.planNameAr ?? current?.planName ?? "تجربة مجانية"}</h3>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-primary/10 px-3 py-1 font-bold text-primary">{current?.status ?? "trialing"}</span>
            {current?.trialEndsAt && <span className="rounded-full bg-secondary px-3 py-1 text-muted-foreground">تنتهي التجربة: {new Date(current.trialEndsAt).toLocaleDateString("ar")}</span>}
            {current?.currentPeriodEnd && <span className="rounded-full bg-secondary px-3 py-1 text-muted-foreground">نهاية الفترة: {new Date(current.currentPeriodEnd).toLocaleDateString("ar")}</span>}
          </div>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">الفوترة في وصال ون يدوية ومناسبة للسوق اليمني. لا يوجد خصم تلقائي أو بوابة دفع في هذه المرحلة، وكل طلب دفع تتم مراجعته قبل تفعيل الباقة.</p>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
          <h3 className="text-lg font-extrabold text-foreground">الاستخدام الحالي</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {usageRows.map((row) => (
              <div key={row.label} className="rounded-lg border border-border/60 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-bold text-foreground">{row.label}</span>
                  <span className="text-muted-foreground">{row.value} / {row.limit ?? "غير محدود"}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${progress(row.value, row.limit)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold text-foreground">الباقات</h3>
            <p className="mt-1 text-sm text-muted-foreground">الأسعار تقرأ من قاعدة البيانات ويمكن تعديلها بدون تغيير الكود.</p>
          </div>
          <div className="rounded-lg border border-border bg-secondary p-1 text-sm">
            <button className={`rounded-md px-3 py-1.5 ${billingCycle === "monthly" ? "bg-card shadow-sm" : ""}`} onClick={() => setBillingCycle("monthly")}>شهري</button>
            <button className={`rounded-md px-3 py-1.5 ${billingCycle === "annual" ? "bg-card shadow-sm" : ""}`} onClick={() => setBillingCycle("annual")}>سنوي</button>
          </div>
          <div className="rounded-lg border border-border bg-secondary p-1 text-sm">
            {(["YER", "SAR", "USD"] as const).map((item) => (
              <button key={item} className={`rounded-md px-3 py-1.5 ${currency === item ? "bg-card shadow-sm" : ""}`} onClick={() => setCurrency(item)}>
                {item === "YER" ? "﷼ يمني" : item === "SAR" ? "﷼ سعودي" : "USD"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-4">
          {plans.map((plan: any) => {
            const display = billingCycle === "annual" ? plan.displayPriceAnnual : plan.displayPriceMonthly;
            const price = display?.amount ?? 0;
            const active = current?.planId === plan.id;
            return (
              <button key={plan.id} type="button" onClick={() => { setSelectedPlanId(plan.id); setAmountYer(String(price ?? "")); }} className={`rounded-xl border p-4 text-start transition hover:-translate-y-1 hover:shadow-lg ${selectedPlanId === plan.id ? "border-accent ring-2 ring-accent/20" : active ? "border-primary" : "border-border"}`}>
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-lg font-black text-foreground">{plan.nameAr ?? plan.name}</h4>
                  {active && <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">حالية</span>}
                </div>
                <div className="mt-3 text-2xl font-black text-primary">{Number(price ?? 0).toLocaleString("ar")} <span className="text-xs text-muted-foreground">ريال</span></div>
                {billingCycle === "annual" && <p className="mt-1 text-xs font-bold text-accent">خصم سنوي تقريبي 20%</p>}
                <ul className="mt-4 space-y-2 text-xs text-muted-foreground">
                  <li>القنوات: {plan.limits?.channels ?? "غير محدود"}</li>
                  <li>الوكلاء: {plan.limits?.agents ?? "غير محدود"}</li>
                  <li>الرسائل الشهرية: {plan.limits?.monthly_messages?.toLocaleString?.("ar") ?? "غير محدود"}</li>
                  <li>جهات الاتصال: {plan.limits?.contacts?.toLocaleString?.("ar") ?? "غير محدود"}</li>
                </ul>
                <div className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  <p className="mb-2 font-bold text-foreground">المزايا</p>
                  <ul className="space-y-1">
                    {(Array.isArray(plan.features) ? plan.features : []).map((feature: string) => (
                      <li key={feature}>✓ {featureLabels[feature] ?? feature}</li>
                    ))}
                  </ul>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
        <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
          <h3 className="text-lg font-extrabold text-foreground">تعليمات الدفع اليدوي</h3>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            <p><b>كريمي:</b> {data?.manualPayment?.kuraimi}</p>
            <p><b>جوالي:</b> {data?.manualPayment?.jawali}</p>
            <p><b>تحويل بنكي:</b> {data?.manualPayment?.bank}</p>
            <p><b>نقداً:</b> {data?.manualPayment?.cash}</p>
          </div>
        </div>
        <form className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]" onSubmit={(event) => { event.preventDefault(); submitPayment.mutate(); }}>
          <h3 className="text-lg font-extrabold text-foreground">رفع طلب ترقية الباقة</h3>
          {submitPayment.isSuccess && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">تم استلام طلبك، سيتم تفعيل باقتك بعد مراجعة الدفع.</div>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold">الباقة
              <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={selectedPlanId || selectedPlan?.id || ""} onChange={(event) => { setSelectedPlanId(event.target.value); const plan = plans.find((item: any) => item.id === event.target.value); const display = billingCycle === "annual" ? plan?.displayPriceAnnual : plan?.displayPriceMonthly; setAmountYer(String(display?.amount ?? "")); }}>
                {plans.map((plan: any) => <option key={plan.id} value={plan.id}>{plan.nameAr ?? plan.name}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold">المبلغ بالريال اليمني
              <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={amountYer} onChange={(event) => setAmountYer(event.target.value)} />
            </label>
            <label className="text-sm font-semibold">طريقة الدفع
              <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                <option value="kuraimi">كريمي</option>
                <option value="jawali">جوالي</option>
                <option value="bank_transfer">تحويل بنكي</option>
                <option value="cash">نقداً</option>
              </select>
            </label>
            <label className="text-sm font-semibold">رقم المرجع
              <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={reference} onChange={(event) => setReference(event.target.value)} />
            </label>
          </div>
          <label className="mt-3 block text-sm font-semibold">ملاحظة أو تفاصيل الإيصال
            <textarea className="mt-1 min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2" value={receiptNote} onChange={(event) => setReceiptNote(event.target.value)} />
          </label>
          <button disabled={submitPayment.isPending || !(selectedPlanId || selectedPlan?.id) || !amountYer} className="mt-4 rounded-lg bg-primary px-5 py-2.5 text-sm font-black text-primary-foreground disabled:opacity-50">إرسال طلب المراجعة</button>
        </form>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
        <h3 className="text-lg font-extrabold text-foreground">سجل طلبات الدفع</h3>
        <div className="mt-4 divide-y divide-border/60">
          {(data?.paymentSubmissions ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">لا توجد طلبات دفع بعد</div>
          ) : data.paymentSubmissions.map((item: any) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div>
                <div className="font-bold text-foreground">{item.planNameAr ?? item.planName} - {Number(item.amountYer).toLocaleString("ar")} ريال</div>
                <div className="text-muted-foreground">{item.paymentMethod} · {item.reference || "بدون مرجع"} · {new Date(item.createdAt).toLocaleDateString("ar")}</div>
              </div>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold text-muted-foreground">{item.status}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function BillingTab() {
  const { data } = useQuery({ queryKey: ["workspace-usage"], queryFn: () => apiFetch("workspace/usage") });
  const plan = data?.subscription;
  const limits = plan?.limits ?? {};
  const planCards = [
    { name: "البداية", price: "15,000", best: false, features: ["5 أعضاء فريق", "1,000 محادثة شهريًا", "تقارير أساسية", "دعم يدوي للقنوات"] },
    { name: "النمو", price: "35,000", best: true, features: ["15 عضو فريق", "5,000 محادثة شهريًا", "وكيل ذكي وقاعدة معرفة", "أتمتة وتقارير متقدمة"] },
    { name: "الفريق", price: "75,000", best: false, features: ["حتى 50 عضو", "محادثات حسب الاستخدام", "API وتكاملات", "إعدادات متعددة الفروع"] },
  ];
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
          <p className="text-sm font-bold text-primary">الخطة الحالية</p>
          <div className="mt-2 text-3xl font-extrabold text-foreground">{plan?.planName ?? "تجربة مجانية"}</div>
          <p className="mt-2 text-sm text-muted-foreground">الفوترة معلوماتية فقط في هذه المرحلة. لا يوجد خصم تلقائي أو معالجة دفع من داخل النظام.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-secondary/70 p-3"><div className="text-2xl font-extrabold">{limits.conversations_monthly ?? 200}</div><div className="text-xs text-muted-foreground">محادثات شهرية</div></div>
            <div className="rounded-lg bg-secondary/70 p-3"><div className="text-2xl font-extrabold">{limits.users ?? 3}</div><div className="text-xs text-muted-foreground">أعضاء فريق</div></div>
            <div className="rounded-lg bg-secondary/70 p-3"><div className="text-2xl font-extrabold">{limits.storage_mb ?? 100}MB</div><div className="text-xs text-muted-foreground">تخزين</div></div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
          <h3 className="text-sm font-extrabold text-foreground">تعليمات الدفع اليدوي في اليمن</h3>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            <p>يمكن الاتفاق على الدفع عبر كريمي، جوالي، تحويل بنكي، أو نقدًا حسب عقد الخدمة.</p>
            <p>بعد تأكيد الدفع يدويًا، يقوم فريق وصال ون بتحديث حالة الاشتراك والفاتورة.</p>
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">لا توجد بوابة دفع مفعّلة الآن. هذا القسم للعرض والتنظيم فقط.</p>
          </div>
        </div>
      </div>
      <section>
        <h3 className="mb-3 text-lg font-extrabold text-foreground">مقارنة الخطط</h3>
        <div className="grid gap-4 lg:grid-cols-3">
          {planCards.map((item) => (
            <div key={item.name} className={`rounded-xl border bg-card p-5 shadow-[var(--shadow-soft)] ${item.best ? "border-accent ring-2 ring-accent/15" : "border-border"}`}>
              {item.best && <div className="mb-3 w-fit rounded-full bg-accent/10 px-3 py-1 text-xs font-black text-accent">الأكثر مناسبة</div>}
              <h4 className="text-xl font-extrabold text-foreground">{item.name}</h4>
              <div className="mt-3"><span className="text-3xl font-black text-primary">{item.price}</span><span className="text-sm text-muted-foreground"> ريال يمني / شهر</span></div>
              <ul className="mt-5 space-y-3 text-sm text-muted-foreground">{item.features.map((feature) => <li key={feature}>• {feature}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
        <h3 className="text-lg font-extrabold text-foreground">الفواتير</h3>
        <p className="mt-1 text-sm text-muted-foreground">ستظهر الفواتير هنا بعد تفعيل دورة الفوترة الرسمية.</p>
        <div className="mt-5 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="font-bold text-foreground">لا توجد فواتير بعد</p>
          <p className="mt-1 text-sm text-muted-foreground">عند إصدار أول فاتورة ستظهر هنا مع الحالة والمبلغ وتاريخ الاستحقاق.</p>
        </div>
      </section>
    </div>
  );
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold mb-3">الفوترة</h3>
        <div className="text-2xl font-bold">{plan?.planName ?? "تجريبي"}</div>
        <p className="mt-2 text-sm text-muted-foreground">الدفع يدوي حالياً عبر التحويل البنكي أو كريمي/جوالي حسب الاتفاق. لا يوجد بوابة دفع مفعّلة.</p>
      </div>
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold mb-3">الفواتير</h3>
        <div className="text-sm text-muted-foreground text-center py-8">لا توجد فواتير مولدة بعد</div>
      </div>
    </div>
  );
}

function ApiKeysTab() {
  const qc = useQueryClient();
  const [label, setLabel] = useState("مفتاح داخلي");
  const [newKey, setNewKey] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["api-keys"], queryFn: () => apiFetch("workspace/api-keys") });
  const create = useMutation({
    mutationFn: () => apiFetch("workspace/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, scopes: ["read"] }) }),
    onSuccess: (res) => { setNewKey(res.key); qc.invalidateQueries({ queryKey: ["api-keys"] }); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`workspace/api-keys/${id}/revoke`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-4">
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? <div className="p-6 text-sm text-muted-foreground">جار التحميل...</div> : !(data?.apiKeys ?? []).length ? (
          <div className="p-8 text-sm text-muted-foreground text-center">لا توجد مفاتيح API بعد</div>
        ) : data.apiKeys.map((key: any) => (
          <div key={key.id} className="p-4 border-b border-border/50 last:border-0 flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{key.label}</div>
              <div className="text-xs text-muted-foreground">ينتهي بـ {key.last4} · {key.revokedAt ? "ملغى" : "نشط"}</div>
            </div>
            {!key.revokedAt && <button onClick={() => revoke.mutate(key.id)} className="px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs">إلغاء</button>}
          </div>
        ))}
      </div>
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold">مفتاح جديد</h3>
        <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" />
        <button onClick={() => create.mutate()} disabled={create.isPending || !label.trim()} className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">إنشاء</button>
        {newKey && <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs break-all" dir="ltr">{newKey}</div>}
      </div>
    </div>
  );
}

function DangerZoneTab() {
  return (
    <div className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">
      <h3 className="text-sm font-semibold mb-2">المنطقة الخطرة</h3>
      <p className="text-sm">نقل الملكية أو حذف مساحة العمل يحتاج تدفق تأكيد منفصل. لا توجد عملية حذف مفعّلة من هذه الصفحة الآن.</p>
    </div>
  );
}

function AccountLifecycleTab() {
  const qc = useQueryClient();
  const [confirmationName, setConfirmationName] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { data } = useQuery({
    queryKey: ["workspace-settings"],
    queryFn: () => apiFetch("workspace"),
  });
  const workspaceName = data?.workspace?.name ?? "";
  const deactivateMut = useMutation({
    mutationFn: () => apiFetch("workspace/deactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationName, reason }),
    }),
    onSuccess: () => {
      setError("");
      setMessage("تم تعطيل مساحة العمل مع الحفاظ على جميع البيانات. يمكن إعادة التفعيل لاحقاً من الإدارة.");
      qc.invalidateQueries({ queryKey: ["workspace-settings"] });
    },
    onError: (err: Error) => {
      setMessage("");
      setError(err.message);
    },
  });

  return (
    <div className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">
      <h3 className="mb-2 text-sm font-semibold">المنطقة الخطرة</h3>
      <p className="text-sm leading-6">يمكنك تعطيل مساحة العمل مؤقتاً بدون حذف أي بيانات. سيُحفظ كل شيء ويمكن إعادة التفعيل لاحقاً من الإدارة.</p>
      {message && <div className="mt-4 rounded-lg border border-green-200 bg-white p-3 text-sm text-green-700">{message}</div>}
      {error && <div className="mt-4 rounded-lg border border-red-200 bg-white p-3 text-sm text-red-700">{error}</div>}
      <div className="mt-5 space-y-3">
        <input
          value={confirmationName}
          onChange={(event) => setConfirmationName(event.target.value)}
          className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-red-200"
          placeholder={`اكتب اسم مساحة العمل للتأكيد: ${workspaceName}`}
        />
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="min-h-20 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-red-200"
          placeholder="سبب التعطيل (اختياري)"
        />
        <button
          onClick={() => deactivateMut.mutate()}
          disabled={!workspaceName || confirmationName !== workspaceName || deactivateMut.isPending}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {deactivateMut.isPending ? "جار التعطيل..." : "تعطيل مساحة العمل"}
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { hasPermission } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("workspace");
  const [inviteForm, setInviteForm] = useState({ email: "", name: "", password: "", role: "agent" });
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  const { data: usersData, isError: usersIsError, error: usersError } = useQuery({
    queryKey: ["workspace-users"],
    queryFn: () => apiFetch("users"),
    enabled: tab === "users",
  });

  const inviteMut = useMutation({
    mutationFn: (body: object) => apiFetch("users/invite", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    onSuccess: () => {
      setInviteSuccess("تمت إضافة الموظف بنجاح. يمكنه الآن تسجيل الدخول بالبريد وكلمة المرور التي أدخلتها.");
      setInviteError("");
      setInviteForm({ email: "", name: "", password: "", role: "agent" });
      qc.invalidateQueries({ queryKey: ["workspace-users"] });
    },
    onError: (e: Error) => {
      try { const j = JSON.parse(e.message); setInviteError(j.error ?? e.message); } catch { setInviteError(e.message); }
      setInviteSuccess("");
    },
  });

  const canInvite = hasPermission("users:invite");
  const members = usersData?.members ?? usersData?.users ?? [];

  const tabs: { id: Tab; label: string }[] = [
    { id: "workspace", label: "مساحة العمل" },
    { id: "users", label: "الفريق" },
    { id: "invite", label: "دعوة عضو" },
    { id: "business-hours", label: "ساعات العمل" },
    { id: "sla", label: "قواعد الاستجابة" },
    { id: "quick-replies", label: "الردود السريعة" },
    { id: "payment-methods", label: "طرق الدفع" },
    { id: "exchange-rates", label: "أسعار الصرف" },
    { id: "notifications", label: "التنبيهات" },
    { id: "security", label: "الأمان" },
    { id: "billing", label: "الفوترة" },
    { id: "api-keys", label: "مفاتيح API" },
    { id: "danger", label: "المنطقة الخطرة" },
  ];

  return (
    <div dir="rtl">
      <PageHeader title="الإعدادات" subtitle="إدارة مساحة العمل والفريق والمالية" />

      <div className="flex gap-1 mb-6 border-b border-border overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "workspace" && <WorkspaceTab />}

      {tab === "users" && (
        <div className="max-w-2xl">
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {usersIsError ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                {(usersError as Error).message || "ليس لديك صلاحية عرض أعضاء الفريق"}
              </div>
            ) : !usersData ? (
              <div className="py-12 text-center text-muted-foreground text-sm">جار التحميل...</div>
            ) : !members.length ? (
              <div className="py-12 text-center text-muted-foreground text-sm">لا يوجد أعضاء</div>
            ) : (
              members.map((u: { id?: string; membershipId?: string; userId?: string; name?: string; email?: string; roles?: string[]; isActive?: boolean; status?: string }) => (
                <div key={u.id ?? u.membershipId ?? u.userId} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                    {u.name?.[0] ?? "؟"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground">{u.name ?? "بدون اسم"}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">{u.email}</div>
                  </div>
                  <div className="flex gap-1">
                    {u.roles?.map((r: string) => (
                      <span key={r} className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">{r}</span>
                    ))}
                  </div>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${(u.isActive ?? u.status === "active") ? "bg-green-500" : "bg-gray-300"}`} title={(u.isActive ?? u.status === "active") ? "نشط" : "غير نشط"} />
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === "invite" && (
        <div className="max-w-sm">
          {!canInvite ? (
            <div className="p-5 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm text-center">
              🔒 ليس لديك صلاحية دعوة أعضاء جدد
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">دعوة عضو جديد إلى الفريق</h3>
              {inviteSuccess && (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{inviteSuccess}</div>
              )}
              {inviteError && (
                <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">{inviteError}</div>
              )}
              <div className="space-y-3">
                <div>
                  <label htmlFor="invite-name" className="block text-sm font-medium mb-1">الاسم</label>
                  <input id="invite-name" name="inviteName" value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="اسم الموظف" />
                </div>
                <div>
                  <label htmlFor="invite-email" className="block text-sm font-medium mb-1">البريد الإلكتروني</label>
                  <input id="invite-email" name="inviteEmail" type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="employee@company.com" dir="ltr" />
                </div>
                <div>
                  <label htmlFor="invite-password" className="block text-sm font-medium mb-1">كلمة المرور</label>
                  <input id="invite-password" name="invitePassword" type="password" value={inviteForm.password} onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="8 أحرف على الأقل" minLength={8} />
                </div>
                <div>
                  <label htmlFor="invite-role" className="block text-sm font-medium mb-1">الدور</label>
                  <select id="invite-role" name="inviteRole" value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                    <option value="agent">موظف خدمة</option>
                    <option value="accountant">محاسب</option>
                    <option value="manager">مدير</option>
                    <option value="viewer">مشاهد</option>
                  </select>
                </div>
                <button
                  onClick={() => inviteMut.mutate({ ...inviteForm, roleSlug: inviteForm.role })}
                  disabled={inviteMut.isPending || !inviteForm.email || !inviteForm.name || !inviteForm.password}
                  className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
                  {inviteMut.isPending ? "جار الإرسال..." : "إرسال الدعوة"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "business-hours" && <BusinessHoursTab />}
      {tab === "sla" && <SlaRulesTab />}
      {tab === "quick-replies" && <QuickRepliesTab />}
      {tab === "payment-methods" && <PaymentMethodsTab />}
      {tab === "exchange-rates" && <ExchangeRatesTab />}
      {tab === "notifications" && <NotificationsTab />}
      {tab === "security" && <SecurityTab />}
      {tab === "billing" && <BillingTabV2 />}
      {tab === "api-keys" && <ApiKeysTab />}
      {tab === "danger" && <AccountLifecycleTab />}
    </div>
  );
}
