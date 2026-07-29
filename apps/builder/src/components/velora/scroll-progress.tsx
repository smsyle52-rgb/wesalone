"use client";

import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";

import { cn } from "@/lib/utils";

interface ScrollProgressProps {
  className?: string;
}

export function ScrollProgress({ className }: ScrollProgressProps) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 180,
    damping: 32,
    restDelta: 0.001,
  });
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      aria-hidden
      data-slot="scroll-progress"
      className={cn(
        "fixed inset-x-0 top-0 z-[60] h-0.75 origin-left bg-gradient-to-r from-brand-from via-brand-via to-brand-to",
        className
      )}
      style={{ scaleX: reducedMotion ? scrollYProgress : scaleX }}
    />
  );
}

