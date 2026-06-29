import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export function MarketingLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="marketing-logo" dir="rtl">
      <img
        src="/assets/wesal/wesal-logo-mark.png"
        alt=""
        aria-hidden="true"
        className={
          compact ? "marketing-logo-mark compact" : "marketing-logo-mark"
        }
      />
      <span className="flex flex-col text-right leading-none">
        <strong
          className={
            compact ? "text-[16px] font-black" : "text-[18px] font-black"
          }
        >
          وصال ون
        </strong>
        <span className="mt-1 text-[9px] font-black tracking-[.2em] text-cyan-400">
          Wesal One
        </span>
      </span>
    </span>
  );
}

export function MarketingTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line2)] bg-white/[.035] px-4 py-2 text-xs font-black text-cyan-300">
      <Sparkles className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  description,
  center = true,
}: {
  eyebrow: string;
  title: string;
  description: string;
  center?: boolean;
}) {
  return (
    <div className={center ? "mx-auto max-w-3xl text-center" : "max-w-2xl"}>
      <div className="text-xs font-black tracking-wide text-cyan-400">
        {eyebrow}
      </div>
      <h2 className="mt-3 text-3xl font-black leading-tight sm:text-4xl">
        {title}
      </h2>
      <p className="wp-soft mt-4 text-sm leading-7 sm:text-base">
        {description}
      </p>
    </div>
  );
}

export function ChannelBadge({
  name,
  label,
  color,
}: {
  name: string;
  label: string;
  color: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.055] px-3 py-2 text-[11px] font-bold">
      <span
        className="grid h-6 w-6 place-items-center rounded-lg text-[10px] font-black text-white"
        style={{ background: color }}
      >
        {name}
      </span>
      {label}
    </span>
  );
}

export function HeroCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`wp-glass rounded-2xl p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-4">
        <strong className="text-xs">{title}</strong>
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_#22d3ee]" />
      </div>
      {children}
    </div>
  );
}
