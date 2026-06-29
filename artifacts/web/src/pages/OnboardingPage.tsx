import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, Check, ChevronLeft, MessageCircle, Plug, Send, Sparkles, X } from "lucide-react";
import { FaInstagram, FaWhatsapp } from "react-icons/fa6";
import { FaFacebookMessenger } from "react-icons/fa6";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

const BASE = `${import.meta.env.BASE_URL}api`;

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "خطأ في الطلب");
  }
  return res.json();
}

const STEP_COUNT = 5;

type Step = 1 | 2 | 3 | 4 | 5;

type ChannelOption = { key: string; label: string; icon: React.ReactNode; backendKey: string; configKey: string };

const CHANNEL_OPTIONS: ChannelOption[] = [
  { key: "whatsapp", label: "واتساب", icon: <FaWhatsapp className="h-7 w-7" />, backendKey: "whatsapp_standard", configKey: "whatsappStandard" },
  { key: "instagram", label: "إنستغرام وماسنجر", icon: <FaInstagram className="h-7 w-7" />, backendKey: "instagram_messenger", configKey: "instagramMessenger" },
  { key: "messenger", label: "ماسنجر / صفحات", icon: <FaFacebookMessenger className="h-7 w-7" />, backendKey: "facebook_content", configKey: "facebookContent" },
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


export default function OnboardingPage() {
  const [, navigate] = useLocation();
  const { user, setOnboardingCompleted, workspaceId } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [agentName, setAgentName] = useState("");
  const [channelConnected, setChannelConnected] = useState(false);
  const [connectingChannel, setConnectingChannel] = useState<string | null>(null);
  const [businessType, setBusinessType] = useState("services_general");
  const [instructions, setInstructions] = useState("");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [testInput, setTestInput] = useState("");
  const [testMessages, setTestMessages] = useState<Array<{ from: "user" | "agent"; text: string }>>([]);
  const [testReplying, setTestReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sectorsQuery = useQuery({ queryKey: ["sector-profiles-ob"], queryFn: () => apiFetch("sectors") });
  const sectors: Array<{ sectorKey: string; nameAr: string }> = sectorsQuery.data?.sectors ?? [];
  const displaySectors = sectors.length > 0 ? sectors : BUSINESS_TYPES.map((b) => ({ sectorKey: b.key, nameAr: b.label }));

  const fbSignupConfigQuery = useQuery({
    queryKey: ["fb-signup-config"],
    queryFn: () => apiFetch("integrations/meta/embedded-signup/config"),
    enabled: step === 2,
    retry: false,
  });
  const fbConfig = fbSignupConfigQuery.data as { appId?: string | null; graphVersion?: string; configIds?: Record<string, string | null> } | undefined;

  const fbSdkReady = useRef(false);
  useEffect(() => {
    if (step !== 2 || fbSdkReady.current || !fbConfig?.appId) return;
    const appId = fbConfig.appId;
    const version = fbConfig.graphVersion ?? "v22.0";
    if (window.FB) { try { window.FB.init({ appId, cookie: true, xfbml: false, version }); fbSdkReady.current = true; } catch { /* ignore */ } return; }
    window.fbAsyncInit = () => { if (window.FB) { window.FB.init({ appId, cookie: true, xfbml: false, version }); fbSdkReady.current = true; } };
    if (!document.getElementById("facebook-jssdk")) {
      const s = document.createElement("script");
      s.id = "facebook-jssdk"; s.async = true; s.defer = true; s.crossOrigin = "anonymous";
      s.src = "https://connect.facebook.net/en_US/sdk.js";
      document.body.appendChild(s);
    }
  }, [step, fbConfig]);

  function startEmbeddedSignup(channel: ChannelOption) {
    if (!window.FB || !fbConfig?.configIds) {
      setError("تعذر تحميل نافذة الربط. جرب مرة أخرى أو تجاوز هذه الخطوة.");
      return;
    }
    const configId = fbConfig.configIds[channel.configKey];
    if (!configId) { setError("هذه القناة غير مهيأة بعد. اختر قناة أخرى أو تجاوز هذه الخطوة."); return; }
    setConnectingChannel(channel.key);
    setError(null);
    window.FB.login(
      async (response) => {
        setConnectingChannel(null);
        if (!response.authResponse?.code) return;
        try {
          await apiFetch("integrations/meta/embedded-signup/callback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: response.authResponse.code, type: channel.backendKey }),
          });
          setChannelConnected(true);
        } catch (e) {
          setError((e as Error).message ?? "فشل ربط القناة");
        }
      },
      {
        config_id: configId,
        response_type: "code" as const,
        override_default_response_type: true as const,
        extras: channel.key === "whatsapp"
          ? { sessionInfoVersion: "3" as const, version: "v4" as const }
          : undefined,
      },
    );
  }

  const createAgentMut = useMutation({
    mutationFn: async () => {
      const created = await apiFetch("ai/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: agentName.trim() || "وكيل المبيعات", type: "support", defaultModel: "gemini_flash", dialect: "standard_arabic" }),
      });
      const id = created.agent.id as string;
      if (businessType || instructions.trim()) {
        await apiFetch(`ai/agents/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sectorKey: businessType }),
        });
      }
      if (instructions.trim()) {
        await apiFetch(`ai/agents/${id}/instructions`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rolePrompt: instructions, businessRules: "", forbiddenActions: "", escalationRules: "" }),
        });
      }
      return id;
    },
    onSuccess: (id) => { setAgentId(id); setStep(5); },
    onError: (e) => setError((e as Error).message),
  });

  async function finishOnboarding() {
    setFinishing(true);
    try {
      await apiFetch("workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { onboarding_completed: true } }),
      });
    } catch { /* silent */ }
    sessionStorage.setItem("show-tour", "1");
    setOnboardingCompleted(true);
    navigate("/dashboard");
  }

  async function sendTestMessage() {
    const text = testInput.trim();
    if (!text || testReplying) return;
    setTestMessages((prev) => [...prev, { from: "user", text }]);
    setTestInput("");
    setTestReplying(true);
    try {
      if (agentId) {
        const data = await apiFetch("ai/runs/draft-reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId, message: text }),
        });
        setTestMessages((prev) => [...prev, { from: "agent", text: (data as { draft?: string }).draft ?? "تم استلام رسالتك." }]);
      } else {
        setTestMessages((prev) => [...prev, { from: "agent", text: "سيرد وكيلك على رسائل العملاء بأسلوب مهني حسب تعليماتك." }]);
      }
    } catch {
      setTestMessages((prev) => [...prev, { from: "agent", text: "تعذر الاتصال بالوكيل الآن. سيكون جاهزاً عند بدء الخدمة." }]);
    } finally {
      setTestReplying(false);
    }
  }

  async function skipOnboarding() {
    try {
      await apiFetch("workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { onboarding_completed: true } }),
      });
    } catch { /* silent */ }
    setOnboardingCompleted(true);
    navigate("/dashboard");
  }

  function nextStep() { setError(null); setStep((s) => Math.min(s + 1, STEP_COUNT) as Step); }
  function prevStep() { setError(null); setStep((s) => Math.max(s - 1, 1) as Step); }

  const canAdvanceStep1 = agentName.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex min-h-[100dvh] flex-col overflow-hidden bg-gradient-to-br from-primary/5 via-background to-accent/10" dir="rtl">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-card/80 px-4 pb-3 pt-[calc(0.75rem+var(--app-safe-top))] backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white font-bold text-sm">و</div>
          <span className="text-sm font-bold text-foreground">وصال ون</span>
        </div>
        <button
          onClick={skipOnboarding}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          <X className="h-3.5 w-3.5" />
          أكمل لاحقاً
        </button>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1 px-4 pt-4">
        {Array.from({ length: STEP_COUNT }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-all duration-300",
              i + 1 <= step ? "bg-primary" : "bg-muted"
            )}
          />
        ))}
      </div>
      <p className="px-4 pt-1.5 text-xs text-muted-foreground">خطوة {step} من {STEP_COUNT}</p>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-lg px-4 pb-[calc(1.25rem+var(--app-safe-bottom))] pt-5 sm:py-6">

          {/* Step 1 — Agent Name */}
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div className="text-center space-y-2">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Bot className="h-8 w-8" />
                </div>
                <h1 className="text-xl font-extrabold text-foreground">أهلاً{user?.name ? ` ${user.name.split(" ")[0]}` : ""}!</h1>
                <p className="text-sm text-muted-foreground">سنساعدك على إعداد وكيلك الذكي في دقيقتين</p>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-foreground">ما اسم وكيلك الذكي؟</label>
                <input
                  autoFocus
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && canAdvanceStep1 && nextStep()}
                  className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  placeholder="مثال: وكيل المبيعات، سارة، مساعد العملاء"
                />
                <p className="text-xs text-muted-foreground">هذا اسم داخلي. يمكنك تغييره لاحقاً.</p>
              </div>
            </div>
          )}

          {/* Step 2 — Connect Channel */}
          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div className="text-center space-y-2">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-green-50 text-green-600">
                  <Plug className="h-8 w-8" />
                </div>
                <h2 className="text-xl font-extrabold text-foreground">اربط قناة التواصل</h2>
                <p className="text-sm text-muted-foreground">اختر القناة التي تريد وكيلك أن يستقبل رسائلها</p>
              </div>

              {channelConnected ? (
                <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-center space-y-2">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                    <Check className="h-6 w-6 text-green-600" />
                  </div>
                  <p className="font-semibold text-green-800">تم ربط القناة بنجاح!</p>
                  <p className="text-xs text-green-700">سيبدأ الوكيل باستقبال الرسائل فور الإعداد</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {CHANNEL_OPTIONS.map((ch) => (
                    <button
                      key={ch.key}
                      onClick={() => startEmbeddedSignup(ch)}
                      disabled={connectingChannel !== null || fbSignupConfigQuery.isLoading}
                      className={cn(
                        "w-full flex items-center gap-4 rounded-2xl border-2 p-4 text-right transition-all",
                        connectingChannel === ch.key
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40 hover:bg-primary/5"
                      )}
                    >
                      <span className={cn(
                        "flex h-12 w-12 items-center justify-center rounded-xl shrink-0",
                        ch.key === "whatsapp" ? "bg-green-50 text-green-600" :
                        ch.key === "instagram" ? "bg-pink-50 text-pink-600" :
                        "bg-blue-50 text-blue-600"
                      )}>
                        {ch.icon}
                      </span>
                      <span className="flex-1">
                        <span className="block font-semibold text-foreground">{ch.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {connectingChannel === ch.key ? "جار فتح نافذة الربط..." : "انقر للربط عبر Meta"}
                        </span>
                      </span>
                      {connectingChannel === ch.key && (
                        <span className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
                      )}
                    </button>
                  ))}
                  {fbSignupConfigQuery.isLoading && (
                    <p className="text-center text-xs text-muted-foreground">جار تحميل إعدادات الربط...</p>
                  )}
                </div>
              )}

              {error && (
                <p className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">{error}</p>
              )}

              <button
                onClick={nextStep}
                className="w-full text-xs text-muted-foreground hover:text-foreground py-2 underline underline-offset-2"
              >
                {channelConnected ? "التالي" : "تخطى — سأربط القناة لاحقاً"}
              </button>
            </div>
          )}

          {/* Step 3 — Business Type */}
          {step === 3 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div className="text-center space-y-2">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/20 text-accent">
                  <MessageCircle className="h-8 w-8" />
                </div>
                <h2 className="text-xl font-extrabold text-foreground">ما طبيعة نشاطك؟</h2>
                <p className="text-sm text-muted-foreground">يساعد الوكيل على اختيار أسلوب الرد المناسب</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {displaySectors.map((s) => (
                  <button
                    key={s.sectorKey}
                    onClick={() => setBusinessType(s.sectorKey)}
                    className={cn(
                      "rounded-xl border-2 p-3 text-sm text-right font-medium transition-all",
                      businessType === s.sectorKey
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:border-primary/40 text-foreground"
                    )}
                  >
                    {s.nameAr}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 4 — Short Instructions */}
          {step === 4 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div className="text-center space-y-2">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-50 text-purple-600">
                  <Sparkles className="h-8 w-8" />
                </div>
                <h2 className="text-xl font-extrabold text-foreground">أخبر الوكيل بمهمته</h2>
                <p className="text-sm text-muted-foreground">في سطر أو سطرين — ماذا يجب أن يفعل وكيلك؟</p>
              </div>
              <div className="space-y-2">
                <textarea
                  autoFocus
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
                  placeholder={"مثال:\n• رحّب بالعميل باسمه\n• ساعده في معرفة الأسعار\n• خذ طلبه وأرسله للفريق"}
                />
                <p className="text-xs text-muted-foreground">اختياري — يمكنك إكماله لاحقاً من صفحة الوكلاء</p>
              </div>
            </div>
          )}

          {/* Step 5 — Test message */}
          {step === 5 && (
            <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
              <div className="text-center space-y-2">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <MessageCircle className="h-8 w-8" />
                </div>
                <h2 className="text-xl font-extrabold text-foreground">جرّب وكيلك الآن</h2>
                <p className="text-sm text-muted-foreground">أرسل رسالة واشوف كيف سيرد الوكيل</p>
              </div>

              {/* Chat area */}
              <div className="rounded-2xl border border-border bg-muted/30 flex flex-col gap-3 p-4 min-h-[180px]">
                {testMessages.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center mt-8">اكتب رسالة أدناه لتجربة الوكيل</p>
                )}
                {testMessages.map((msg, i) => (
                  <div key={i} className={cn("flex", msg.from === "user" ? "justify-start" : "justify-end")}>
                    <div className={cn(
                      "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                      msg.from === "user"
                        ? "bg-background border border-border text-foreground rounded-ss-none"
                        : "bg-primary text-primary-foreground rounded-se-none"
                    )}>
                      {msg.from === "agent" && (
                        <p className="text-[0.65rem] font-bold opacity-70 mb-0.5">{agentName.trim() || "وكيل المبيعات"}</p>
                      )}
                      {msg.text}
                    </div>
                  </div>
                ))}
                {testReplying && (
                  <div className="flex justify-end">
                    <div className="bg-primary/20 rounded-2xl rounded-se-none px-3.5 py-2 text-sm text-primary flex gap-1 items-center">
                      <span className="animate-bounce delay-0">·</span>
                      <span className="animate-bounce delay-75">·</span>
                      <span className="animate-bounce delay-150">·</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="flex gap-2">
                <input
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendTestMessage()}
                  placeholder="اكتب رسالة تجريبية..."
                  className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <button
                  onClick={sendTestMessage}
                  disabled={!testInput.trim() || testReplying}
                  className="rounded-xl bg-primary px-3 py-2.5 text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && step !== 2 && (
            <p className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">{error}</p>
          )}

          {/* Navigation */}
          <div className="mt-8 space-y-3">
            {step === 1 && (
              <button
                onClick={nextStep}
                disabled={!canAdvanceStep1}
                className={cn(
                  "w-full rounded-xl py-3.5 text-sm font-bold text-primary-foreground transition-all",
                  canAdvanceStep1 ? "bg-primary hover:bg-primary/90 active:scale-[.98]" : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                التالي
              </button>
            )}

            {step === 2 && channelConnected && (
              <button
                onClick={nextStep}
                className="w-full rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 active:scale-[.98] transition-all"
              >
                التالي
              </button>
            )}

            {step === 3 && (
              <button
                onClick={nextStep}
                className="w-full rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 active:scale-[.98] transition-all"
              >
                التالي
              </button>
            )}

            {step === 4 && (
              <button
                onClick={() => createAgentMut.mutate()}
                disabled={createAgentMut.isPending}
                className="w-full rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 active:scale-[.98] transition-all disabled:opacity-60"
              >
                {createAgentMut.isPending ? "جارٍ الإنشاء…" : "إنشاء الوكيل"}
              </button>
            )}

            {step === 5 && (
              <button
                onClick={finishOnboarding}
                disabled={finishing}
                className="w-full rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 active:scale-[.98] transition-all disabled:opacity-60"
              >
                {finishing ? "جارٍ الفتح…" : "افتح لوحة التحكم ←"}
              </button>
            )}

            {step > 1 && step < 5 && (
              <button
                onClick={prevStep}
                className="w-full flex items-center justify-center gap-1 rounded-xl border border-border py-2.5 text-sm text-muted-foreground hover:bg-muted/50"
              >
                <ChevronLeft className="h-4 w-4" />
                السابق
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
