import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, RefreshCw, Save, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/context/AuthContext";

const BASE = `${import.meta.env.BASE_URL}api`;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png"];

type Channel = { id: string; channelType: string; displayName: string; status: string };
type Profile = { about?: string; address?: string; description?: string; email?: string; profile_picture_url?: string; websites?: string[]; vertical?: string };
type ProfileResponse = { profile: Profile; lastSyncedProfile?: Profile; lastSyncedAt?: string; source?: "meta"; message?: string; correlationId: string };
type ErrorPayload = { error: string; code?: string; correlationId?: string; lastSyncedProfile?: Profile; lastSyncedAt?: string };

class ProfileApiError extends Error {
  constructor(public payload: ErrorPayload, public status: number) {
    super(payload.error || "تعذر إكمال العملية");
  }
}

async function json<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ProfileApiError({
    error: typeof payload.error === "string" ? payload.error : "تعذر إكمال العملية",
    code: payload.code,
    correlationId: payload.correlationId,
    lastSyncedProfile: payload.lastSyncedProfile,
    lastSyncedAt: payload.lastSyncedAt,
  }, response.status);
  return payload as T;
}

async function channels(): Promise<Channel[]> {
  const data = await json<{ accounts?: Channel[] }>(await fetch(`${BASE}/integrations/meta/channels`, { credentials: "include" }));
  return (data.accounts ?? []).filter((account) => account.channelType === "whatsapp");
}

async function profile(accountId: string) {
  return json<ProfileResponse>(await fetch(`${BASE}/whatsapp-management/accounts/${accountId}/business-profile`, { credentials: "include" }));
}

