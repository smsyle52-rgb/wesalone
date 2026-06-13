import { Link } from "wouter";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils";

const BASE = `${import.meta.env.BASE_URL}api`;
const FACEBOOK_SDK_SCRIPT_ID = "facebook-jssdk";
const FACEBOOK_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";

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

type EmbeddedSignupSessionInfo = {
  waba_id?: string;
  phone_number_id?: string;
  display_phone_number?: string;
  verified_name?: string;
};

type MetaSignupConfigKey = keyof MetaSignupConfig["configIds"];

type EmbeddedSignupMessage = {
  eventName?: string;
  info?: EmbeddedSignupSessionInfo;
  errorMessage?: string;
};

const metaSignupOptions: Array<{ key: MetaSignupConfigKey; backendKey: string; label: string }> = [
  { key: "whatsappStandard", backendKey: "whatsapp_standard", label: "ربط رقم واتساب جديد" },
  { key: "whatsappCoexistence", backendKey: "whatsapp_coexistence", label: "ربط رقم واتساب موجود (تعايش)" },
  { key: "instagramMessenger", backendKey: "instagram_messenger", label: "ربط إنستغرام وماسنجر" },
  { key: "facebookContent", backendKey: "facebook_content", label: "ربط صفحات فيسبوك" },
];

let facebookSdkPromise: Promise<void> | null = null;
let initializedFacebookSdkKey: string | null = null;

function configIdLast4(configId: string | null | undefined) {
  return configId ? configId.slice(-4) : null;
}

function isWhatsAppSignupOption(key: MetaSignupConfigKey) {
  return key === "whatsappStandard" || key === "whatsappCoexistence";
}

function logMetaSignupDiagnostic(event: string, details: Record<string, unknown>) {
  console.info("[Meta Embedded Signup]", event, details);
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

function embeddedSignupEventName(record: Record<string, unknown>, nested: Record<string, unknown>): string | undefined {
  return (
    stringField(record, "event")
    ?? stringField(record, "eventName")
    ?? stringField(record, "status")
    ?? stringField(nested, "event")
    ?? stringField(nested, "eventName")
    ?? stringField(nested, "status")
  )?.toUpperCase();
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
  const eventName = embeddedSignupEventName(record, nested);
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
    errorMessage: stringField(nested, "error_message") ?? stringField(nested, "errorMessage") ?? stringField(nested, "message"),
  };
}

async function fetchMetaSignupConfig(): Promise<MetaSignupConfig> {
  const res = await fetch(`${BASE}/integrations/meta/embedded-signup/config`, { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? data.missing?.join(", ") ?? "Meta config is not available");
  return data;
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
      logMetaSignupDiagnostic("fb_login_callback", {
        status: response.status ?? "unknown",
        codeReceived: Boolean(code),
      });
      if (code) {
        resolve(code);
        return;
      }
      reject(new Error(response.status ? `Meta signup did not complete: ${response.status}` : "Meta signup did not return a code"));
    }, loginOptions);
  });
}

type ConnectedChannel = {
  id: string;
  channelType: "whatsapp" | "instagram" | "messenger";
  displayName: string;
  status: string;
  hasCredentialReference: boolean;
  providerConfig?: Record<string, unknown>;
  updatedAt?: string;
};

const manualChannels = [
  {
    name: "الصندوق اليدوي",
    status: "available",
    description: "متاح الآن لإدارة محادثات العملاء يدوياً واستيراد نصوص المحادثات عند الحاجة.",
    action: "فتح صندوق الوارد",
    href: "/inbox",
  },
  {
    name: "تيليجرام",
    status: "soon",
    description: "قريباً. تيليجرام مزود مستقل وسيتم إضافته لاحقاً عند الحاجة التجارية.",
  },
  {
    name: "موقعك الإلكتروني",
    status: "soon",
    description: "قريباً لاستقبال رسائل الموقع داخل صندوق الوارد.",
  },
];

const safeguards = [
  "لا يوجد إرسال تلقائي إلا عبر وضع الثقة المصرح به",
  "لا تظهر رموز الوصول أو أسرار Meta في الواجهة",
  "كل قناة مرتبطة تبقى داخل مساحة العمل الحالية فقط",
  "عند غياب أسرار Meta يعمل النظام في وضع DRY_RUN الآمن",
];

