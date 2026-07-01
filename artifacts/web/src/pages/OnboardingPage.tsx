import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, BookOpenText, CheckCircle2, Loader2, Plug } from "lucide-react";
import { FaInstagram, FaWhatsapp } from "react-icons/fa6";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

const BASE = `${import.meta.env.BASE_URL}api`;
const STEP_COUNT = 3;
const FACEBOOK_SDK_SCRIPT_ID = "facebook-jssdk";
const FACEBOOK_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";

type Step = 1 | 2 | 3;

type FacebookLoginResponse = {
  authResponse?: {
    code?: string;
  } | null;
  status?: string;
};

type FacebookLoginOptions = {
  config_id: string;
  response_type: "code";
  override_default_response_type: true;
  extras?: {
    setup?: Record<string, unknown>;
    featureType?: "whatsapp_business_app_onboarding";
    sessionInfoVersion: "3";
    version: "v4";
  };
};

type FacebookSdk = {
  init: (options: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }) => void;
  login: (callback: (response: FacebookLoginResponse) => void, options: FacebookLoginOptions) => void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

type MetaSignupConfig = {
  appId: string | null;
  graphVersion: string;
  configIds: {
    whatsappStandard: string | null;
    whatsappCoexistence: string | null;
    instagramMessenger: string | null;
    facebookContent: string | null;
  };
};

type MetaSignupConfigKey = "whatsappStandard" | "instagramMessenger";

type EmbeddedSignupSessionInfo = {
  waba_id?: string;
  phone_number_id?: string;
  display_phone_number?: string;
  verified_name?: string;
};

type EmbeddedSignupMessage = {
  eventName?: string;
  info?: EmbeddedSignupSessionInfo;
  errorMessage?: string;
};

type ConnectedChannel = {
  id: string;
  channelType: "whatsapp" | "instagram" | "messenger";
  displayName: string;
  status: string;
  hasCredentialReference: boolean;
};

type KnowledgeBase = {
  id: string;
  name: string;
};

type AgentDetailResponse = {
  agent?: {
    id: string;
    name: string;
    type: string;
    dialect: string;
    sectorKey?: string | null;
  };
  instructions?: {
    rolePrompt?: string | null;
  } | null;
};

const CHANNEL_OPTIONS: Array<{
  key: MetaSignupConfigKey;
  label: string;
  tone: string;
  icon: ReactNode;
}> = [
  {
    key: "whatsappStandard",
    label: "واتساب للأعمال",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: <FaWhatsapp className="h-5 w-5" />,
  },
  {
    key: "instagramMessenger",
    label: "إنستغرام",
    tone: "border-pink-200 bg-pink-50 text-pink-700",
    icon: <FaInstagram className="h-5 w-5" />,
  },
];

const BUSINESS_TYPES = [
  { key: "retail_general", label: "تجزئة وبيع عام" },
  { key: "food_restaurant", label: "مطعم وأغذية" },
  { key: "services_general", label: "خدمات عامة" },
  { key: "beauty_wellness", label: "صالونات وعناية" },
  { key: "real_estate", label: "عقارات" },
  { key: "healthcare", label: "صحة وعيادات" },
  { key: "education", label: "تعليم وتدريب" },
  { key: "technology", label: "تقنية" },
  { key: "travel_tourism", label: "سياحة وسفر" },
  { key: "other", label: "أخرى" },
];

let facebookSdkPromise: Promise<void> | null = null;
let initializedFacebookSdkKey: string | null = null;

function defaultAgentPrompt(type: string, dialect: string) {
  return `أنت وكيل ذكاء اصطناعي مساعد لنظام إدارة علاقات العملاء. نوعك: ${type}. لهجتك: ${dialect}.`;
}

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? "تعذر إكمال الطلب");
  }
  return data as T;
}

function normalizeGraphVersion(version: string | null | undefined) {
  const value = (version || "v22.0").trim();
  return value.startsWith("v") ? value : `v${value}`;
}

function initFacebookSdk(appId: string, version: string) {
  if (!window.FB) throw new Error("Facebook SDK is not available");
  const key = `${appId}:${version}`;
  if (initializedFacebookSdkKey === key) return;
  window.FB.init({ appId, cookie: true, xfbml: false, version });
  initializedFacebookSdkKey = key;
}

