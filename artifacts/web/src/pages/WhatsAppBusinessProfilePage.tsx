import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, RefreshCw, Save, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/context/AuthContext";

const BASE = `${import.meta.env.BASE_URL}api`;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png"];

type ConnectedChannel = {
  id: string;
  channelType: string;
  displayName: string;
  status: string;
  providerConfig?: Record<string, unknown>;
};

type BusinessProfile = {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  profile_picture_url?: string;
  websites?: string[];
  vertical?: string;
};

type ProfileResponse = {
  profile: BusinessProfile;
  lastSyncedProfile?: BusinessProfile;
  lastSyncedAt?: string;
  source?: "meta";
  message?: string;
  correlationId: string;
};

type ApiErrorPayload = {
  error: string;
  code?: string;
  correlationId?: string;
  lastSyncedProfile?: BusinessProfile;
  lastSyncedAt?: string;
  meta?: {
    code?: number;
    errorSubcode?: number;
    requestId?: string;
  };
};

class ProfileApiError extends Error {
  constructor(public payload: ApiErrorPayload, public status: number) {
    super(payload.error || "تعذر إكمال العملية");
    this.name = "ProfileApiError";
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ProfileApiError(
      {
        error: typeof payload.error === "string" ? payload.error : "تعذر إكمال العملية",
        code: payload.code,
        correlationId: payload.correlationId,
        lastSyncedProfile: payload.lastSyncedProfile,
        lastSyncedAt: payload.lastSyncedAt,
        meta: payload.meta,
      },
      res.status,
    );
  }
  return payload as T;
}

async function fetchChannels(): Promise<ConnectedChannel[]> {
  const res = await fetch(`${BASE}/integrations/meta/channels`, { credentials: "include" });
  const data = await readJson<{ accounts?: ConnectedChannel[] }>(res);
  return (data.accounts ?? []).filter((account) => account.channelType === "whatsapp");
}

async function fetchProfile(accountId: string): Promise<ProfileResponse> {
  const res = await fetch(`${BASE}/whatsapp-management/accounts/${accountId}/business-profile`, {
    credentials: "include",
  });
  return readJson<ProfileResponse>(res);
}

async function updateProfile(accountId: string, body: BusinessProfile): Promise<ProfileResponse> {
  const res = await fetch(`${BASE}/whatsapp-management/accounts/${accountId}/business-profile`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson<ProfileResponse>(res);
}

async function uploadPhoto(accountId: string, file: File): Promise<ProfileResponse> {
  const res = await fetch(`${BASE}/whatsapp-management/accounts/${accountId}/business-profile/photo`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": file.type,
      "X-File-Name": file.name,
    },
    body: file,
  });
  return readJson<ProfileResponse>(res);
}

const verticalOptions = [
  ["", "غير محدد"],
  ["AUTOMOTIVE", "السيارات"],
  ["BEAUTY_SPA_AND_SALON", "الجمال والصالونات"],
  ["CLOTHING_AND_APPAREL", "الملابس والأزياء"],
  ["EDUCATION", "التعليم"],
  ["ENTERTAINMENT", "الترفيه"],
  ["EVENT_PLANNING_AND_SERVICE", "تنظيم الفعاليات"],
  ["FINANCE_AND_BANKING", "المال والخدمات المصرفية"],
  ["FOOD_AND_GROCERY", "الأغذية والبقالة"],
  ["HOTEL_AND_LODGING", "الفنادق والإقامة"],
  ["MEDICAL_AND_HEALTH", "الصحة والطب"],
  ["NON_PROFIT", "منظمة غير ربحية"],
  ["PROFESSIONAL_SERVICES", "الخدمات المهنية"],
  ["PUBLIC_SERVICE", "الخدمات العامة"],
  ["RESTAURANT", "مطعم"],
  ["SHOPPING_AND_RETAIL", "التسوق والتجزئة"],
  ["TRAVEL_AND_TRANSPORTATION", "السفر والنقل"],
  ["OTHER", "أخرى"],
] as const;

const emptyProfile: BusinessProfile = {
  about: "",
  address: "",
  description: "",
  email: "",
  websites: ["", ""],
  vertical: "",
};

function normalizedForm(profile?: BusinessProfile): BusinessProfile {
  return {
    about: profile?.about ?? "",
    address: profile?.address ?? "",
    description: profile?.description ?? "",
    email: profile?.email ?? "",
    websites: [profile?.websites?.[0] ?? "", profile?.websites?.[1] ?? ""],
    vertical: profile?.vertical ?? "",
    profile_picture_url: profile?.profile_picture_url,
  };
}

function profilePayload(form: BusinessProfile): BusinessProfile {
  const payload: BusinessProfile = {
    address: form.address?.trim() ?? "",
    description: form.description?.trim() ?? "",
    email: form.email?.trim() ?? "",
    websites: (form.websites ?? []).map((value) => value.trim()).filter(Boolean),
    vertical: form.vertical ?? "",
  };
  const about = form.about?.trim();
  if (about) payload.about = about;
  return payload;
}

