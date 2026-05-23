"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import gsap from "gsap";
import { ArrowLeft, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { AnimatedDashboardMockup } from "./AnimatedDashboardMockup";
import { SplineBrandObject } from "./SplineBrandObject";

const channels = [
  ["WhatsApp", "#20c75a", "WA"],
  ["Instagram", "#e1306c", "IG"],
  ["Messenger", "#1687ff", "MS"],
  ["Telegram", "#229ed9", "TG"],
  ["Calls", "#1FB6A6", "CL"],
];

export function Hero() {
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const onMove = (event: MouseEvent) => {
      const rect = section.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      gsap.to(section, {
        "--hero-x": `${x * 24}px`,
        "--hero-y": `${y * 20}px`,
        "--hero-rotate-x": `${-y * 2.2}deg`,
        "--hero-rotate-y": `${x * 2.6}deg`,
        duration: 0.55,
        ease: "power3.out",
      });
    };

    section.addEventListener("mousemove", onMove);
    return () => {
      section.removeEventListener("mousemove", onMove);
      gsap.killTweensOf(section);
    };
  }, []);

  return (
    <section ref={sectionRef} id="home" className="mesh-bg relative min-h-screen overflow-hidden px-4 pt-28 dark:bg-[#020814] lg:pt-32">
      <div className="absolute left-[2%] top-20 h-[30rem] w-[30rem] rounded-full bg-wesal-accent/18 blur-3xl dark:bg-cyan-400/12" />
      <div className="absolute right-[6%] top-24 h-[34rem] w-[34rem] rounded-full bg-wesal-blue/18 blur-3xl dark:bg-blue-500/16" />
      <div className="absolute bottom-8 left-1/2 h-44 w-[70%] -translate-x-1/2 rounded-full bg-white/40 blur-3xl dark:bg-cyan-300/5" />
      <div className="absolute inset-x-0 top-24 mx-auto h-px w-[min(100%-2rem,1180px)] bg-gradient-to-l from-transparent via-white/80 to-transparent dark:via-cyan-300/18" />

      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-10 pb-16 pt-8 lg:min-h-[calc(100vh-7.5rem)] lg:grid-cols-[1.18fr_.82fr] lg:gap-12 lg:pb-14 lg:pt-5">
        <div className="order-2 lg:order-1">
          <AnimatedDashboardMockup />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .8, ease: [0.22, 1, 0.36, 1] }}
          className="order-1 text-center lg:order-2 lg:text-start"
        >
          <SplineBrandObject />
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-wesal-accent/20 bg-white/78 px-4 py-2 text-sm font-black text-wesal-primary shadow-sm backdrop-blur dark:border-cyan-300/18 dark:bg-white/8 dark:text-cyan-100">
            <ShieldCheck className="h-4 w-4 text-wesal-accent" />
            منصة تشغيل محادثات للتجار الجادين
          </p>
          <h1 className="mx-auto max-w-[640px] text-[2.65rem] font-black leading-[1.06] tracking-normal text-wesal-primary sm:text-5xl lg:mx-0 lg:text-[4.35rem] dark:text-white">
            حوّل محادثات العملاء إلى مبيعات منظمة
          </h1>
          <p className="mx-auto mt-5 max-w-[590px] text-base leading-8 text-slate-600 sm:text-lg lg:mx-0 dark:text-slate-300">
            وصال ون يجمع واتساب، إنستغرام، ماسنجر، تيليجرام والمكالمات في صندوق وارد ذكي، مع سياق كامل لكل عميل، متابعة واضحة، وردود أسرع لفريقك.
          </p>

          <div className="mt-6 grid gap-3 text-sm font-bold text-slate-600 sm:grid-cols-2 dark:text-slate-300">
            {["لا تضيع أي محادثة", "فريقك يرى نفس السياق", "مناسب للتجار في اليمن", "جاهز للنمو بدون تعقيد"].map((item) => (
              <span key={item} className="inline-flex items-center justify-center gap-2 lg:justify-start">
                <CheckCircle2 className="h-4 w-4 text-wesal-accent" />
                {item}
              </span>
            ))}
          </div>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
            <motion.a
              whileHover={{ y: -4, scale: 1.02 }}
              whileTap={{ scale: .98 }}
              href="#contact"
              className="group inline-flex items-center justify-center gap-2 rounded-xl bg-wesal-blue px-9 py-4 text-base font-black text-white shadow-[0_20px_46px_rgba(11,111,232,.34)]"
            >
              ابدأ التجربة
              <ArrowLeft className="h-5 w-5 transition group-hover:-translate-x-1" />
            </motion.a>
            <motion.a
              whileHover={{ y: -4, scale: 1.02 }}
              whileTap={{ scale: .98 }}
              href="#features"
              className="rounded-xl border border-wesal-blue/25 bg-white/90 px-9 py-4 text-base font-black text-wesal-primary shadow-sm backdrop-blur dark:border-cyan-300/20 dark:bg-white/10 dark:text-white"
            >
              احجز عرضًا سريعًا
            </motion.a>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: .55, duration: .7 }}
            className="mt-6 grid gap-3 rounded-2xl border border-white/70 bg-white/72 p-3 shadow-[0_18px_50px_rgba(27,58,92,.08)] backdrop-blur-xl sm:grid-cols-3 dark:border-white/10 dark:bg-white/6"
          >
            {[
              ["1,250+", "محادثة منظمة"],
              ["96%", "رضا العملاء"],
              ["5 قنوات", "في لوحة واحدة"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-xl bg-white/65 px-4 py-3 text-center dark:bg-white/6">
                <p className="text-lg font-black text-wesal-blue dark:text-cyan-200">{value}</p>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-300">{label}</p>
              </div>
            ))}
          </motion.div>

          <div className="mt-8 flex flex-wrap justify-center gap-4 lg:justify-start">
            {channels.map(([name, color, label], index) => (
              <motion.span
                key={name}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: .35 + index * .08 }}
                whileHover={{ scale: 1.12, rotate: 8 }}
                className="channel-gloss grid h-14 w-14 place-items-center rounded-full text-sm font-black text-white"
                style={{ "--channel-bg": color, "--channel-shadow": `${color}55` } as React.CSSProperties}
                title={name}
              >
                {label}
              </motion.span>
            ))}
          </div>
          <p className="mt-5 inline-flex items-center justify-center gap-2 text-sm font-bold text-slate-500 lg:justify-start dark:text-slate-300">
            <Sparkles className="h-4 w-4 text-wesal-accent" />
            تصميم خفيف، جاهز للجوال، ومناسب لفرق المبيعات والدعم.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
