"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

interface FlipWordsProps {
  words: string[];
  /** ms each word stays on screen */
  duration?: number;
  className?: string;
}

/**
 * Cycles through words with a blur-flip transition.
 */
export function FlipWords({ words, duration = 2600, className }: FlipWordsProps) {
  const [index, setIndex] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    const interval = setInterval(
      () => setIndex((i) => (i + 1) % words.length),
      duration
    );
    return () => clearInterval(interval);
  }, [words.length, duration, reducedMotion]);

  if (reducedMotion) {
    return <span className={cn(className)}>{words[0]}</span>;
  }

  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), "");

  // The invisible longest word reserves the cell size so flipping
  // between words never shifts surrounding layout.
  return (
    <span
      data-slot="flip-words"
      className={cn("inline-grid text-left align-bottom", className)}
    >
      <span aria-hidden className="invisible col-start-1 row-start-1">
        {longest}
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={words[index]}
          initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -14, filter: "blur(6px)" }}
          transition={{ type: "spring", stiffness: 240, damping: 26 }}
          className="col-start-1 row-start-1 inline-block"
        >
          {words[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

