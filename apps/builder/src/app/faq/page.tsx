import type { Metadata } from "next"
import { CircleHelp } from "lucide-react"
import Link from "next/link"
import { PublicShell } from "@/features/marketing/public-shell"
import { publicMetadata } from "@/lib/public-site"

export const metadata: Metadata = publicMetadata({
  title: "الأسئلة الشائعة",
  description: "إجابات واضحة عن وصال ون والباقات والنقاط والقنوات المتاحة.",
  path: "/faq",
})

const faqs = [
  ["ما هو وصال ون؟", "وصال ون مساحة تشغيل تجمع محادثات الأعمال والقنوات والفريق والذكاء الاصطناعي والتدفقات في واجهة واحدة."],
  ["كيف أبدأ؟", "أنشئ حسابًا، ثم أضف مساحة عمل واربط القنوات التي تريد تشغيلها. يمكنك البدء بالخطة المجانية."],
  ["هل الباقة المجانية متاحة؟", "نعم. تضم الباقة المجانية 1,000 نقطة شهرية مع حدودها المنشورة في صفحة الأسعار."],
  ["ما المقصود بالنقاط؟", "هي رصيد الاستخدام للخدمات المقاسة داخل المنصة. يتغير الاستهلاك بحسب الخدمة وحجم الاستخدام، مثل الذكاء الاصطناعي والصوت والصور والمعرفة."],
  ["هل توجد باقات شهرية وسنوية؟", "تُعرض قيمة الاشتراك الشهري والسنوي لكل باقة مؤهلة في صفحة الأسعار، أما باقة الأعمال فتُرتب حسب العقد."],
  ["هل يمكن لفريقي استخدام وصال ون؟", "نعم. تختلف سعة أعضاء الفريق ومساحات العمل والقنوات حسب الباقة."],
  ["ما القنوات المتاحة؟", "تظهر القنوات المدعومة عند إنشاء قناة في وصال ون؛ وتتضمن واتساب وإنستغرام ومسنجر وتلغرام وويب شات وTikTok وZalo."],
  ["كيف أتواصل معكم؟", "يمكنك الوصول إلى فريق وصال ون من صفحة التواصل، أو مراسلة البريد الظاهر فيها."],
]

export default function FaqPage() {
  return <PublicShell><section className="bg-[#05142b] px-5 py-20 text-center lg:px-8"><p className="font-bold text-cyan-200 text-sm">مركز المساعدة</p><h1 className="mt-4 font-black text-4xl sm:text-6xl">الأسئلة الشائعة</h1><p className="mx-auto mt-5 max-w-2xl text-slate-300 leading-8">إجابات مختصرة تساعدك على فهم وصال ون قبل البدء.</p></section><section className="bg-slate-50 px-5 py-16 text-slate-950 lg:px-8"><div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">{faqs.map(([question, answer]) => <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" key={question}><div className="flex items-start gap-3"><CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-cyan-700" /><div><h2 className="font-black">{question}</h2><p className="mt-3 text-slate-600 text-sm leading-7">{answer}</p></div></div></article>)}</div><p className="mt-10 text-center text-slate-600">لم تجد إجابتك؟ <Link className="font-bold text-cyan-700" href="/contact">تواصل معنا</Link>.</p></section></PublicShell>
}