function ChannelCard({ channel }: { channel: (typeof manualChannels)[number] }) {
  const available = channel.status === "available";
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{channel.name}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{channel.description}</p>
        </div>
        <span className={cn(
          "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium",
          available ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700",
        )}>
          {available ? "متاح الآن" : "قريباً"}
        </span>
      </div>
      {available && channel.href ? (
        <Link href={channel.href}>
          <span className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            {channel.action}
          </span>
        </Link>
      ) : (
        <button
          disabled
          title="سيتم تفعيله لاحقاً بعد الربط الرسمي"
          className="rounded-lg border border-border bg-muted px-4 py-2 text-sm font-medium text-muted-foreground opacity-70"
        >
          سيتم تفعيله لاحقاً
        </button>
      )}
    </div>
  );
}

function ConnectedChannelCard({ channel }: { channel: ConnectedChannel }) {
  const label = channel.channelType === "whatsapp"
    ? "واتساب"
    : channel.channelType === "instagram"
      ? "إنستقرام"
      : "ماسنجر";

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{label}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{channel.displayName}</p>
        </div>
        <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
          {channel.status === "active" ? "نشط" : channel.status}
        </span>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {channel.hasCredentialReference ? "رمز الوصول محفوظ كمرجع آمن." : "لا يوجد مرجع رمز وصول بعد."}
      </p>
    </div>
  );
}

