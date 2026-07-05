import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, CheckCircle2, Link2, Loader2, Plug, ShieldCheck, Sparkles } from "lucide-react";
import { FaInstagram, FaWhatsapp } from "react-icons/fa6";
import { useAuth } from "@/context/AuthContext";
import { normalizeOnboardingStatus, routeForOnboardingStatus } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

const BASE = `${import.meta.env.BASE_URL}api`;
const STEP_COUNT = 2;
const FACEBOOK_SDK_SCRIPT_ID = "facebook-jssdk";
const FACEBOOK_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";

type Step = 1 | 2;

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

type MetaSignupConfigKey = "whatsappStandard" | "whatsappCoexistence" | "instagramMessenger";

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
  backendKey: "whatsapp_standard" | "whatsapp_coexistence" | "instagram_messenger";
  label: string;
  description: string;
  tone: string;
  icon: ReactNode;
}> = [
  {
    key: "whatsappStandard",
    backendKey: "whatsapp_standard",
    label: "ربط رقم واتساب جديد",
    description: "افتح رقمًا جديدًا عبر التسجيل المضمن الرسمي من Meta.",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: <FaWhatsapp className="h-5 w-5" />,
  },
  {
    key: "whatsappCoexistence",
    backendKey: "whatsapp_coexistence",
    label: "ربط رقم واتساب موجود على التطبيق",
    description: "استخدم وضع التعايش لرقم يعمل الآن على تطبيق واتساب للأعمال.",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: <FaWhatsapp className="h-5 w-5" />,
  },
  {
    key: "instagramMessenger",
    backendKey: "instagram_messenger",
    label: "ربط إنستغرام وماسنجر",
    description: "اربط الحساب التجاري والصفحات المصرح بها في نفس نافذة Meta.",
    tone: "border-pink-200 bg-pink-50 text-pink-700",
    icon: (
      <span className="flex items-center gap-1">
        <FaInstagram className="h-5 w-5" />
        <span className="text-xs font-black">+</span>
      </span>
    ),
  },
];

const JOURNEY_STEPS: Array<{
  index: Step;
  title: string;
  text: string;
  Icon: typeof Bot;
}> = [
  { index: 1, title: "أنشئ وكيلك", text: "أنشئ وكيلك الذكي وحدد دوره وأهدافه.", Icon: Bot },
  { index: 2, title: "اربط قناة", text: "اربط القناة التي تريد أن يتواصل عبرها وكيلك.", Icon: Link2 },
];

const STEP_GUIDANCE: Record<Step, { title: string; outcome: string; checklist: string[] }> = {
  1: {
    title: "عرّف وكيلك بسرعة",
    outcome: "بعد الحفظ سننقلك مباشرة إلى ربط القناة.",
    checklist: [
      "اسم واضح يفهمه فريقك",
      "تعليمات واقعية بدل النص الافتراضي",
      "يمكن تعديل هذا لاحقاً من صفحة الوكلاء",
    ],
  },
  2: {
    title: "اربط قناة تستقبل منها الرسائل فعلاً",
    outcome: "بمجرد نجاح الربط تكتمل التهيئة وتدخل لوحة التحكم مباشرة.",
    checklist: [
      "واتساب أو إنستغرام تجاري فقط",
      "الحساب يجب أن يكون متصلاً في Meta",
      "إذا كانت القناة جاهزة سنكتشفها تلقائياً",
    ],
  },
};

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
  if (key === "whatsappCoexistence") {
    return {
      setup: {},
      featureType: "whatsapp_business_app_onboarding",
      sessionInfoVersion: "3",
      version: "v4",
    };
  }
  return undefined;
}