function loadFacebookSdk(appId: string, version: string) {
  const normalizedVersion = normalizeGraphVersion(version);
  if (window.FB) {
    initFacebookSdk(appId, normalizedVersion);
    return Promise.resolve();
  }

  if (!facebookSdkPromise) {
    facebookSdkPromise = new Promise((resolve, reject) => {
      window.fbAsyncInit = () => {
        try {
          initFacebookSdk(appId, normalizedVersion);
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      const existing = document.getElementById(FACEBOOK_SDK_SCRIPT_ID) as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Facebook SDK failed to load")), { once: true });
        return;
      }

      const firstScript = document.getElementsByTagName("script")[0];
      const script = document.createElement("script");
      script.id = FACEBOOK_SDK_SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.src = FACEBOOK_SDK_SRC;
      script.onerror = () => reject(new Error("Facebook SDK failed to load"));
      firstScript.parentNode?.insertBefore(script, firstScript);
    });
  }

  return facebookSdkPromise.then(() => {
    initFacebookSdk(appId, normalizedVersion);
  });
}

function embeddedSignupExtrasForOption(key: MetaSignupConfigKey): FacebookLoginOptions["extras"] | undefined {
  if (key === "whatsappStandard") {
    return {
      sessionInfoVersion: "3",
      version: "v4",
    };
  }
  return undefined;
}

function loginWithFacebook(configId: string, optionKey: MetaSignupConfigKey): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.FB) {
      reject(new Error("Facebook SDK is not ready"));
      return;
    }
    const loginOptions: FacebookLoginOptions = {
      config_id: configId,
      response_type: "code",
      override_default_response_type: true,
    };
    const extras = embeddedSignupExtrasForOption(optionKey);
    if (extras) loginOptions.extras = extras;
    window.FB.login((response) => {
      const code = response.authResponse?.code;
      if (code) {
        resolve(code);
        return;
      }
      reject(new Error(response.status ? `Meta signup did not complete: ${response.status}` : "Meta signup did not return a code"));
    }, loginOptions);
  });
}

function isFacebookOrigin(origin: string) {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "facebook.com" || hostname.endsWith(".facebook.com");
  } catch {
    return false;
  }
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseEmbeddedSignupMessage(data: unknown): EmbeddedSignupMessage | null {
  const payload = typeof data === "string"
    ? (() => {
      try {
        return JSON.parse(data) as unknown;
      } catch {
        return null;
      }
    })()
    : data;
  const record = recordFrom(payload);
  if (!record || record.type !== "WA_EMBEDDED_SIGNUP") return null;
  const nested = recordFrom(record.data) ?? record;
  const eventName = (
    stringField(record, "event")
    ?? stringField(record, "eventName")
    ?? stringField(record, "status")
    ?? stringField(nested, "event")
    ?? stringField(nested, "eventName")
    ?? stringField(nested, "status")
  )?.toUpperCase();
  const wabaId = stringField(nested, "waba_id") ?? stringField(nested, "wabaId");
  const phoneNumberId = stringField(nested, "phone_number_id") ?? stringField(nested, "phoneNumberId");
  const info = wabaId || phoneNumberId
    ? {
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      display_phone_number: stringField(nested, "display_phone_number") ?? stringField(nested, "displayPhoneNumber"),
      verified_name: stringField(nested, "verified_name") ?? stringField(nested, "verifiedName"),
    }
    : undefined;
  return {
    eventName,
    info,
    errorMessage: stringField(record, "error_message") ?? stringField(record, "errorMessage") ?? stringField(nested, "message"),
  };
}

