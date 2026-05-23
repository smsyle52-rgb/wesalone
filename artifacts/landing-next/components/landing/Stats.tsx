"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";

const stats = [
  { value: 1250, suffix: "+", label: "محادثة تمت إدارتها" },
  { value: 96, suffix: "%", label: "رضا العملاء" },
  { value: 2.5, suffix: " دقيقة", label: "متوسط الرد" },
  { value: 18, suffix: "%", label: "زيادة في المبيعات" },
];

export function Stats() {
  const ref = useRef<HTMLDivElement | null>(null);
  const visible = useInView(ref, { once: true, amount: .35 });

  return (
    <section id="stats" className="px-4 py-14">
      <div ref={ref} className="mx-auto grid max-w-7xl gap-4 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-[0_22px_70px_rgba(27,58,92,.08)] md:grid-cols-4 dark:border-white/10 dark:bg-[#071524]/82">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * .08 }}
            className="rounded-2xl bg-blue-50/70 p-6 text-center dark:bg-white/6"
          >
            <p className="text-3xl font-black text-wesal-blue dark:text-cyan-200">
              <Counter target={stat.value} active={visible} suffix={stat.suffix} />
            </p>
            <p className="mt-2 font-bold text-wesal-primary dark:text-white">{stat.label}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function Counter({ target, active, suffix }: { target: number; active: boolean; suffix: string }) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const total = 64;
    let raf = 0;
    const tick = () => {
      frame += 1;
      const progress = 1 - Math.pow(1 - frame / total, 3);
      setValue(Number((target * progress).toFixed(target % 1 ? 1 : 0)));
      if (frame < total) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target]);

  return <>{value.toLocaleString("ar")}{suffix}</>;
}
