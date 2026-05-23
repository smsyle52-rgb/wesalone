"use client";

import { motion } from "framer-motion";
import { BarChart3, CheckCircle2, Clock3, MessageCircle, ShieldCheck, Smartphone } from "lucide-react";

const features = [
  { title: "صندوق وارد موحد", text: "كل قنوات المحادثة في مساحة واحدة واضحة للفريق، بدون تبديل نوافذ أو فقدان سياق.", icon: MessageCircle },
  { title: "رد أسرع", text: "تنظيم الرسائل والمهام يقلل وقت الانتظار ويرفع جودة تجربة العميل.", icon: Clock3 },
  { title: "متابعة منظمة", text: "وسوم، مهام، وملاحظات داخلية لكل محادثة حتى لا تضيع الوعود والمتابعات.", icon: CheckCircle2 },
  { title: "تقارير ذكية", text: "رؤية فورية للمحادثات، أداء الفريق، وفرص التحسين من لوحة واحدة.", icon: BarChart3 },
  { title: "مناسب للجوال والكمبيوتر", text: "واجهة مرنة تعمل مع فرق صغيرة وكبيرة، من المكتب أو أثناء الحركة.", icon: Smartphone },
  { title: "موثوق وآمن", text: "تصميم يحافظ على تاريخ المحادثات وسياق العميل مع صلاحيات واضحة للفريق.", icon: ShieldCheck },
];

export function Features() {
  return (
    <section id="features" className="px-4 py-20">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mx-auto max-w-3xl text-center"
        >
          <span className="rounded-full border border-wesal-accent/20 bg-white/70 px-4 py-2 text-sm font-black text-wesal-primary dark:border-cyan-300/15 dark:bg-white/6 dark:text-cyan-100">من محادثة مشتتة إلى تشغيل منظم</span>
          <h2 className="mt-5 text-3xl font-black text-wesal-primary md:text-4xl dark:text-white">واجهة حديثة لخدمة عملاء أهدأ وأسرع</h2>
          <p className="mt-4 leading-8 text-slate-600 dark:text-slate-300">وصال ون لا يضيف شاشة جديدة فقط، بل يرتب يوم فريقك حول المحادثة والعميل والنتيجة.</p>
        </motion.div>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.article
                key={feature.title}
                initial={{ opacity: 0, y: 26 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: .25 }}
                transition={{ delay: index * .06 }}
                whileHover={{ y: -8, scale: 1.01 }}
                className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_14px_38px_rgba(27,58,92,.07)] transition dark:border-white/10 dark:bg-[#071524]/82"
              >
                <span className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-wesal-blue transition group-hover:bg-wesal-blue group-hover:text-white dark:bg-blue-500/12 dark:text-cyan-200">
                  <Icon className="h-7 w-7" />
                </span>
                <h3 className="text-xl font-black text-wesal-primary dark:text-white">{feature.title}</h3>
                <p className="mt-3 leading-7 text-slate-600 dark:text-slate-300">{feature.text}</p>
              </motion.article>
            );
          })}
        </div>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: .3 }}
          className="mt-10 grid gap-4 rounded-[2rem] border border-slate-200 bg-white/78 p-5 shadow-[0_18px_55px_rgba(27,58,92,.08)] backdrop-blur-xl md:grid-cols-4 dark:border-white/10 dark:bg-white/5"
        >
          {["إدارة محادثات", "متابعة مبيعات", "سجل عملاء", "رؤية أداء"].map((item) => (
            <div key={item} className="rounded-2xl bg-blue-50/70 px-5 py-4 text-center font-black text-wesal-primary dark:bg-white/6 dark:text-white">
              {item}
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