export default function WhatsAppBusinessProfilePage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("integrations:update");
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [form, setForm] = useState<BusinessProfile>(emptyProfile);
  const [successMessage, setSuccessMessage] = useState("");
  const [clientError, setClientError] = useState("");

  const channelsQuery = useQuery({
    queryKey: ["whatsapp-business-profile-accounts"],
    queryFn: fetchChannels,
  });

  const accounts = channelsQuery.data ?? [];
  useEffect(() => {
    if (!selectedAccountId && accounts[0]?.id) setSelectedAccountId(accounts[0].id);
  }, [accounts, selectedAccountId]);

  const profileQuery = useQuery({
    queryKey: ["whatsapp-business-profile", selectedAccountId],
    queryFn: () => fetchProfile(selectedAccountId),
    enabled: Boolean(selectedAccountId),
  });

  const profileError = profileQuery.error instanceof ProfileApiError ? profileQuery.error : null;
  const displayedProfile = profileQuery.data?.profile ?? profileError?.payload.lastSyncedProfile;
  const lastSyncedAt = profileQuery.data?.lastSyncedAt ?? profileError?.payload.lastSyncedAt;

  useEffect(() => {
    if (displayedProfile) setForm(normalizedForm(displayedProfile));
  }, [displayedProfile]);

  const saveMutation = useMutation({
    mutationFn: () => updateProfile(selectedAccountId, profilePayload(form)),
    onSuccess: (data) => {
      qc.setQueryData(["whatsapp-business-profile", selectedAccountId], data);
      setForm(normalizedForm(data.profile));
      setClientError("");
      setSuccessMessage(data.message ?? "تم تحديث الملف التجاري وتأكيده من Meta");
    },
    onError: () => setSuccessMessage(""),
  });

  const photoMutation = useMutation({
    mutationFn: (file: File) => uploadPhoto(selectedAccountId, file),
    onSuccess: (data) => {
      qc.setQueryData(["whatsapp-business-profile", selectedAccountId], data);
      setForm(normalizedForm(data.profile));
      setClientError("");
      setSuccessMessage(data.message ?? "تم تحديث صورة الملف التجاري وتأكيدها من ميبا");
    },
    onError: () => setSuccessMessage(""),
  });

  const currentError = useMemo(() => {
    if (clientError) return clientError;
    const mutationError = saveMutation.error ?? photoMutation.error;
    if (mutationError instanceof ProfileApiError) return mutationError.message;
    if (mutationError instanceof Error) return mutationError.message;
    if (channelsQuery.error instanceof Error) return channelsQuery.error.message;
    return profileError?.message ?? "";
  }, [clientError, saveMutation.error, photoMutation.error, profileError, channelsQuery.error]);

  const correlationId = useMemo(() => {
    const mutationError = saveMutation.error ?? photoMutation.error;
    if (mutationError instanceof ProfileApiError) return mutationError.payload.correlationId;
    return profileError?.payload.correlationId ?? profileQuery.data?.correlationId;
  }, [saveMutation.error, photoMutation.error, profileError, profileQuery.data?.correlationId]);

  function updateField(field: keyof BusinessProfile, value: string) {
    setSuccessMessage("");
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateWebsite(index: number, value: string) {
    setSuccessMessage("");
    setForm((current) => {
      const websites = [...(current.websites ?? ["", ""]), "", ""].slice(0, 2);
      websites[index] = value;
      return { ...current, websites };
    });
  }

  function choosePhoto(file?: File) {
    setClientError("");
    setSuccessMessage("");
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setClientError("نعع الصورة غير مدعوم. استخد JPEG أو PNG.");
      return;
    }
    if (!file.size) {
      setClientError("ملفاف الصورة فارغ.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setClientError("حجم الصورة يتجاوز 5 ميجابايت.");
      return;
    }
    photoMutation.mutate(file);
  }

  const isBusy = profileQuery.isFetching || saveMutation.isPending || photoMutation.isPending;

  return (
    <div dir="rtl" className="space-y-5">
      <PageHeader
        title="الملف التجاري في واتساب"
        description="اعرز وتحديث البيانات الحقيقية المتزامنة مع Meta دون تغيير إعدادات الربط."
      />

      <div className="max-w-5xl space-y-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <label for="whatsapp-profile-account" className="mb-1 block text-sm font-semibold text-foreground">
            حساب واتساب
          </label>
          <select
            id="whatsapp-profile-account"
            value={selectedAccountId}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setSelectedAccountId(event.target.value);
              setSuccessMessage("");
              setClientError("");
            }}
            disabled={channelsQuery.isLoading || isBusy}
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm"
          >
            {!accounts.length && <option value="">لا توجد حسابات واتساب مرتبطة</option>}
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.displayName}</option>
            ))}
          </select>
        </div>

        {successMessage && (
          <div className="rounded-xl border border-green-200 bg-green-50 pECB1