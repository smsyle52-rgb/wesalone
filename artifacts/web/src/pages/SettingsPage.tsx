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

type Tab = "workspace" | "security" | "users" | "invite" | "payment-methods" | "exchange-rates";

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
    { id: "workspace", label: "معلومات المساحة" },
    { id: "security", label: "الأمان" },
    { id: "users", label: "أعضاء الفريق" },
    { id: "invite", label: "دعوة عضو" },
    { id: "payment-methods", label: "طرق الدفع" },
    { id: "exchange-rates", label: "أسعار الصرف" },
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
      {tab === "security" && <SecurityTab />}

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

      {tab === "payment-methods" && <PaymentMethodsTab />}
      {tab === "exchange-rates" && <ExchangeRatesTab />}
    </div>
  );
}
