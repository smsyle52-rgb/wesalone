"use client";

import { motion } from "framer-motion";
import { ArrowLeft, Bot, DatabaseZap, ListChecks, MessageSquareText } from "lucide-react";

const items = [
  {
    title: "صندوق وارد موحد",
    text: "كل رسالة تظهر مع القناة، آخر نشاط، وحالة المتابعة حتى يعرف الفريق ما يجب فعله فورًا.",
    icon: MessageSquareText,
  },
  {
    title: "سياق العميل كامل",
    text: "المحادثة، الطلبات، الملاحظات، والمهام في مكان واحد يقلل الأسئلة المتكررة ويزيد الثقة.",
    icon: DatabaseZap,
  },
  {
    title: "مساعد ذكي تحت السيطرة",
    text: "اقتراحات ردود مبنية على معرفة النشاط، مع حدود أمان واضحة قبل أي رد حساس.",
    icon: Bot,
  },
  {
    title: "تشغيل يومي منظم",
    text: "مهام، وسوم، وتقارير تساعد المدير على قياس الأداء دون متابعة يدوية مرهقة.",
    icon: ListChecks,
  },
];

export function ProductShowcase() {
  return (
    <section className="px-4 py-20">
      <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[.92fr_1.08fr]">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: .3 }}
        >
          <span className="rounded-full border border-wesal-accent/20 bg-white/70 px-4 py-2 text-sm font-black text-wesal-primary dark:border-cyan-300/15 dark:bg-white/6 dark:text-cyan-100">تجربة منتج حقيقية</span>
          <h2 className="mt-5 text-3xl font-black leading-tight text-wesal-primary md:text-4xl dark:text-white">
            لوحة واحدة تجعل فريقك يرى العميل لا الرسالة فقط
          </h2>
          <p className="mt-4 max-w-xl leading-8 text-slate-600 dark:text-slate-300">
            صُممت وصال ون لتكون مركز تشغيل يومي للتاجر: متابعة المحادثات، فهم الطلبات، قياس الأداء، وتقديم خدمة أكثر اتساقًا عبر كل قناة.
          </p>
          <a href="#contact" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-wesal-primary px-7 py-3.5 text-sm font-black text-white shadow-[0_18px_45px_rgba(27,58,92,.22)] transition hover:-translate-y-1 dark:bg-wesal-blue">
            ابدأ من هنا
            <ArrowLeft className="h-4 w-4" />
          </a>
        </motion.div>

        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <motion.article
                key={item.title}
                initial={{ opacity: 0, y: 26 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: .35 }}
                transition={{ delay: index * .08 }}
                whileHover={{ y: -7 }}
                className="rounded-[1.7rem] border border-slate-200 bg-white p-6 shadow-[0_18px_45px_rgba(27,58,92,.08)] dark:border-white/10 dark:bg-[#071524]/82"
              >
                <span className="grid h-13 w-13 place-items-center rounded-2xl bg-gradient-to-br from-wesal-blue to-wesal-accent text-white shadow-[0_15px_30px_rgba(31,182,166,.22)]">
                  <Icon className="h-6 w-6" />
                </span>
                <h3 className="mt-5 text-lg font-black text-wesal-primary dark:text-white">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">{item.text}</p>
              </motion.article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
