import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error ?? "تعذر تنفيذ الطلب");
  return data as T;
}

function knowledgeFetch<T>(path: string, opts?: RequestInit) {
  return apiFetch<T>(`knowledge/${path}`, opts);
}

type KnowledgeBase = { id: string; name: string; description?: string | null; status: string };
type KnowledgeDocument = { id: string; title: string; contentText: string; status: string };
type FaqEntry = { id: string; question: string; answer: string; category?: string | null; status: string };
type Agent = { id: string; name: string; dialect?: string; defaultModel?: string; status: string };
type ProviderStatus = { provider: string; hasGeminiKey: boolean; fallbackMode: boolean; message: string };
type SearchResponse = {
  total: number;
  results?: {
    faqs?: FaqEntry[];
    documents?: { id: string; title: string }[];
    chunks?: { id: string; chunkText: string; documentId: string; chunkIndex: number }[];
  };
};

type BusinessProfile = {
  businessName: string;
  description: string;
  serviceAreas: string;
  paymentMethods: string;
  deliveryMethod: string;
  refundPolicy: string;
  commonQuestions: string;
  tone: string;
};

const initialProfile: BusinessProfile = {
  businessName: "",
  description: "",
  serviceAreas: "",
  paymentMethods: "",
  deliveryMethod: "",
  refundPolicy: "",
  commonQuestions: "",
  tone: "ودية",
};

const setupSteps = [
  { title: "عرّف نشاطك", detail: "اكتب ماذا تقدم وأين تخدم العملاء.", href: "#business-profile" },
  { title: "أضف معلومات الرد", detail: "الدفع، التسليم، وسياسة الاسترجاع.", href: "#business-profile" },
  { title: "أضف الأسئلة الشائعة", detail: "اجمع أكثر الأسئلة تكراراً حتى يرد الفريق بثبات.", href: "/knowledge" },
  { title: "جرّب المساعد", detail: "اكتب سؤالاً وتأكد أن الرد مناسب قبل العرض.", href: "#assistant-playground" },
  { title: "افتح صندوق الوارد", detail: "ابدأ من محادثة يدوية أو محادثة مستوردة.", href: "/inbox" },
  { title: "حوّل المحادثة إلى طلب أو متابعة", detail: "من داخل المحادثة اختر طلب، مهمة، أو متابعة.", href: "/inbox" },
  { title: "راقب الأداء", detail: "راجع الطلبات، المتابعات، والتقارير بعد التشغيل.", href: "/reports" },
];

const demoJourney = [
  { title: "ابدأ من عميل", href: "/contacts", detail: "افتح سجل العميل واعرف آخر تواصل معه." },
  { title: "حوّل المحادثة إلى طلب", href: "/inbox", detail: "من صندوق الوارد حوّل الطلب إلى متابعة أو طلب بيع." },
  { title: "سجّل دفعة", href: "/payments", detail: "استخدم الدفع اليدوي فقط في هذه النسخة." },
  { title: "تابع دين", href: "/debts", detail: "راجع المتبقي وملاحظات التحصيل." },
  { title: "راجع التقرير", href: "/reports", detail: "اعرض ملخص النشاط بدون إعدادات تقنية." },
];

