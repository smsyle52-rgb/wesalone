"use client";

import { motion } from "framer-motion";
import { MessageCircle, PhoneCall } from "lucide-react";

const channels = [
  { name: "WhatsApp", desc: "طلبات ورسائل العملاء اليومية", color: "#20c75a", label: "WA" },
  { name: "Instagram", desc: "رسائل المتجر والتعليقات", color: "#e1306c", label: "IG" },
  { name: "Messenger", desc: "محادثات صفحات فيسبوك", color: "#1687ff", label: "MS" },
  { name: "Telegram", desc: "قنوات إضافية عند الحاجة", color: "#229ed9", label: "TG" },
  { name: "Calls", desc: "متابعة المكالمات كجزء من سياق العميل", color: "#1FB6A6", label: "CL" },
];

export function Channels() {
  return (
    <section id="channels" className="px-4 py-14">
      <div className="mx-auto max-w-7xl rounded-[2rem] border border-white/70 bg-white/72 p-4 shadow-[0_22px_70px_rgba(27,58,92,.08)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/5">
        <div className="mb-5 flex flex-col justify-between gap-3 px-2 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-black text-wesal-blue dark:text-cyan-200">قنواتك في مسار واحد</p>
            <h2 className="mt-1 text-2xl font-black text-wesal-primary dark:text-white">كل نقطة تواصل تتحول إلى سياق قابل للعمل</h2>
          </div>
          <p className="max-w-md text-sm leading-7 text-slate-600 dark:text-slate-300">القناة تظهر كمدخل واحد داخل لوحة الفريق، مع المحافظة على مصدر الرسالة وتاريخ العميل.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-5">
          {channels.map((channel, index) => (
            <motion.article
              key={channel.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: .3 }}
              transition={{ delay: index * .08, duration: .55 }}
              whileHover={{ y: -8 }}
              className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_14px_38px_rgba(27,58,92,.07)] dark:border-white/10 dark:bg-[#071524]/80"
            >
              <span className="channel-gloss mb-4 grid h-14 w-14 place-items-center rounded-full text-sm font-black text-white" style={{ "--channel-bg": channel.color, "--channel-shadow": `${channel.color}55` } as React.CSSProperties}>
                {channel.name === "Calls" ? <PhoneCall className="h-6 w-6" /> : channel.label}
              </span>
              <h2 className="font-black text-wesal-primary dark:text-white">{channel.name}</h2>
              <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{channel.desc}</p>
              <span className="mt-4 inline-flex items-center gap-2 text-xs font-black text-wesal-blue dark:text-cyan-200">
                <MessageCircle className="h-4 w-4" />
                قناة جاهزة للربط
              </span>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