export default function OnboardingPage() {
  const [, navigate] = useLocation();
  const { user, onboardingStatus, refreshAuth } = useAuth();
  const [step, setStep] = useState<Step>(onboardingStatus.currentStep);
  const [agentName, setAgentName] = useState("");
  const [businessType, setBusinessType] = useState("services_general");
  const [instructions, setInstructions] = useState("");
  const [knowledgeTitle, setKnowledgeTitle] = useState("معلومات النشاط");
  const [knowledgeBody, setKnowledgeBody] = useState("");
  const [channelError, setChannelError] = useState<string | null>(null);
  const signupSessionInfoRef = useRef<EmbeddedSignupSessionInfo | null>(null);
  const signupSessionErrorRef = useRef<string | null>(null);
  const agentPrefilledRef = useRef(false);
  const [connectingKey, setConnectingKey] = useState<MetaSignupConfigKey | null>(null);

  useEffect(() => {
    if (onboardingStatus.completed) {
      sessionStorage.setItem("show-tour", "1");
      navigate("/dashboard");
      return;
    }
    setStep(onboardingStatus.currentStep);
  }, [navigate, onboardingStatus.completed, onboardingStatus.currentStep]);

  const sectorsQuery = useQuery({
    queryKey: ["sector-profiles-ob"],
    queryFn: () => apiFetch<{ sectors?: Array<{ sectorKey: string; nameAr: string }> }>("sectors"),
  });

  const agentDetailQuery = useQuery({
    queryKey: ["onboarding-agent", onboardingStatus.steps.agent.agentId],
    queryFn: () => apiFetch<AgentDetailResponse>(`ai/agents/${onboardingStatus.steps.agent.agentId}`),
    enabled: Boolean(onboardingStatus.steps.agent.agentId) && step === 1,
  });

  const metaConfigQuery = useQuery({
    queryKey: ["onboarding-meta-config"],
    queryFn: () => apiFetch<MetaSignupConfig>("integrations/meta/embedded-signup/config"),
    enabled: step === 2,
  });

  const channelsQuery = useQuery({
    queryKey: ["onboarding-meta-channels"],
    queryFn: () => apiFetch<{ accounts?: ConnectedChannel[] }>("integrations/meta/channels"),
    enabled: step === 2,
  });

  const knowledgeBasesQuery = useQuery({
    queryKey: ["onboarding-knowledge-bases"],
    queryFn: () => apiFetch<{ bases?: KnowledgeBase[] }>("knowledge/bases"),
    enabled: step === 3,
  });

  useEffect(() => {
    const config = metaConfigQuery.data;
    if (step !== 2 || !config?.appId) return;
    void loadFacebookSdk(config.appId, config.graphVersion).catch(() => {});
  }, [metaConfigQuery.data, step]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!isFacebookOrigin(event.origin)) return;
      const message = parseEmbeddedSignupMessage(event.data);
      if (!message) return;
      if (message.eventName === "CANCEL") {
        signupSessionErrorRef.current = "تم إلغاء الربط من نافذة Meta.";
        return;
      }
      if (message.eventName === "ERROR") {
        signupSessionErrorRef.current = message.errorMessage ?? "تعذر إكمال الربط من Meta.";
        return;
      }
      if (message.info) {
        signupSessionInfoRef.current = { ...signupSessionInfoRef.current, ...message.info };
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (agentPrefilledRef.current || !agentDetailQuery.data?.agent) return;
    const agent = agentDetailQuery.data.agent;
    const prompt = agentDetailQuery.data.instructions?.rolePrompt?.trim() ?? "";
    setAgentName(agent.name ?? "");
    setBusinessType(agent.sectorKey ?? "services_general");
    setInstructions(prompt && prompt !== defaultAgentPrompt(agent.type, agent.dialect) ? prompt : "");
    agentPrefilledRef.current = true;
  }, [agentDetailQuery.data]);

  const displaySectors = useMemo(() => {
    const sectors = sectorsQuery.data?.sectors ?? [];
    return sectors.length > 0 ? sectors : BUSINESS_TYPES.map((sector) => ({ sectorKey: sector.key, nameAr: sector.label }));
  }, [sectorsQuery.data]);

  const connectedChannels = channelsQuery.data?.accounts ?? [];
  const connectedLiveChannel = connectedChannels.find((item) => (item.channelType === "whatsapp" || item.channelType === "instagram") && item.status === "active" && item.hasCredentialReference) ?? null;
  const channelReady = onboardingStatus.steps.channel.completed || Boolean(connectedLiveChannel);

  function waitForCapturedSignupInfo(timeoutMs = 5000): Promise<EmbeddedSignupSessionInfo> {
    return new Promise((resolve, reject) => {
      if (signupSessionErrorRef.current) {
        reject(new Error(signupSessionErrorRef.current));
        return;
      }
      const existing = signupSessionInfoRef.current;
      if (existing?.waba_id && existing.phone_number_id) {
        resolve(existing);
        return;
      }
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        if (signupSessionErrorRef.current) {
          window.clearInterval(timer);
          reject(new Error(signupSessionErrorRef.current));
          return;
        }
        const current = signupSessionInfoRef.current;
        if (current?.waba_id && current.phone_number_id) {
          window.clearInterval(timer);
          resolve(current);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(timer);
          reject(new Error("لم تعد Meta بيانات واتساب المطلوبة بعد."));
        }
      }, 100);
    });
  }

  const saveAgentMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = agentName.trim();
      const trimmedInstructions = instructions.trim();
      if (!trimmedName || !trimmedInstructions) {
        throw new Error("أدخل اسم الوكيل وتعليماته قبل المتابعة.");
      }
      let agentId = onboardingStatus.steps.agent.agentId;
      if (agentId) {
        await apiFetch(`ai/agents/${agentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName, sectorKey: businessType }),
        });
      } else {
        const created = await apiFetch<{ agent: { id: string } }>("ai/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName, type: "support", defaultModel: "gemini_flash", dialect: "standard_arabic", sectorKey: businessType }),
        });
        agentId = created.agent.id;
      }
      await apiFetch(`ai/agents/${agentId}/instructions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rolePrompt: trimmedInstructions,
          businessRules: "",
          forbiddenActions: "",
          escalationRules: "",
        }),
      });
      await refreshAuth();
    },
    onSuccess: () => setStep(2),
  });

  const connectChannelMutation = useMutation({
    mutationFn: async (optionKey: MetaSignupConfigKey) => {
      const config = metaConfigQuery.data;
      if (!config?.appId) throw new Error("إعدادات Meta غير جاهزة بعد.");
      const configId = config.configIds[optionKey];
      if (!configId) throw new Error("هذه القناة غير مهيأة بعد.");
      signupSessionInfoRef.current = null;
      signupSessionErrorRef.current = null;
      await loadFacebookSdk(config.appId, config.graphVersion);
      const code = await loginWithFacebook(configId, optionKey);
      if (optionKey === "whatsappStandard") {
        const sessionInfo = await waitForCapturedSignupInfo();
        await apiFetch("integrations/meta/embedded-signup/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            waba_id: sessionInfo.waba_id,
            phone_number_id: sessionInfo.phone_number_id,
            display_phone_number: sessionInfo.display_phone_number,
            verified_name: sessionInfo.verified_name,
            config_id: configId,
            config_key: optionKey,
          }),
        });
      } else {
        await apiFetch("integrations/meta/embedded-signup/instagram-messenger/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
      }
      await Promise.all([channelsQuery.refetch(), refreshAuth()]);
    },
    onMutate: (optionKey) => {
      setChannelError(null);
      setConnectingKey(optionKey);
    },
    onSettled: () => setConnectingKey(null),
    onSuccess: () => setStep(3),
    onError: (error) => setChannelError((error as Error).message),
  });

  const saveKnowledgeMutation = useMutation({
    mutationFn: async () => {
      const title = knowledgeTitle.trim() || "معلومات النشاط";
      const contentText = knowledgeBody.trim();
      if (contentText.length < 30) {
        throw new Error("أضف معلومات حقيقية عن النشاط قبل الإكمال.");
      }
      let baseId = onboardingStatus.steps.knowledge.knowledgeBaseId ?? knowledgeBasesQuery.data?.bases?.[0]?.id ?? null;
      if (!baseId) {
        const createdBase = await apiFetch<{ base: { id: string } }>("knowledge/bases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: title, description: "قاعدة معرفة التهيئة الأولى" }),
        });
        baseId = createdBase.base.id;
      }
      await apiFetch(`knowledge/bases/${baseId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, contentText }),
      });
      await refreshAuth();
    },
  });

  function stepBadge(index: Step) {
    const completed = index === 1 ? onboardingStatus.steps.agent.completed : index === 2 ? onboardingStatus.steps.channel.completed : onboardingStatus.steps.knowledge.completed;
    return (
      <div
        key={index}
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-full border text-sm font-bold transition-colors",
          completed || step === index
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-background text-muted-foreground",
        )}
      >
        {completed ? <CheckCircle2 className="h-4 w-4" /> : index}
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background" dir="rtl">
      <div className="mx-auto flex min-h-[100dvh] max-w-5xl flex-col px-4 pb-10 pt-[calc(1rem+var(--app-safe-top))] sm:px-6">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-primary">تهيئة وصال ون</p>
            <h1 className="mt-2 text-3xl font-black text-foreground">لنشغّل متجرك على بيانات حقيقية</h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
              ثلاث خطوات فقط: تعريف الوكيل، ربط القناة، ثم إضافة معرفة أولية يعتمد عليها الرد.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            {user?.name ? `أهلاً ${user.name.split(" ")[0]}` : "أهلاً بك"}
          </div>
        </div>

        <div className="mb-8 flex items-center gap-3">
          {stepBadge(1)}
          <div className={cn("h-1 flex-1 rounded-full", onboardingStatus.steps.agent.completed ? "bg-primary" : "bg-muted")} />
          {stepBadge(2)}
          <div className={cn("h-1 flex-1 rounded-full", onboardingStatus.steps.channel.completed ? "bg-primary" : "bg-muted")} />
          {stepBadge(3)}
        </div>

        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-3">
            {[
              { index: 1 as Step, title: "تعريف الوكيل", text: "اسم واضح وتعليمات حقيقية بدل النص الافتراضي." },
              { index: 2 as Step, title: "ربط القناة", text: "واتساب أو إنستغرام فقط، مع تحقق فعلي من الحساب المتصل." },
              { index: 3 as Step, title: "معرفة النشاط", text: "معلومات حقيقية عن المنتجات أو الخدمات وسياسة التعامل." },
            ].map((item) => {
              const completed = item.index === 1 ? onboardingStatus.steps.agent.completed : item.index === 2 ? onboardingStatus.steps.channel.completed : onboardingStatus.steps.knowledge.completed;
              const active = step === item.index;
              return (
                <div key={item.index} className={cn("rounded-2xl border p-4 transition-colors", active ? "border-primary bg-primary/5" : "border-border bg-card")}>
                  <div className="flex items-start gap-3">
                    <div className={cn("mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold", completed ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                      {completed ? <CheckCircle2 className="h-4 w-4" /> : item.index}
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-foreground">{item.title}</h2>
                      <p className="mt-1 text-xs leading-6 text-muted-foreground">{item.text}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </aside>

          <section className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
            {step === 1 && (
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Bot className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-foreground">عرّف وكيلك</h2>
                    <p className="mt-1 text-sm leading-7 text-muted-foreground">
                      هذه الخطوة لا تُحتسب مكتملة إلا إذا كانت تعليمات الوكيل فعلية، لا النص الافتراضي الذي يُنشأ تلقائياً.
                    </p>
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-foreground">اسم الوكيل</span>
                    <input
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      placeholder="مثال: وكيل المبيعات"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-foreground">نوع النشاط</span>
                    <select
                      value={businessType}
                      onChange={(e) => setBusinessType(e.target.value)}
                      className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      {displaySectors.map((sector) => (
                        <option key={sector.sectorKey} value={sector.sectorKey}>{sector.nameAr}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block space-y-2">
                  <span className="text-sm font-semibold text-foreground">تعليمات الوكيل</span>
                  <textarea
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    rows={7}
                    className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm leading-7 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder={"مثال:\nرحّب بالعميل باسمه إن وُجد.\nاشرح الخدمة باختصار واضح.\nلا تؤكد السعر أو التوفر إن لم تكن المعلومة موجودة في المعرفة."}
                  />
                </label>

                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">سيُعاد استخدام الوكيل الحالي إن وُجد بدلاً من إنشاء نسخة جديدة كل مرة.</p>
                  <button
                    type="button"
                    onClick={() => saveAgentMutation.mutate()}
                    disabled={saveAgentMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {saveAgentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeft className="h-4 w-4" />}
                    حفظ ومتابعة
                  </button>
                </div>

                {saveAgentMutation.isError && (
                  <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {(saveAgentMutation.error as Error).message}
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Plug className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-foreground">اربط قناة حقيقية</h2>
                    <p className="mt-1 text-sm leading-7 text-muted-foreground">
                      نعتمد فقط على الحسابات المتصلة فعلياً في قاعدة البيانات. لا يوجد تجاوز محلي لهذه الخطوة.
                    </p>
                  </div>
                </div>

                {channelReady ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm font-semibold text-emerald-800">تم العثور على قناة متصلة وجاهزة.</p>
                    <p className="mt-1 text-xs text-emerald-700">
                      {connectedLiveChannel ? `${connectedLiveChannel.displayName} (${connectedLiveChannel.channelType === "whatsapp" ? "واتساب" : "إنستغرام"})` : "تم التحقق من الحالة من بيانات المساحة الحالية."}
                    </p>
                    <button
                      type="button"
                      onClick={() => setStep(3)}
                      className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      متابعة
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {CHANNEL_OPTIONS.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => connectChannelMutation.mutate(option.key)}
                          disabled={connectChannelMutation.isPending}
                          className="rounded-2xl border border-border bg-background p-4 text-right transition hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60"
                        >
                          <span className={cn("mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl border", option.tone)}>
                            {connectingKey === option.key ? <Loader2 className="h-4 w-4 animate-spin" /> : option.icon}
                          </span>
                          <p className="text-sm font-bold text-foreground">{option.label}</p>
                          <p className="mt-1 text-xs leading-6 text-muted-foreground">
                            {option.key === "whatsappStandard" ? "يربط رقم واتساب جديد عبر Meta Embedded Signup." : "يربط حساب إنستغرام التجاري المرتبط بصفحة Meta."}
                          </p>
                        </button>
                      ))}
                    </div>

                    {connectedChannels.length > 0 && (
                      <div className="rounded-2xl border border-border bg-background p-4">
                        <p className="text-sm font-semibold text-foreground">الحسابات المكتشفة حالياً</p>
                        <div className="mt-3 space-y-2">
                          {connectedChannels.map((account) => (
                            <div key={account.id} className="flex items-center justify-between rounded-2xl border border-border px-3 py-2 text-sm">
                              <span className="font-medium text-foreground">{account.displayName}</span>
                              <span className="text-xs text-muted-foreground">{account.channelType === "whatsapp" ? "واتساب" : account.channelType === "instagram" ? "إنستغرام" : "ماسنجر"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(channelError || metaConfigQuery.isError || channelsQuery.isError) && (
                      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                        {channelError
                          ?? (metaConfigQuery.error as Error | undefined)?.message
                          ?? (channelsQuery.error as Error | undefined)?.message}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <BookOpenText className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-foreground">أضف معرفة أولية</h2>
                    <p className="mt-1 text-sm leading-7 text-muted-foreground">
                      هذه الخطوة تنشئ أو تستخدم قاعدة معرفة حقيقية ثم تحفظ مستنداً جاهزاً مع chunks قابلة للبحث.
                    </p>
                  </div>
                </div>

                <label className="block space-y-2">
                  <span className="text-sm font-semibold text-foreground">عنوان المعرفة</span>
                  <input
                    value={knowledgeTitle}
                    onChange={(e) => setKnowledgeTitle(e.target.value)}
                    className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="مثال: معلومات النشاط"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-semibold text-foreground">محتوى المعرفة</span>
                  <textarea
                    value={knowledgeBody}
                    onChange={(e) => setKnowledgeBody(e.target.value)}
                    rows={10}
                    className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm leading-7 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder={"اكتب هنا معلومات حقيقية مثل:\n- الخدمات أو المنتجات المتاحة\n- أوقات العمل\n- سياسة التوصيل والدفع\n- ما الذي يجب أن يعتذر عنه الوكيل عند غياب المعلومة"}
                  />
                </label>

                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {knowledgeBasesQuery.data?.bases?.length ? `سيُستخدم أحدث قاعدة معرفة موجودة (${knowledgeBasesQuery.data.bases[0].name}).` : "إذا لم توجد قاعدة معرفة فسيتم إنشاء واحدة الآن."}
                  </p>
                  <button
                    type="button"
                    onClick={() => saveKnowledgeMutation.mutate()}
                    disabled={saveKnowledgeMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {saveKnowledgeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    حفظ وإنهاء التهيئة
                  </button>
                </div>

                {saveKnowledgeMutation.isError && (
                  <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {(saveKnowledgeMutation.error as Error).message}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
