"use client";

import { motion } from "framer-motion";
import { BarChart3, CheckCircle2, MessageCircle, PhoneCall, Search, Send, Sparkles } from "lucide-react";
import { Logo } from "./LandingHeader";

const conversations = [
  { name: "سارة القحطاني", text: "هل المنتج متوفر حاليًا؟", channel: "WA", color: "bg-[#20c75a]", time: "11:43" },
  { name: "منى علي", text: "أحتاج تفاصيل العرض.", channel: "IG", color: "bg-[#e1306c]", time: "11:40" },
  { name: "محمد الشهري", text: "متى يصل الطلب؟", channel: "MS", color: "bg-[#1687ff]", time: "09:50" },
  { name: "نورة عبدالله", text: "هل الدفع عند الاستلام متاح؟", channel: "TG", color: "bg-[#229ed9]", time: "أمس" },
  { name: "اتصال وارد", text: "طلب متابعة من عميل قديم", channel: "CL", color: "bg-[#1FB6A6]", time: "الآن" },
];

export function AnimatedDashboardMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: .97 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: .8, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ scale: 1.012, rotateX: -1.1, rotateY: 1.2 }}
      className="hero-depth pointer-events-none relative mx-auto w-full max-w-[850px] select-none"
    >
      <div className="absolute -inset-8 rounded-[46px] bg-gradient-to-br from-wesal-blue/24 via-white/18 to-wesal-accent/30 blur-2xl dark:from-blue-500/24 dark:via-cyan-300/5 dark:to-wesal-accent/20" />
      <div className="absolute -bottom-7 left-12 right-12 h-16 rounded-full bg-slate-900/18 blur-2xl dark:bg-cyan-400/10" />
      <div className="absolute -inset-1 rounded-[32px] border border-white/65 dark:border-cyan-200/10" />
      <motion.div
        animate={{ y: [0, -9, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        className="glass-card relative overflow-hidden rounded-[30px]"
      >
        <div className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-white/55 to-transparent dark:from-white/8" />
        <div className="dashboard-grid min-h-[455px]">
          <aside className="bg-[#08294f] p-4 text-white dark:bg-[#030b16]">
            <div className="mb-8 scale-75 origin-right">
              <Logo light />
            </div>
            {["المحادثات", "العملاء", "المهام", "التقارير", "التكاملات"].map((item, index) => (
              <div key={item} className={`mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${index === 0 ? "bg-[#0B6FE8]" : "text-blue-100/75"}`}>
                {index === 4 ? <PhoneCall className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                <span className="hidden sm:inline">{item}</span>
              </div>
            ))}
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/8 p-3 text-xs leading-6 text-blue-100/85">
              <Sparkles className="mb-2 h-4 w-4 text-wesal-accent" />
              اقتراحات ذكية حسب سياق العميل.
            </div>
          </aside>

          <section className="border-e border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#071524]">
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-400 dark:bg-white/8 dark:text-slate-400">
              <Search className="h-4 w-4" />
              بحث في المحادثات
            </div>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-black text-wesal-primary dark:text-white">المحادثات</h3>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-wesal-blue dark:bg-blue-500/15 dark:text-cyan-200">24 جديد</span>
            </div>
            <div className="space-y-3">
              {conversations.map((item, index) => (
                <motion.div
                  key={item.name}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: .2 + index * .12 }}
                  className={`rounded-2xl border border-slate-100 bg-white p-3 shadow-sm dark:border-white/8 dark:bg-white/6 ${index === 0 ? "ring-2 ring-wesal-accent/20" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`grid h-8 w-8 place-items-center rounded-full text-[10px] font-black text-white ${item.color}`}>{item.channel}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-black text-wesal-primary dark:text-white">{item.name}</p>
                        <span className="text-[10px] text-slate-400">{item.time}</span>
                      </div>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{item.text}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </section>

          <section className="dashboard-extra bg-[#f8fbff] p-4 dark:bg-[#081827]">
            <div className="mb-5 rounded-2xl bg-white p-4 shadow-sm dark:bg-white/7">
              <p className="font-black text-wesal-primary dark:text-white">سارة القحطاني</p>
              <p className="text-xs text-emerald-500">متصلة الآن عبر واتساب</p>
            </div>
            <div className="space-y-4">
              <Bubble>أريد معرفة توفر المنتج والسعر.</Bubble>
              <Bubble out>أهلًا سارة، المنتج متوفر والشحن خلال يومين. هل تحبين أرسل لك خيارات الألوان؟</Bubble>
              <Bubble>ممتاز، أرسلوها لو سمحتم.</Bubble>
            </div>
            <div className="mt-7 flex items-center gap-2 rounded-2xl bg-white p-3 shadow-sm dark:bg-white/7">
              <span className="flex-1 text-xs text-slate-400">اكتب رسالة...</span>
              <Send className="h-5 w-5 text-wesal-blue" />
            </div>
          </section>

          <section className="dashboard-extra border-s border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#071524]">
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="المحادثات" value="1,250" />
              <MiniStat label="عملاء نشطون" value="24" />
              <MiniStat label="وقت الرد" value="2.5 د" />
              <MiniStat label="الرضا" value="96%" />
            </div>
            <div className="mt-5 rounded-2xl border border-slate-100 p-4 dark:border-white/8">
              <p className="mb-4 text-sm font-black text-wesal-primary dark:text-white">مهام اليوم</p>
              {["متابعة طلب سارة", "تأكيد شحنة محمد", "رد على نورة"].map((task) => (
                <p key={task} className="mb-3 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <CheckCircle2 className="h-4 w-4 text-wesal-accent" />
                  {task}
                </p>
              ))}
            </div>
            <div className="mt-5 rounded-2xl bg-blue-50 p-4 dark:bg-blue-500/10">
              <p className="mb-4 flex items-center gap-2 text-sm font-black text-wesal-blue dark:text-cyan-200">
                <BarChart3 className="h-4 w-4" />
                أداء الأسبوع
              </p>
              <div className="flex h-20 items-end gap-2">
                {[35, 50, 44, 66, 58, 80, 72].map((height, index) => (
                  <motion.span
                    key={index}
                    initial={{ height: 0 }}
                    whileInView={{ height: `${height}%` }}
                    viewport={{ once: true }}
                    transition={{ delay: index * .06, duration: .55 }}
                    className="flex-1 rounded-t-lg bg-gradient-to-t from-wesal-blue to-wesal-accent"
                  />
                ))}
              </div>
            </div>
          </section>
        </div>
      </motion.div>
      <FloatingCard className="-right-3 top-12" title="عميل جديد" text="رسالة واتساب وصلت الآن" />
      <FloatingCard className="-left-4 bottom-16" title="متابعة ذكية" text="متوسط الرد خلال 2.5 دقيقة" />
      <FloatingCard className="left-20 top-4" title="مكالمة واردة" text="تم ربطها بسجل العميل تلقائيًا" />
    </motion.div>
  );
}

function Bubble({ children, out = false }: { children: React.ReactNode; out?: boolean }) {
  return <div className={`max-w-[86%] rounded-2xl p-3 text-sm leading-6 ${out ? "me-auto bg-emerald-50 text-[#14533b] dark:bg-emerald-400/12 dark:text-emerald-100" : "bg-white text-slate-600 shadow-sm dark:bg-white/7 dark:text-slate-300"}`}>{children}</div>;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm dark:border-white/8 dark:bg-white/7">
      <p className="text-lg font-black text-wesal-primary dark:text-white">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

function FloatingCard({ className, title, text }: { className: string; title: string; text: string }) {
  return (
    <motion.div
      animate={{ y: [0, -10, 0] }}
      transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut" }}
      className={`absolute z-20 hidden w-52 rounded-2xl border border-white/75 bg-white/92 p-4 shadow-[0_24px_55px_rgba(27,58,92,.20)] backdrop-blur-xl dark:border-cyan-200/10 dark:bg-[#071524]/90 md:block ${className}`}
    >
      <p className="text-xs font-black text-wesal-blue dark:text-cyan-200">{title}</p>
      <p className="mt-1 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{text}</p>
    </motion.div>
  );
}