async function saveProfile(accountId: string, body: Profile) {
  return json<ProfileResponse>(await fetch(`${BASE}/whatsapp-management/accounts/${accountId}/business-profile`, {
    method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}

async function savePhoto(accountId: string, file: File) {
  return json<ProfileResponse>(await fetch(`${BASE}/whatsapp-management/accounts/${accountId}/business-profile/photo`, {
    method: "POST", credentials: "include", headers: { "Content-Type": file.type, "X-File-Name": file.name }, body: file,
  }));
}

const verticals = [
  ["", "غير محدد"], ["AUTOMOTIVE", "السيارات"], ["BEAUTY_SPA_AND_SALON", "الجمال والصالونات"],
  ["CLOTHING_AND_APPAREL", "الملابس والأزياء"], ["EDUCATION", "التعليم"], ["ENTERTAINMENT", "الترفيه"],
  ["EVENT_PLANNING_AND_SERVICE", "تنظيم الفعاليات"], ["FINANCE_AND_BANKING", "المال والخدمات المصرفية"],
  ["FOOD_AND_GROCERY", "الأغذية والبقالة"], ["HOTEL_AND_LODGING", "الفنادق والإقامة"],
  ["MEDICAL_AND_HEALTH", "الصحة والطب"], ["NON_PROFIT", "منظمة غير ربحية"],
  ["PROFESSIONAL_SERVICES", "الخدمات المهنية"], ["PUBLIC_SERVICE", "الخدمات العامة"],
  ["RESTAURANT", "مطعم"], ["SHOPPING_AND_RETAIL", "التسوق والتجزئة"],
  ["TRAVEL_AND_TRANSPORTATION", "السفر والنقل"], ["OTHER", "أخرى"],
] as const;

const empty: Profile = { about: "", address: "", description: "", email: "", websites: ["", ""], vertical: "" };
const normalize = (value?: Profile): Profile => ({ ...empty, ...value, websites: [value?.websites?.[0] ?? "", value?.websites?.[1] ?? ""] });
const payload = (form: Profile): Profile => ({
  ...(form.about?.trim() ? { about: form.about.trim() } : {}),
  address: form.address?.trim() ?? "", description: form.description?.trim() ?? "", email: form.email?.trim() ?? "",
  websites: (form.websites ?? []).map((value) => value.trim()).filter(Boolean), vertical: form.vertical ?? "",
});

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div><label htmlFor={id} className="mb-1 block text-sm font-semibold">{label}</label>{children}</div>;
}
const inputClass = "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm";

export default function WhatsAppBusinessProfilePage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("integrations:update");
  const client = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [accountId, setAccountId] = useState("");
  const [form, setForm] = useState<Profile>(empty);
  const [success, setSuccess] = useState("");
  const [localError, setLocalError] = useState("");

  const accountsQuery = useQuery({ queryKey: ["whatsapp-business-profile-accounts"], queryFn: channels });
  const accounts = accountsQuery.data ?? [];
  useEffect(() => { if (!accountId && accounts[0]?.id) setAccountId(accounts[0].id); }, [accountId, accounts]);

  const profileQuery = useQuery({ queryKey: ["whatsapp-business-profile", accountId], queryFn: () => profile(accountId), enabled: Boolean(accountId) });
  const profileError = profileQuery.error instanceof ProfileApiError ? profileQuery.error : null;
  const shown = profileQuery.data?.profile ?? profileError?.payload.lastSyncedProfile;
  const syncedAt = profileQuery.data?.lastSyncedAt ?? profileError?.payload.lastSyncedAt;
  useEffect(() => { if (shown) setForm(normalize(shown)); }, [shown]);

  const update = useMutation({
    mutationFn: () => saveProfile(accountId, payload(form)),
    onSuccess: (data) => { client.setQueryData(["whatsapp-business-profile", accountId], data); setForm(normalize(data.profile)); setLocalError(""); setSuccess(data.message ?? "تم تحديث الملف التجاري وتأكيده من Meta"); },
    onError: () => setSuccess(""),
  });
  const photo = useMutation({
    mutationFn: (file: File) => savePhoto(accountId, file),
    onSuccess: (data) => { client.setQueryData(["whatsapp-business-profile", accountId], data); setForm(normalize(data.profile)); setLocalError(""); setSuccess(data.message ?? "تم تحديث صورة الملف التجاري وتأكيدها من Meta"); },
    onError: () => setSuccess(""),
  });

  const mutationError = update.error ?? photo.error;
  const error = localError || (mutationError instanceof Error ? mutationError.message : "") || (accountsQuery.error instanceof Error ? accountsQuery.error.message : "") || profileError?.message || "";
  const correlationId = mutationError instanceof ProfileApiError ? mutationError.payload.correlationId : profileError?.payload.correlationId ?? profileQuery.data?.correlationId;
  const busy = profileQuery.isFetching || update.isPending || photo.isPending;
  const set = (field: keyof Profile, value: string) => { setSuccess(""); setForm((current) => ({ ...current, [field]: value })); };
  const setWebsite = (index: number, value: string) => setForm((current) => {
    const websites = [...(current.websites ?? ["", ""]), "", ""].slice(0, 2); websites[index] = value; return { ...current, websites };
  });

  function choosePhoto(file?: File) {
    setLocalError(""); setSuccess("");
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return setLocalError("نوع الصورة غير مدعوم. استخدم JPEG أو PNG.");
    if (!file.size) return setLocalError("ملف الصورة فارغ.");
    if (file.size > MAX_IMAGE_BYTES) return setLocalError("حجم الصورة يتجاوز 5 ميجابايت.");
    photo.mutate(file);
  }

  return <div dir="rtl" className="space-y-5">
    <PageHeader title="الملف التجاري في واتساب" subtitle="اعرض وحدّث البيانات الحقيقية المتزامنة مع Meta دون تغيير إعدادات الربط." />
    <div className="max-w-5xl space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <Field id="whatsapp-profile-account" label="حساب واتساب">
          <select id="whatsapp-profile-account" value={accountId} disabled={accountsQuery.isLoading || busy} className={inputClass}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => { setAccountId(event.target.value); setSuccess(""); setLocalError(""); }}>
            {!accounts.length && <option value="">لا توجد حسابات واتساب مرتبطة</option>}
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}
          </select>
        </Field>
      </section>

      {success && <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{success}</div>}
      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><div className="flex gap-2"><TriangleAlert className="mt-0.5 h-4 w-4" /><div><p>{error}</p>{shown && <p className="mt-1 text-xs">يتم عرض آخر نسخة متزامنة محفوظة بأمان.</p>}{correlationId && <p className="mt-1 text-xs font-mono">رقم التتبع: {correlationId}</p>}</div></div></div>}

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 overflow-hidden rounded-full border border-border bg-muted">
              {form.profile_picture_url ? <img src={form.profile_picture_url} alt="صورة الملف التجاري" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">لا توجد صورة</div>}
            </div>
            <div><p className="font-semibold">صورة الملف التجاري</p><p className="text-xs text-muted-foreground">JPEG أو PNG، بحد أقصى 5 ميجابايت.</p>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(event) => { choosePhoto(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              <button type="button" disabled={!canManage || !accountId || busy} onClick={() => fileRef.current?.click()} className="mt-2 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"><Camera className="h-4 w-4" />تغيير الصورة</button>
            </div>
          </div>
          <button type="button" disabled={!accountId || busy} onClick={() => profileQuery.refetch()} className="inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${profileQuery.isFetching ? "animate-spin" : ""}`} />مزامنة الآن</button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2"><Field id="profile-about" label="نبذة النشاط"><input id="profile-about" value={form.about ?? ""} maxLength={139} disabled={!canManage || busy} onChange={(e) => set("about", e.target.value)} className={inputClass} /></Field></div>
          <div className="md:col-span-2"><Field id="profile-description" label="وصف النشاط"><textarea id="profile-description" value={form.description ?? ""} maxLength={512} rows={4} disabled={!canManage || busy} onChange={(e) => set("description", e.target.value)} className={inputClass} /></Field></div>
          <Field id="profile-email" label="البريد الإلكتروني"><input id="profile-email" type="email" value={form.email ?? ""} maxLength={128} disabled={!canManage || busy} onChange={(e) => set("email", e.target.value)} className={inputClass} /></Field>
          <Field id="profile-vertical" label="فئة النشاط"><select id="profile-vertical" value={form.vertical ?? ""} disabled={!canManage || busy} onChange={(e) => set("vertical", e.target.value)} className={inputClass}>{verticals.map(([value, label]) => <option key={value || "none"} value={value}>{label}</option>)}</select></Field>
          <div className="md:col-span-2"><Field id="profile-address" label="العنوان"><input id="profile-address" value={form.address ?? ""} maxLength={256} disabled={!canManage || busy} onChange={(e) => set("address", e.target.value)} className={inputClass} /></Field></div>
          {[0, 1].map((index) => <Field key={index} id={`profile-website-${index}`} label={`الموقع الإلكتروني ${index + 1}`}><input id={`profile-website-${index}`} type="url" value={form.websites?.[index] ?? ""} maxLength={256} placeholder="https://example.com" disabled={!canManage || busy} onChange={(e) => setWebsite(index, e.target.value)} className={inputClass} /></Field>)}
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">آخر مزامنة: {syncedAt ? new Date(syncedAt).toLocaleString("ar") : "لم تتم المزامنة بعد"}</p>
          <button type="button" disabled={!canManage || !accountId || busy} onClick={() => update.mutate()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Save className="h-4 w-4" />حفظ التغييرات</button>
        </div>
      </section>
    </div>
  </div>;
}
