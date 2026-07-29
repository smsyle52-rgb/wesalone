import Link from "next/link";

import { cn } from "@/lib/utils";

interface ShimmerButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  href?: string;
}

export function ShimmerButton({
  className,
  children,
  href,
  ...props
}: ShimmerButtonProps) {
  const content = (
    <>
      <span className="relative z-10 inline-flex items-center gap-2">
        {children}
      </span>
      <span
        aria-hidden
        className="animate-shimmer absolute inset-0 bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.35)_50%,transparent_70%)] bg-[length:250%_100%]"
      />
    </>
  );
  const styles = cn(
    "group relative inline-flex h-12 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full bg-primary px-8 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/30 transition-[transform,box-shadow] duration-300 hover:scale-[1.03] hover:shadow-xl hover:shadow-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98]",
    className
  );

  if (href) {
    return (
      <Link data-slot="shimmer-button" className={styles} href={href}>
        {content}
      </Link>
    );
  }

  return (
    <button
      data-slot="shimmer-button"
      className={styles}
      {...props}
    >
      {content}
    </button>
  );
}