export default function IntegrationsPage() {
  const [isStartingMeta, setIsStartingMeta] = useState(false);
  const [startingMetaConfigKey, setStartingMetaConfigKey] = useState<MetaSignupConfigKey | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [connectedChannels, setConnectedChannels] = useState<ConnectedChannel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [metaSignupConfig, setMetaSignupConfig] = useState<MetaSignupConfig | null>(null);
  const metaSignupInFlightRef = useRef(false);
  const signupSessionInfoRef = useRef<EmbeddedSignupSessionInfo | null>(null);
  const signupSessionErrorRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadChannels() {
      setIsLoadingChannels(true);
      try {
        const res = await fetch(`${BASE}/integrations/meta/channels`, { credentials: "include" });
        const data = await res.json();
        if (!cancelled && res.ok) setConnectedChannels(data.accounts ?? []);
      } finally {
        if (!cancelled) setIsLoadingChannels(false);
      }
    }
    void loadChannels();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      try {
        const config = await fetchMetaSignupConfig();
        if (cancelled) return;
        setMetaSignupConfig(config);
        if (config.appId) {
          void loadFacebookSdk(config.appId, config.graphVersion).catch(() => {
            logMetaSignupDiagnostic("sdk_preload_failed", {
              appIdPresent: true,
              sdkLoaded: false,
            });
          });
        }
      } catch (err) {
        logMetaSignupDiagnostic("config_preload_failed", {
          appIdPresent: false,
          error: (err as Error).message,
        });
      }
    }
    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!isFacebookOrigin(event.origin)) return;
      const message = parseEmbeddedSignupMessage(event.data);
      if (!message) return;
      logMetaSignupDiagnostic("embedded_signup_message", {
        trustedOrigin: true,
        eventName: message.eventName ?? "UNKNOWN",
        wabaIdReceived: Boolean(message.info?.waba_id),
        phoneNumberIdReceived: Boolean(message.info?.phone_number_id),
      });
      if (message.eventName === "CANCEL") {
        signupSessionErrorRef.current = "تم إلغاء التسجيل المضمن من Meta.";
        return;
      }
      if (message.eventName === "ERROR") {
        signupSessionErrorRef.current = message.errorMessage ?? "تعذر إكمال التسجيل المضمن من Meta.";
        return;
      }
      if (
        (message.eventName === "FINISH" || message.eventName === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING")
        && (!message.info?.waba_id || !message.info?.phone_number_id)
      ) {
        signupSessionErrorRef.current = "اكتمل التسجيل المضمن لكن لم تصل معرفات واتساب المطلوبة.";
        return;
      }
      const info = message.info;
      if (!info) return;
      signupSessionInfoRef.current = {
        ...signupSessionInfoRef.current,
        ...info,
      };
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

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
          logMetaSignupDiagnostic("embedded_signup_identifiers", {
            wabaIdReceived: Boolean(signupSessionInfoRef.current?.waba_id),
            phoneNumberIdReceived: Boolean(signupSessionInfoRef.current?.phone_number_id),
          });
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
          logMetaSignupDiagnostic("embedded_signup_identifiers", {
            wabaIdReceived: Boolean(signupSessionInfoRef.current?.waba_id),
            phoneNumberIdReceived: Boolean(signupSessionInfoRef.current?.phone_number_id),
          });
          reject(new Error("Meta signup did not return WhatsApp account identifiers"));
        }
      }, 100);
    });
  }

  async function completeEmbeddedSignup(code: string, configId: string, configKey: string, sessionInfo: EmbeddedSignupSessionInfo) {
    const res = await fetch(`${BASE}/integrations/meta/embedded-signup/complete`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        waba_id: sessionInfo.waba_id,
        phone_number_id: sessionInfo.phone_number_id,
        display_phone_number: sessionInfo.display_phone_number,
        verified_name: sessionInfo.verified_name,
        config_id: configId,
        config_key: configKey,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Meta embedded signup failed");
    const account = data.account as ConnectedChannel | undefined;
    if (account) {
      setConnectedChannels((current) => [account, ...current.filter((item) => item.id !== account.id)]);
    }
  }

  async function startMetaSignup(option = metaSignupOptions[0]) {
    if (metaSignupInFlightRef.current) {
      logMetaSignupDiagnostic("signup_ignored", {
        optionKey: option.key,
        reason: "already_in_progress",
      });
      return;
    }
    metaSignupInFlightRef.current = true;
    setIsStartingMeta(true);
    setStartingMetaConfigKey(option.key);
    setMetaError(null);
    let codeReceived = false;
    try {
      logMetaSignupDiagnostic("signup_selected", {
        optionKey: option.key,
        backendKey: option.backendKey,
        whatsappEmbedded: isWhatsAppSignupOption(option.key),
      });

      let config: MetaSignupConfig;
      try {
        config = metaSignupConfig ?? await fetchMetaSignupConfig();
      } catch (err) {
        logMetaSignupDiagnostic("config_load_failed", {
          optionKey: option.key,
          appIdPresent: false,
          configKey: option.key,
          error: (err as Error).message,
        });
        throw new Error("تعذر تحميل إعدادات التسجيل المضمن من Meta. تحقق من الإعدادات وحاول مرة أخرى.");
      }
      if (config && !metaSignupConfig) setMetaSignupConfig(config);
      const configId = config?.configIds[option.key] ?? null;
      logMetaSignupDiagnostic("config_loaded", {
        optionKey: option.key,
        appIdPresent: Boolean(config.appId),
        configKey: option.key,
        configIdPresent: Boolean(configId),
        configIdLast4: configIdLast4(configId),
      });

      if (!config.appId) {
        throw new Error("Meta App ID غير مهيأ لهذا الربط.");
      }
      if (!configId) {
        throw new Error("Meta config_id is not configured for this signup type");
      }

      try {
        await loadFacebookSdk(config.appId, config.graphVersion || "v22.0");
        logMetaSignupDiagnostic("sdk_load_result", {
          optionKey: option.key,
          sdkLoaded: true,
          appIdPresent: true,
        });
      } catch (err) {
        logMetaSignupDiagnostic("sdk_load_result", {
          optionKey: option.key,
          sdkLoaded: false,
          appIdPresent: true,
          error: (err as Error).message,
        });
        throw new Error("تعذر تحميل Facebook SDK. تحقق من إعدادات الدومين في Meta أو من حظر المتصفح للسكريبتات.");
      }

      signupSessionInfoRef.current = null;
      signupSessionErrorRef.current = null;
      const code = await loginWithFacebook(configId, option.key);
      codeReceived = Boolean(code);
      const sessionInfo = await waitForCapturedSignupInfo();
      logMetaSignupDiagnostic("embedded_signup_identifiers", {
        optionKey: option.key,
        codeReceived: Boolean(code),
        wabaIdReceived: Boolean(sessionInfo.waba_id),
        phoneNumberIdReceived: Boolean(sessionInfo.phone_number_id),
      });
      await completeEmbeddedSignup(code, configId, option.backendKey, sessionInfo);
    } catch (err) {
      logMetaSignupDiagnostic("signup_failed", {
        optionKey: option.key,
        codeReceived,
        wabaIdReceived: Boolean(signupSessionInfoRef.current?.waba_id),
        phoneNumberIdReceived: Boolean(signupSessionInfoRef.current?.phone_number_id),
        error: (err as Error).message,
      });
      setMetaError((err as Error).message);
    } finally {
      metaSignupInFlightRef.current = false;
      setIsStartingMeta(false);
      setStartingMetaConfigKey(null);
    }
  }

  async function disconnectChannel(id: string) {
    setDisconnectingId(id);
    setMetaError(null);
    try {
      const res = await fetch(`${BASE}/integrations/channels/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "تعذر فصل القناة");
      setConnectedChannels((current) => current.map((channel) => (
        channel.id === id ? { ...channel, status: "disabled", updatedAt: data.account?.updatedAt ?? channel.updatedAt } : channel
      )));
    } catch (err) {
      setMetaError((err as Error).message);
    } finally {
      setDisconnectingId(null);
    }
  }

  const metaChannelStatuses = (["whatsapp", "instagram", "messenger"] as const).map((type) => {
    const channel = connectedChannels.find((item) => item.channelType === type && item.status === "active");
    return { type, channel };
  });
  const metaSignupButtons = metaSignupOptions.map((option) => ({
    ...option,
    configId: metaSignupConfig?.configIds[option.key] ?? null,
  }));

  return (
    <div dir="rtl" className="space-y-6">
      <PageHeader
        title="القنوات"
        subtitle="شغّل قنوات العملاء من مكان واحد، مع إبقاء الأسرار والرموز خارج الواجهة."
      />

      <section className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-blue-900">
        <h2 className="text-base font-semibold">ابدأ من الصندوق اليدوي</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed">
          يمكنك تشغيل الفريق من الصندوق اليدوي الآن. وعند جاهزية إعدادات Meta، يمكن ربط واتساب وإنستقرام وماسنجر عبر نفس المسار الرسمي دون تغيير طريقة العمل داخل صندوق الوارد.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">قنوات Meta</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              يدعم المسار الموحد اختيار واتساب وإنستقرام وماسنجر بعد إكمال الربط. في وضع التطوير لا يتم أي إرسال خارجي.
            </p>
            {metaError && <p className="mt-2 text-sm text-destructive">{metaError}</p>}
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 md:w-auto">
            {metaSignupButtons.map((option) => {
              const disabled = isStartingMeta || (!option.configId && !isWhatsAppSignupOption(option.key));
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => startMetaSignup(option)}
                  disabled={disabled}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {startingMetaConfigKey === option.key ? "جار التجهيز..." : option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          {metaChannelStatuses.map((item) => (
            <div key={item.type} className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-foreground">
                  {item.type === "whatsapp" ? "WhatsApp" : item.type === "instagram" ? "Instagram" : "Messenger"}
                </span>
                <span className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium",
                  item.channel ? "border-green-200 bg-green-50 text-green-700" : "border-slate-200 bg-slate-50 text-slate-600",
                )}>
                  {item.channel ? "متصل" : "غير متصل"}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {item.channel?.displayName ?? "لم يتم ربط قناة بعد"}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          {isLoadingChannels ? (
            <div className="rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
              جار تحميل القنوات المرتبطة...
            </div>
          ) : connectedChannels.length > 0 ? (
            connectedChannels.map((channel) => (
              <div key={channel.id} className="space-y-2">
                <ConnectedChannelCard channel={channel} />
                <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
                  <span className="text-xs text-muted-foreground">
                    آخر نشاط: {channel.updatedAt ? new Date(channel.updatedAt).toLocaleString("ar-YE-u-nu-latn") : "غير متاح"}
                  </span>
                  <button
                    type="button"
                    onClick={() => disconnectChannel(channel.id)}
                    disabled={disconnectingId === channel.id || channel.status === "disabled"}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
                  >
                    فصل
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-background p-4 text-sm text-muted-foreground md:col-span-3">
              لا توجد قنوات Meta مرتبطة بعد. أكمل الربط الرسمي ثم اختر القنوات التي تريد تشغيلها.
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {manualChannels.map((channel) => (
          <ChannelCard key={channel.name} channel={channel} />
        ))}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">ضمانات التشغيل</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {safeguards.map((item) => (
            <div key={item} className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground">
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