function parseBusinessProfile(content: string): BusinessProfile {
  const valueFor = (label: string) => {
    const match = content.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[^\\n:]+:|$)`, "u"));
    return match?.[1]?.trim() ?? "";
  };
  return {
    businessName: valueFor("اسم النشاط"),
    description: valueFor("وصف مختصر"),
    serviceAreas: valueFor("مناطق الخدمة"),
    paymentMethods: valueFor("طرق الدفع"),
    deliveryMethod: valueFor("طريقة التسليم أو تقديم الخدمة"),
    refundPolicy: valueFor("سياسة الاسترجاع أو الإلغاء"),
    commonQuestions: valueFor("أكثر الأسئلة تكراراً"),
    tone: valueFor("نبرة الرد") || "ودية",
  };
}

function serializeBusinessProfile(profile: BusinessProfile) {
  return [
    "اسم النشاط: " + profile.businessName.trim(),
    "وصف مختصر: " + profile.description.trim(),
    "مناطق الخدمة: " + profile.serviceAreas.trim(),
    "طرق الدفع: " + profile.paymentMethods.trim(),
    "طريقة التسليم أو تقديم الخدمة: " + profile.deliveryMethod.trim(),
    "سياسة الاسترجاع أو الإلغاء: " + profile.refundPolicy.trim(),
    "أكثر الأسئلة تكراراً:\n" + profile.commonQuestions.trim(),
    "نبرة الرد: " + profile.tone,
  ].join("\n\n");
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
      ok ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"
    )}>
      {ok ? "جاهز" : "يحتاج إعداد"} · {label}
    </span>
  );
}

export default function BusinessSetupPage() {
  const { user, hasPermission } = useAuth();
  const qc = useQueryClient();
  const canReadKnowledge = hasPermission("knowledge:read");
  const canCreateKnowledge = hasPermission("knowledge:create");
  const canUpdateKnowledge = hasPermission("knowledge:update");
  const canReadAi = hasPermission("ai:read");
  const canUseAi = hasPermission("ai:use");

  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [profile, setProfile] = useState<BusinessProfile>(initialProfile);
  const [profileLoadedId, setProfileLoadedId] = useState<string | null>(null);
  const [question, setQuestion] = useState("كم سعر التوصيل؟");
  const [playgroundResult, setPlaygroundResult] = useState<{ reply: string; source: string } | null>(null);
  const [playgroundError, setPlaygroundError] = useState("");

  const basesQuery = useQuery({
    queryKey: ["business-setup", "knowledge-bases"],
    queryFn: () => knowledgeFetch<{ bases: KnowledgeBase[] }>("bases"),
    enabled: canReadKnowledge,
  });

  const bases = basesQuery.data?.bases ?? [];

  useEffect(() => {
    if (!selectedBaseId && bases.length > 0) setSelectedBaseId(bases[0].id);
  }, [bases, selectedBaseId]);

  const docsQuery = useQuery({
    queryKey: ["business-setup", "knowledge-docs", selectedBaseId],
    queryFn: () => knowledgeFetch<{ documents: KnowledgeDocument[] }>(`bases/${selectedBaseId}/documents`),
    enabled: !!selectedBaseId && canReadKnowledge,
  });

  const faqsQuery = useQuery({
    queryKey: ["business-setup", "knowledge-faqs", selectedBaseId],
    queryFn: () => knowledgeFetch<{ faqs: FaqEntry[] }>(`bases/${selectedBaseId}/faqs`),
    enabled: !!selectedBaseId && canReadKnowledge,
  });

  const agentsQuery = useQuery({
    queryKey: ["business-setup", "ai-agents"],
    queryFn: () => apiFetch<{ agents: Agent[] }>("ai/agents"),
    enabled: canReadAi,
  });

  const providerStatusQuery = useQuery({
    queryKey: ["business-setup", "ai-provider-status"],
    queryFn: () => apiFetch<ProviderStatus>("ai/provider-status"),
    enabled: canReadAi,
  });

  const documents = docsQuery.data?.documents ?? [];
  const faqs = faqsQuery.data?.faqs ?? [];
  const profileDoc = documents.find((doc) => doc.title === "ملف النشاط التجاري");
  const agents = agentsQuery.data?.agents ?? [];
  const providerStatus = providerStatusQuery.data;

  useEffect(() => {
    if (profileDoc && profileLoadedId !== profileDoc.id) {
      setProfile({ ...initialProfile, ...parseBusinessProfile(profileDoc.contentText) });
      setProfileLoadedId(profileDoc.id);
    }
  }, [profileDoc, profileLoadedId]);

  const saveProfile = useMutation({
    mutationFn: async () => {
      let baseId = selectedBaseId;
      if (!baseId) {
        const created = await knowledgeFetch<{ base: KnowledgeBase }>("bases", {
          method: "POST",
          body: JSON.stringify({
            name: "معرفة النشاط",
            description: "معلومات النشاط التي يستخدمها الفريق والمساعد في الردود",
          }),
        });
        baseId = created.base.id;
        setSelectedBaseId(baseId);
      }

      const body = {
        title: "ملف النشاط التجاري",
        contentText: serializeBusinessProfile(profile),
      };

      if (profileDoc && profileDoc.id && canUpdateKnowledge) {
        return knowledgeFetch(`documents/${profileDoc.id}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      return knowledgeFetch(`bases/${baseId}/documents`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-setup", "knowledge-bases"] });
      qc.invalidateQueries({ queryKey: ["business-setup", "knowledge-docs"] });
    },
  });

  const runPlayground = useMutation({
    mutationFn: async () => {
      setPlaygroundError("");
      setPlaygroundResult(null);
      if (!question.trim()) throw new Error("اكتب سؤالاً أولاً");
      if (!canReadKnowledge) throw new Error("تحتاج صلاحية قراءة المعرفة لتجربة المساعد");

      const params = new URLSearchParams({ q: question.trim() });
      if (selectedBaseId) params.set("baseId", selectedBaseId);
      const search = await knowledgeFetch<SearchResponse>(`search?${params.toString()}`);
      const faq = search.results?.faqs?.[0];
      const chunk = search.results?.chunks?.[0];
      const doc = search.results?.documents?.[0];

      if (faq) {
        return {
          reply: faq.answer,
          source: `سؤال شائع: ${faq.question}`,
        };
      }
      if (chunk) {
        return {
          reply: `${chunk.chunkText.slice(0, 420)}${chunk.chunkText.length > 420 ? "..." : ""}`,
          source: `مقطع من قاعدة المعرفة رقم ${chunk.chunkIndex + 1}`,
        };
      }
      if (doc) {
        return {
          reply: "وجدت وثيقة مرتبطة بالسؤال. راجع محتواها في قاعدة المعرفة قبل اعتماد الرد.",
          source: `وثيقة: ${doc.title}`,
        };
      }
      return {
        reply: "لم أجد معلومة كافية في قاعدة المعرفة. أضف إجابة واضحة لهذا السؤال قبل استخدام الرد مع العميل.",
        source: "بدون مصدر مناسب",
      };
    },
    onSuccess: (result) => setPlaygroundResult(result),
    onError: (error: Error) => setPlaygroundError(error.message),
  });

  const profileComplete = Boolean(profileDoc || profile.businessName || profile.description);
  const knowledgeReady = bases.length > 0 && documents.length > 0;
  const faqReady = faqs.length > 0;
  const dialectReady = agents.some((agent) => agent.dialect && agent.dialect !== "standard_arabic") || profile.tone !== "ودية";
  const testedReady = Boolean(playgroundResult);
  const assistantReady = knowledgeReady && faqReady && profileComplete && testedReady;

  const readinessItems = useMemo(() => [
    { label: "توجد معرفة عن نشاطك", ok: knowledgeReady },
    { label: "توجد أسئلة شائعة", ok: faqReady },
    { label: "تم اختيار نبرة الرد", ok: dialectReady },
    { label: "تم اختبار رد", ok: testedReady },
    { label: providerStatus?.hasGeminiKey && !providerStatus.fallbackMode ? "Gemini مفعل" : "الوضع التجريبي مفعل", ok: true },
    { label: "لا يوجد إرسال تلقائي", ok: true },
  ], [dialectReady, faqReady, knowledgeReady, providerStatus?.fallbackMode, providerStatus?.hasGeminiKey, testedReady]);

  return (
    <div dir="rtl" className="space-y-6">
      <PageHeader
        title="ابدأ تشغيل نشاطك"
        subtitle="خطوات عملية لتجهيز الفريق والمساعد للرد على العملاء بدون مصطلحات تقنية"
      />

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">خطة التشغيل الأولى</h2>
            <p className="text-sm text-muted-foreground">ابدأ بهذه الخطوات، ثم اعرض المنتج بثقة على فريقك أو عميلك التجريبي.</p>
          </div>
          <StatusPill ok={assistantReady} label={assistantReady ? "النشاط جاهز للتجربة" : "أكمل الإعدادات الأساسية"} />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {setupSteps.map((step, index) => {
            const external = step.href.startsWith("#");
            const content = (
              <div className="h-full rounded-lg border border-border bg-background p-4 transition-colors hover:border-primary/40">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">{index + 1}</div>
                <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
              </div>
            );
            return external ? (
              <a key={step.title} href={step.href}>{content}</a>
            ) : (
              <Link key={step.title} href={step.href}>{content}</Link>
            );
          })}
        </div>
      </section>

      <section id="business-profile" className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-foreground">ملف النشاط التجاري</h2>
            <p className="text-sm text-muted-foreground">سيُحفظ كوثيقة في قاعدة المعرفة بعنوان “ملف النشاط التجاري”.</p>
          </div>

          {!canReadKnowledge ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              تحتاج صلاحية قراءة قاعدة المعرفة لإدارة ملف النشاط.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">اسم النشاط</span>
                <input
                  value={profile.businessName}
                  onChange={(e) => setProfile({ ...profile, businessName: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder={user?.name ? `مثال: نشاط ${user.name}` : "مثال: عيادة النور"}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">مناطق الخدمة</span>
                <input
                  value={profile.serviceAreas}
                  onChange={(e) => setProfile({ ...profile, serviceAreas: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="صنعاء، عدن، إب..."
                />
              </label>
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="font-medium text-foreground">وصف مختصر: ماذا تقدم؟</span>
                <textarea
                  value={profile.description}
                  onChange={(e) => setProfile({ ...profile, description: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="اكتب وصفاً بسيطاً يفهمه موظف خدمة العملاء..."
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">طرق الدفع التي تقبلها</span>
                <textarea
                  value={profile.paymentMethods}
                  onChange={(e) => setProfile({ ...profile, paymentMethods: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="نقداً، تحويل بنكي، كريمي يدوي..."
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">طريقة التسليم أو تقديم الخدمة</span>
                <textarea
                  value={profile.deliveryMethod}
                  onChange={(e) => setProfile({ ...profile, deliveryMethod: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="توصيل داخل المدينة، حجز موعد، استلام من الفرع..."
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">سياسة الاسترجاع أو الإلغاء</span>
                <textarea
                  value={profile.refundPolicy}
                  onChange={(e) => setProfile({ ...profile, refundPolicy: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="متى يمكن الإلغاء؟ متى يمكن الاستبدال؟"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">نبرة الرد</span>
                <select
                  value={profile.tone}
                  onChange={(e) => setProfile({ ...profile, tone: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="رسمية">رسمية</option>
                  <option value="ودية">ودية</option>
                  <option value="يمنية خفيفة">يمنية خفيفة</option>
                  <option value="تجارية">تجارية</option>
                </select>
              </label>
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="font-medium text-foreground">أكثر 5 أسئلة تتكرر</span>
                <textarea
                  value={profile.commonQuestions}
                  onChange={(e) => setProfile({ ...profile, commonQuestions: e.target.value })}
                  rows={5}
                  className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder={"1. كم سعر التوصيل؟\n2. كيف أتابع طلبي؟\n3. هل تقبلون الدفع عبر كريمي؟"}
                />
              </label>
              <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => saveProfile.mutate()}
                  disabled={saveProfile.isPending || !canCreateKnowledge || (!canUpdateKnowledge && Boolean(profileDoc))}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {saveProfile.isPending ? "جار الحفظ..." : profileDoc ? "تحديث ملف النشاط" : "حفظ ملف النشاط"}
                </button>
                {!canCreateKnowledge && <span className="text-xs text-amber-700">تحتاج صلاحية إنشاء المعرفة لحفظ الملف.</span>}
                {saveProfile.isSuccess && <span className="text-xs font-medium text-green-700">تم حفظ ملف النشاط في قاعدة المعرفة.</span>}
                {saveProfile.isError && <span className="text-xs font-medium text-red-700">{(saveProfile.error as Error).message}</span>}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">جاهزية المساعد</h2>
          <p className="mt-1 text-sm text-muted-foreground">المساعد يقترح فقط، والموظف يقرر الإرسال.</p>
          <div className="mt-4 space-y-2">
            {readinessItems.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                <span className="text-sm text-foreground">{item.label}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", item.ok ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700")}>
                  {item.ok ? "نعم" : "لا"}
                </span>
              </div>
            ))}
          </div>
          <div className={cn(
            "mt-4 rounded-lg border p-4 text-sm",
            assistantReady ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"
          )}>
            الحالة: {assistantReady ? "جاهز للعرض التجريبي" : "يحتاج بعض الإعداد قبل العرض"}
          </div>
          {providerStatus && (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              وضع المساعد الحالي: {providerStatus.hasGeminiKey && !providerStatus.fallbackMode ? "Gemini مفعل" : "تجريبي"}. لا يوجد إرسال تلقائي.
            </p>
          )}
        </div>
      </section>

      <section id="assistant-playground" className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-foreground">جرّب المساعد</h2>
          <p className="text-sm text-muted-foreground">هذا اختبار فقط، ولا يتم إرسال أي رسالة للعميل.</p>
        </div>
        <div className="flex flex-wrap gap-2 pb-3">
          {["كم سعر التوصيل؟", "كيف أتابع طلبي؟", "هل عندكم دفع كريمي؟"].map((sample) => (
            <button
              key={sample}
              onClick={() => setQuestion(sample)}
              className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary"
            >
              {sample}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">سؤال تجريبي</span>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={5}
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </label>
            <button
              onClick={() => runPlayground.mutate()}
              disabled={runPlayground.isPending || !canUseAi}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {runPlayground.isPending ? "جار الاختبار..." : "اعرض الرد المقترح"}
            </button>
            {!canUseAi && <p className="text-xs text-amber-700">تحتاج صلاحية استخدام المساعد للتجربة.</p>}
          </div>
          <div className="rounded-lg border border-border bg-background p-4">
            <h3 className="text-sm font-semibold text-foreground">الرد المقترح</h3>
            {playgroundError && <p className="mt-3 text-sm text-red-700">{playgroundError}</p>}
            {!playgroundResult && !playgroundError && (
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">اكتب سؤالاً واضغط “اعرض الرد المقترح”.</p>
            )}
            {playgroundResult && (
              <div className="mt-3 space-y-3">
                <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm leading-relaxed text-foreground">{playgroundResult.reply}</p>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                  المصدر المستخدم: {playgroundResult.source}
                </div>
                <p className="text-xs text-muted-foreground">ملاحظة: هذا اختبار فقط، ولن يتم إرسال أي رسالة تلقائياً.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">مسار العرض التجريبي</h2>
        <p className="mt-1 text-sm text-muted-foreground">استخدم هذه الرحلة لعرض المنصة كتشغيل يومي لصاحب نشاط.</p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
          {demoJourney.map((item) => (
            <Link key={item.title} href={item.href}>
              <div className="h-full rounded-lg border border-border bg-background p-4 hover:border-primary/40">
                <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
