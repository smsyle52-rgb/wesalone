"use client";

import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

interface BackgroundBeamsProps {
  className?: string;
  /** Number of beams */
  count?: number;
}

/**
 * Decorative light beams flowing along curved paths — a full-section
 * background. Place inside a `relative overflow-hidden` container.
 */
export function BackgroundBeams({ className, count = 7 }: BackgroundBeamsProps) {
  const reducedMotion = useReducedMotion();

  const paths = Array.from({ length: count }, (_, i) => {
    const o = i * 90;
    return `M-${300 + o} -${100 + i * 40} C ${-100 + o} ${120 + i * 30}, ${
      200 + o
    } ${180 + i * 30}, ${640 + o} ${440 + i * 40}`;
  });

  return (
    <div
      aria-hidden
      data-slot="background-beams"
      className={cn("pointer-events-none absolute inset-0", className)}
    >
      <svg
        className="size-full"
        viewBox="0 0 960 540"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
      >
        {paths.map((d, i) => (
          <path
            key={`base-${i}`}
            d={d}
            stroke="var(--border)"
            strokeOpacity={0.35}
            strokeWidth={1}
          />
        ))}
        {!reducedMotion &&
          paths.map((d, i) => (
            <path
              key={`beam-${i}`}
              d={d}
              stroke={`url(#beam-gradient-${i})`}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          ))}
        <defs>
          {paths.map((_, i) => (
            <motion.linearGradient
              key={`grad-${i}`}
              id={`beam-gradient-${i}`}
              gradientUnits="userSpaceOnUse"
              initial={{ x1: "0%", x2: "5%", y1: "0%", y2: "5%" }}
              animate={{
                x1: ["0%", "100%"],
                x2: ["5%", "105%"],
                y1: ["0%", "100%"],
                y2: ["5%", "105%"],
              }}
              transition={{
                duration: 6 + (i % 4) * 2,
                delay: i * 1.1,
                repeat: Infinity,
                ease: "linear",
              }}
            >
              <stop stopColor="var(--brand-from)" stopOpacity="0" />
              <stop offset="30%" stopColor="var(--brand-from)" />
              <stop offset="60%" stopColor="var(--brand-to)" />
              <stop offset="100%" stopColor="var(--brand-to)" stopOpacity="0" />
            </motion.linearGradient>
          ))}
        </defs>
      </svg>
    </div>
  );
}

