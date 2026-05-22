import { Link } from "wouter";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CheckCircle2,
  Database,
  Inbox,
  LifeBuoy,
  MessageSquareText,
  Plug,
  ShoppingBag,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const BASE = `${import.meta.env.BASE_URL}api`;
async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const setupSteps = [
  {
    title: "اربط قناة التواصل",
    description: "ابدأ بربط واتساب أو قناة ميتا حتى تصل رسائل العملاء إلى صندوق الوارد.",
    href: "/integrations",
    icon: Plug,
  },
  {
    title: "جهّز صندوق الوارد",
    description: "راجع طريقة توزيع المحادثات، الوسوم، والردود السريعة حتى يعرف الفريق من أين يبدأ.",
    href: "/inbox",
    icon: Inbox,
  },
  {
    title: "أضف معرفة النشاط",
    description: "ارفع السياسات والأسئلة الشائعة حتى يستند الوكيل إلى معلومات حقيقية عند صياغة الردود.",
    href: "/knowledge",
    icon: Database,
  },
  {
    title: "أنشئ وكيلًا ذكيًا",
    description: "اضبط نبرة الرد، قاعدة المعرفة، ووضع الثقة. ابدأ دائمًا بوضع الاقتراح فقط.",
    href: "/agents",
    icon: Bot,
  },
  {
    title: "زامن المنتجات",
    description: "اربط كتالوج ميتا أو مصادر المنتجات حتى يعرف الوكيل الأسعار والتوفر بدون تخمين.",
    href: "/catalog",
    icon: ShoppingBag,
  },
  {
    title: "راقب الأداء",
    description: "بعد أول يوم تشغيل، راجع المؤشرات والتقارير لتعرف أين يحتاج الفريق دعمًا.",
    href: "/dashboard",
    icon: CheckCircle2,
  },
];

const outcomes = [
  "رسائل العملاء تظهر في مكان واحد بدل التنقل بين التطبيقات.",
  "الفريق يعرف المحادثات المفتوحة والمتأخرة وما يحتاج متابعة.",
  "الوكيل يقترح ردودًا من قاعدة المعرفة والكتالوج بدل التخمين.",
  "صاحب النشاط يراقب الأداء من مؤشرات واضحة ومفهومة.",
];

export default function BusinessSetupPage() {
  const qc = useQueryClient();
  const [sectorKey, setSectorKey] = useState("services_general");
  const [sectorNote, setSectorNote] = useState("");
  const sectorsQuery = useQuery({ queryKey: ["sector-profiles"], queryFn: () => apiFetch("sectors") });
  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => apiFetch("workspace") });
  useEffect(() => {
    const settings = workspaceQuery.data?.workspace?.settings ?? {};
    if (typeof settings.sector_key === "string") setSectorKey(settings.sector_key);
    if (typeof settings.sector_note === "string") setSectorNote(settings.sector_note);
  }, [workspaceQuery.data]);
  const saveSector = useMutation({
    mutationFn: () => apiFetch("workspace", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { sector_key: sectorKey, sector_note: sectorNote } }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace"] }),
  });

  return (
    <div className="space-y-8" dir="rtl">
      <PageHeader
        title="ابدأ تشغيل نشاطك"
        subtitle="وصال ون يساعدك على جمع المحادثات، تنظيم المتابعة، وتجهيز الوكيل الذكي بخطوات بسيطة وواضحة."
        actions={(
          <Button asChild>
            <Link href="/integrations">ابدأ بربط قناة</Link>
          </Button>
        )}
      />

      <Card className="border-accent/20 bg-accent/5">
        <CardHeader>
          <CardTitle>اختر قطاع نشاطك</CardTitle>
          <CardDescription>هذا يساعد الوكيل على فهم طريقة خدمة العملاء المناسبة لنشاطك، مثل البيع، الحجز، أو أخذ الطلبات.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto]">
          <select value={sectorKey} onChange={(event) => setSectorKey(event.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
            {(sectorsQuery.data?.sectors ?? []).map((sector: any) => (
              <option key={sector.sectorKey} value={sector.sectorKey}>{sector.nameAr}</option>
            ))}
          </select>
          <input value={sectorNote} onChange={(event) => setSectorNote(event.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="ملاحظة اختيارية عن أسلوب خدمتك أو ما يميز نشاطك" />
          <Button onClick={() => saveSector.mutate()} disabled={saveSector.isPending}>حفظ القطاع</Button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-primary/10 bg-gradient-to-l from-primary/8 via-card to-accent/10">
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[1.1fr_.9fr]">
          <div>
            <p className="text-sm font-bold text-primary">ما الذي يفعله وصال ون؟</p>
            <h2 className="mt-2 text-2xl font-extrabold text-foreground">لوحة واحدة لإدارة محادثات العملاء وتشغيل الفريق بثقة</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              تبدأ التجربة من ربط القنوات، ثم تجهيز المعرفة والمنتجات، وبعدها يصبح الفريق قادرًا على الرد والمتابعة وتحويل المحادثات إلى فرص وطلبات.
            </p>
          </div>
          <div className="grid gap-3">
            {outcomes.map((item) => (
              <div key={item} className="flex items-start gap-3 rounded-lg border border-border/80 bg-card/85 p-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                <p className="text-sm font-medium text-foreground">{item}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-extrabold text-foreground">خطة التشغيل الأولى</h2>
          <p className="mt-1 text-sm text-muted-foreground">اتبع الخطوات بالترتيب. كل خطوة تفتح الصفحة المناسبة وتشرح لماذا تحتاجها.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {setupSteps.map((step, index) => {
            const Icon = step.icon;
            return (
              <Card key={step.title} className="transition hover:-translate-y-1 hover:shadow-[var(--shadow-hover)]">
                <CardHeader>
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-black text-white">{index + 1}</span>
                  </div>
                  <CardTitle>{step.title}</CardTitle>
                  <CardDescription>{step.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" className="w-full">
                    <Link href={step.href}>فتح الخطوة</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>قبل دعوة الفريق</CardTitle>
            <CardDescription>قائمة قصيرة تجعل التجربة الأولى أكثر ترتيبًا.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              "أضف قناة واحدة على الأقل.",
              "أضف 5 أسئلة شائعة في قاعدة المعرفة.",
              "أنشئ وكيلًا واحدًا واضبطه على وضع الاقتراح.",
              "جرّب محادثة داخلية قبل استقبال عملاء حقيقيين.",
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-lg bg-secondary/70 p-3">
                <MessageSquareText className="h-4 w-4 text-primary" />
                <span className="text-sm font-bold text-foreground">{item}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>عند الحاجة للمساعدة</CardTitle>
            <CardDescription>إذا تعثر الربط أو ظهرت البيانات فارغة، ابدأ من هذه الأماكن.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button asChild variant="outline" className="w-full justify-start">
              <Link href="/integrations">
                <Plug className="h-4 w-4" />
                مراجعة التكاملات والقنوات
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-start">
              <Link href="/catalog">
                <ShoppingBag className="h-4 w-4" />
                مراجعة المنتجات والكتالوج
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-start">
              <Link href="/settings">
                <LifeBuoy className="h-4 w-4" />
                مراجعة الإعدادات العامة
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
