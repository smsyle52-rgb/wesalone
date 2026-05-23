"use client";

import { motion } from "framer-motion";

export function CTA() {
  return (
    <section className="px-4 py-16">
      <motion.div
        initial={{ opacity: 0, y: 22 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="premium-cta mx-auto max-w-7xl overflow-hidden rounded-[2rem] px-6 py-14 text-center text-white shadow-[0_25px_80px_rgba(27,58,92,.25)]"
      >
        <p className="mb-3 text-sm font-black text-cyan-100">جاهز لتجربة أكثر ترتيبًا؟</p>
        <h2 className="text-3xl font-black md:text-4xl">ابدأ اليوم مع وصال ون</h2>
        <p className="mx-auto mt-4 max-w-2xl leading-8 text-blue-100">واجهة احترافية لإدارة المحادثات وتنمية نشاطك، تجمع القنوات والفريق وسياق العميل في مكان واحد واضح، بدون تعقيد تقني.</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <a href="#contact" className="rounded-xl bg-wesal-accent px-10 py-4 font-black text-white transition hover:-translate-y-1">ابدأ الآن</a>
          <a href="#features" className="rounded-xl border border-white/30 px-10 py-4 font-black text-white transition hover:-translate-y-1 hover:bg-white/10">استكشف المزايا</a>
        </div>
      </motion.div>
    </section>
  );
}