function isWhatsAppSignupOption(key: MetaSignupConfigKey) {
  return key === "whatsappStandard" || key === "whatsappCoexistence";
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

function toWizardStep(value: 1 | 2 | 3): Step {
  return value >= 2 ? 2 : 1;
}

export default function OnboardingPage() {
  const [, navigate] = useLocation();
  const { user, onboardingStatus, refreshAuth, clearAuth } = useAuth();
  const stepContentRef = useRef<HTMLDivElement | null>(null);
  const [step, setStep] = useState<Step>(toWizardStep(onboardingStatus.currentStep));
  const [agentName, setAgentName] = useState("");
  const [businessType, setBusinessType] = useState("services_general");
  const [instructions, setInstructions] = useState("");
  const [channelError, setChannelError] = useState<string | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);
  const signupSessionInfoRef = useRef<EmbeddedSignupSessionInfo | null>(null);
  const signupSessionErrorRef = useRef<string | null>(null);
  const agentPrefilledRef = useRef(false);
  const [connectingKey, setConnectingKey] = useState<MetaSignupConfigKey | null>(null);
  // مهلة انتظار بيانات واتساب من Meta صارت طويلة (حتى 90 ثانية) — بلا رسالة توضيحية، يبدو
  // الزر معلّقاً لتاجر ينتظر بعد أن أغلق نافذة Meta بالفعل. تُعرض فقط في هذه النافذة الزمنية.
  const [isAwaitingMetaData, setIsAwaitingMetaData] = useState(false);

  useEffect(() => {
    if (onboardingStatus.completed) {
      sessionStorage.setItem("show-tour", "1");
      navigate("/dashboard");
      return;
    }
    setStep(toWizardStep(onboardingStatus.currentStep));
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
  const stepGuide = STEP_GUIDANCE[step];
  const completedCount = [
    onboardingStatus.steps.agent.completed,
    onboardingStatus.steps.channel.completed,
  ].filter(Boolean).length;
  const nextButtonLabel = step === 1
    ? "ابدأ الآن"
    : channelReady
    ? "أكمل التهيئة"
    : "تابع الربط";
  const progressHeadline = completedCount === 0
    ? "خطوتان فقط"
    : `${completedCount} من ${STEP_COUNT} مكتملة`;
  const progressText = step === 1
    ? "سنكون جاهزين للانطلاق في دقائق."
    : channelReady
    ? "تم ربط القناة بنجاح. أكمل التهيئة للدخول إلى لوحة التحكم."
    : "تم إنشاء وكيلك بنجاح. تابع لربط قناتك.";
  const visibleChannelOptions = CHANNEL_OPTIONS.filter((option) => {
    if (option.key === "instagramMessenger") {
      return !connectedChannels.some((item) => (item.channelType === "instagram" || item.channelType === "messenger") && item.status === "active");
    }
    return !connectedChannels.some((item) => item.channelType === "whatsapp" && item.status === "active");
  });

  function scrollToStepContent() {
    stepContentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleHeroAction() {
    if (step === 2 && channelReady) {
      void finishOnboarding();
      return;
    }
    scrollToStepContent();
  }

  async function finishOnboarding() {
    setFinishError(null);
    setIsFinishing(true);
    try {
      await apiFetch("workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { onboarding_completed: true } }),
      });
      await refreshAuth();
      const authSnapshot = await apiFetch<{ onboardingStatus?: unknown; onboardingCompleted?: boolean }>("auth/me");
      const nextStatus = normalizeOnboardingStatus(authSnapshot.onboardingStatus, authSnapshot.onboardingCompleted === true);
      if (!nextStatus.completed) {
        throw new Error("تم الحفظ لكن لم تكتمل التهيئة بعد. تحقق من الوكيل والقناة ثم حاول مجدداً.");
      }
      navigate(routeForOnboardingStatus(nextStatus));
    } catch (err) {
      setFinishError((err as Error).message);
    } finally {
      setIsFinishing(false);
    }
  }

  // 6 يوليو 2026: عميل حقيقي (شركة صرافة أولى الاستخدام) حاول الربط لـ44 دقيقة متتالية —
  // صفر استدعاء /complete رغم عشرات محاولاته. السبب الأرجح: أول مرة يعبر تاجر خطوات إعداد
  // واتساب للأعمال داخل نافذة ميتا نفسها (اختيار/إنشاء حساب، تسجيل رقم، تحقّق OTP) — هذه
  // خطوات تستغرق حقيقةً دقائق لا ثوانٍ لمستخدم جديد، بخلاف حساب مُهيّأ مسبقاً (حالة الإصلاح
  // الأصلي 5 يوليو الذي رفع المهلة من 5 إلى 20 ثانية فقط). رفعناها الآن لتغطي فعلياً رحلة
  // أول مرة، لا مجرد تأخر شبكة قصير.
  function waitForCapturedSignupInfo(timeoutMs = 90000): Promise<EmbeddedSignupSessionInfo> {
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
          reject(new Error("لم نستلم بيانات واتساب من نافذة Meta بعد. تأكد أنك أكملت كل خطوات الربط داخل نافذة Meta (اختيار الحساب، رقم الهاتف، والتحقق منه) ثم أعد المحاولة."));
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
      const selectedOption = CHANNEL_OPTIONS.find((option) => option.key === optionKey);
      if (!selectedOption) throw new Error("نوع الربط غير معروف.");
      const config = metaConfigQuery.data;
      if (!config?.appId) throw new Error("إعدادات Meta غير جاهزة بعد.");
      const configId = config.configIds[optionKey];
      if (!configId) throw new Error("هذه القناة غير مهيأة بعد.");
      signupSessionInfoRef.current = null;
      signupSessionErrorRef.current = null;
      await loadFacebookSdk(config.appId, config.graphVersion);
      const code = await loginWithFacebook(configId, optionKey);
      if (isWhatsAppSignupOption(optionKey)) {
        setIsAwaitingMetaData(true);
        let sessionInfo: EmbeddedSignupSessionInfo;
        try {
          sessionInfo = await waitForCapturedSignupInfo();
        } finally {
          setIsAwaitingMetaData(false);
        }
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
            config_key: selectedOption.backendKey,
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
      setIsAwaitingMetaData(false);
      setConnectingKey(optionKey);
    },
    onSettled: () => setConnectingKey(null),
    onSuccess: () => void finishOnboarding(),
    onError: (error) => setChannelError((error as Error).message),
  });

  const resendVerificationMutation = useMutation({
    mutationFn: () => apiFetch("auth/resend-verification", { method: "POST" }),
  });

  // بلا هذا الزر، عميل سجّل بإيميل وهمي ليجرّب الواجهة يبقى محاصراً هنا للأبد (لا يقدر يتحقّق،
  // ولا يقدر يخرج ليبدأ من جديد بإيميل حقيقي) — سبب انسحاب حقيقي مؤكَّد. نفس مسار Layout.tsx بالضبط.
  const logoutMutation = useMutation({
    mutationFn: () => apiFetch("auth/logout", { method: "POST" }),
    onSuccess: () => {
      clearAuth();
      window.location.href = "/login";
    },
  });

  function stepBadge(index: Step) {
    const completed = index === 1 ? onboardingStatus.steps.agent.completed : onboardingStatus.steps.channel.completed;
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
    <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_top,_rgba(89,96,255,0.08),_transparent_35%),linear-gradient(180deg,#f7f8ff_0%,#ffffff_45%,#f8fafc_100%)]" dir="rtl">
      <div className="mx-auto flex min-h-[100dvh] max-w-4xl flex-col px-4 pb-10 pt-[calc(1rem+var(--app-safe-top))] sm:px-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[#8d92ff] text-lg font-black text-white shadow-lg shadow-primary/20">
              W
            </div>
            <div>
              <p className="text-lg font-black tracking-[0.18em] text-foreground">WESAL ONE</p>
            </div>
          </div>
          <div className="flex h-11 min-w-[2.75rem] items-center justify-center rounded-full bg-primary/10 px-3 text-base font-bold text-primary">
            {user?.name?.trim().slice(0, 1) ?? "A"}
          </div>
        </div>

        {user && user.emailVerified === false ? (
        <section className="rounded-[2rem] border border-amber-200 bg-amber-50/90 p-6 shadow-[0_24px_80px_rgba(217,119,6,0.12)] backdrop-blur sm:p-10">
          <div className="mx-auto max-w-md text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-3xl">
              ✉️
            </div>
            <h1 className="text-2xl font-black text-amber-900 sm:text-3xl">تأكيد البريد الإلكتروني مطلوب</h1>
            <p className="mt-3 text-sm text-amber-800">أرسلنا رابط تأكيد إلى</p>
            <p className="mt-1 font-semibold text-amber-900">{user.email}</p>
            <p className="mt-4 text-sm leading-7 text-amber-700">
              لا يمكن إنشاء الوكيل أو ربط القناة أو حفظ أي خطوة قبل تأكيد بريدك. تحقق من صندوق الوارد (وربما الرسائل غير المرغوبة) وابحث عن رسالة من <strong>support@wesal.one</strong>.
            </p>
            <button
              type="button"
              onClick={() => resendVerificationMutation.mutate()}
              disabled={resendVerificationMutation.isPending || resendVerificationMutation.isSuccess}
              className="mt-6 w-full rounded-2xl bg-amber-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-amber-700 disabled:opacity-60"
            >
              {resendVerificationMutation.isPending
                ? "جارٍ الإرسال..."
                : resendVerificationMutation.isSuccess
                ? "تم إرسال الرابط — تحقق من بريدك"
                : "إعادة إرسال رابط التأكيد"}
            </button>
            <button
              type="button"
              onClick={() => refreshAuth()}
              className="mt-3 w-full rounded-2xl border border-amber-300 bg-white px-5 py-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
            >
              تحققت من بريدي، تابع الآن
            </button>
            <button
              type="button"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="mt-3 w-full rounded-2xl px-5 py-3 text-sm font-semibold text-amber-700 underline-offset-2 transition hover:underline disabled:opacity-60"
            >
              {logoutMutation.isPending ? "جارٍ تسجيل الخروج..." : "تسجيل الخروج والبدء بإيميل آخر"}
            </button>
          </div>
        </section>
        ) : (
        <>
        <section className="rounded-[2rem] border border-white/80 bg-white/95 p-5 shadow-[0_24px_80px_rgba(83,96,255,0.12)] backdrop-blur sm:p-8">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-3xl font-black text-foreground sm:text-4xl">ابدأ إعداد وكيلك</h1>
            <p className="mt-3 text-base leading-8 text-muted-foreground sm:text-lg">
              إعداد سريع يساعدك على إطلاق وكيلك وتوصيله بعملائك في دقائق.
            </p>
          </div>

          <div className="relative mx-auto mt-8 max-w-2xl px-1 sm:mt-10">
            <svg viewBox="0 0 600 160" className="pointer-events-none absolute inset-x-0 top-0 h-[140px] w-full">
              <path d="M150 126 Q300 70 450 126" fill="none" stroke="rgba(93,99,255,0.45)" strokeWidth="4" strokeLinecap="round" />
            </svg>

            <div className="relative grid grid-cols-2 gap-3 pt-14 sm:gap-6 sm:pt-16">
              {JOURNEY_STEPS.map((item) => {
                const completed = item.index === 1 ? onboardingStatus.steps.agent.completed : onboardingStatus.steps.channel.completed;
                const active = step === item.index;
                const canOpen = item.index <= step;
                const Icon = item.Icon;
                return (
                  <button
                    key={item.index}
                    type="button"
                    onClick={() => canOpen && setStep(item.index)}
                    disabled={!canOpen}
                    className="flex flex-col items-center text-center"
                  >
                    <div className="relative">
                      <div
                        className={cn(
                          "flex h-24 w-24 items-center justify-center rounded-full border bg-white shadow-lg transition-all sm:h-28 sm:w-28",
                          active ? "border-primary shadow-[0_0_0_10px_rgba(93,99,255,0.10),0_18px_36px_rgba(93,99,255,0.18)]" : "border-white shadow-[0_12px_28px_rgba(15,23,42,0.10)]",
                          completed && !active && "border-emerald-200"
                        )}
                      >
                        <span className={cn(
                          "flex h-16 w-16 items-center justify-center rounded-full",
                          active ? "bg-primary/10 text-primary" : completed ? "bg-emerald-50 text-emerald-600" : "bg-muted text-muted-foreground",
                        )}>
                          <Icon className="h-8 w-8" />
                        </span>
                      </div>
                      <span
                        className={cn(
                          "absolute -top-2 right-1 flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-black text-white shadow-md",
                          completed ? "bg-emerald-500" : active ? "bg-primary" : "bg-slate-300"
                        )}
                      >
                        {completed ? <CheckCircle2 className="h-4 w-4" /> : item.index}
                      </span>
                    </div>
                    <h2 className={cn("mt-4 text-lg font-black sm:text-2xl", active || completed ? "text-primary" : "text-foreground")}>{item.title}</h2>
                    <p className="mt-2 max-w-[11rem] text-sm leading-7 text-muted-foreground sm:max-w-[12rem]">{item.text}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mx-auto mt-8 max-w-xl rounded-3xl border border-primary/10 bg-primary/5 px-5 py-4 text-center">
            <div className="flex items-center justify-center gap-2 text-primary">
              <Sparkles className="h-4 w-4" />
              <p className="text-lg font-black">{progressHeadline}</p>
            </div>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">{progressText}</p>
          </div>

          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={handleHeroAction}
              className="inline-flex min-w-[220px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-[#646bff] px-8 py-4 text-lg font-bold text-white shadow-[0_20px_40px_rgba(93,99,255,0.25)] transition hover:opacity-95"
            >
              <ArrowLeft className="h-5 w-5" />
              {nextButtonLabel}
            </button>
          </div>
        </section>

        <section ref={stepContentRef} className="mt-6 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="mb-6 rounded-3xl border border-primary/15 bg-primary/5 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold text-primary">الخطوة الحالية</p>
                <h2 className="mt-1 text-lg font-black text-foreground">{stepGuide.title}</h2>
                <p className="mt-1 text-sm leading-7 text-muted-foreground">{stepGuide.outcome}</p>
              </div>
              <div className="rounded-2xl border border-primary/15 bg-background px-3 py-2 text-xs font-semibold text-muted-foreground">
                خطوة {step} من {STEP_COUNT}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {stepGuide.checklist.map((item) => (
                <span key={item} className="rounded-full border border-primary/15 bg-background px-3 py-1.5 text-xs font-medium text-foreground">
                  {item}
                </span>
              ))}
            </div>
          </div>
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

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">سيُعاد استخدام الوكيل الحالي إن وُجد بدلاً من إنشاء نسخة جديدة كل مرة.</p>
                  <button
                    type="button"
                    onClick={() => saveAgentMutation.mutate()}
                    disabled={saveAgentMutation.isPending}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 sm:w-auto"
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
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                      <button
                        type="button"
                        onClick={() => void finishOnboarding()}
                        disabled={isFinishing}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 sm:w-auto"
                      >
                        {isFinishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeft className="h-4 w-4" />}
                        أكمل التهيئة
                      </button>
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 sm:w-auto"
                      >
                        رجوع لتعريف الوكيل
                      </button>
                    </div>
                    {finishError && (
                      <div className="mt-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                        {finishError}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-3">
                      {visibleChannelOptions.map((option) => {
                        const configId = metaConfigQuery.data?.configIds[option.key] ?? null;
                        const disabled = connectChannelMutation.isPending || !configId;
                        return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => connectChannelMutation.mutate(option.key)}
                          disabled={disabled}
                          className="rounded-3xl border border-border bg-background p-4 text-right transition hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60"
                        >
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <span className={cn("inline-flex h-12 w-12 items-center justify-center rounded-2xl border", option.tone)}>
                            {connectingKey === option.key ? <Loader2 className="h-4 w-4 animate-spin" /> : option.icon}
                            </span>
                            <span className={cn(
                              "rounded-full px-2.5 py-1 text-[11px] font-bold",
                              configId ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                            )}>
                              {configId ? "جاهز للربط" : "غير مهيأ"}
                            </span>
                          </div>
                          <p className="text-sm font-bold text-foreground">{option.label}</p>
                          <p className="mt-2 text-xs leading-6 text-muted-foreground">{option.description}</p>
                        </button>
                      )})}
                    </div>

                    {isAwaitingMetaData && (
                      <div className="flex items-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">
                        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                        <span>جارٍ تأكيد بيانات واتساب من Meta — إن كنت لا تزال داخل خطوات الربط (اختيار الحساب أو رقم الهاتف أو التحقق منه)، أكملها؛ قد يستغرق هذا حتى دقيقة.</span>
                      </div>
                    )}

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

        </section>
        </>
        )}

        <div className="mt-5 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          بياناتك آمنة ومشفرة
        </div>
      </div>
    </div>
  );
}
