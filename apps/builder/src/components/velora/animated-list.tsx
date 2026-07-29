"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";

interface AnimatedListProps {
  children: React.ReactNode;
  className?: string;
  /** ms between items appearing */
  delay?: number;
}

/**
 * Reveals children one by one, newest on top, then loops.
 * Wrap in a fixed-height container with a bottom mask for a feed effect.
 */
export function AnimatedList({
  children,
  className,
  delay = 2000,
}: AnimatedListProps) {
  const [index, setIndex] = useState(0);
  const items = useMemo(() => React.Children.toArray(children), [children]);

  useEffect(() => {
    const interval = setInterval(
      () => setIndex((i) => (i + 1) % items.length),
      delay
    );
    return () => clearInterval(interval);
  }, [items.length, delay]);

  const visible = useMemo(
    () => items.slice(0, index + 1).reverse(),
    [items, index]
  );

  return (
    <div
      data-slot="animated-list"
      className={cn("flex flex-col gap-3", className)}
    >
      <AnimatePresence>
        {visible.map((item) => (
          <motion.div
            key={(item as React.ReactElement).key}
            layout
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1, originY: 0 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 350, damping: 40 }}
            className="w-full"
          >
            {item}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

