import { cn } from "@/lib/utils";

interface IphoneMockupProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * iPhone frame with dynamic island and side buttons — drop any
 * screen content inside.
 */
export function IphoneMockup({
  className,
  children,
  ...props
}: IphoneMockupProps) {
  return (
    <div
      data-slot="iphone-mockup"
      className={cn("relative mx-auto w-70", className)}
      {...props}
    >
      {/* Side buttons */}
      <span className="absolute top-24 -left-0.75 h-8 w-1 rounded-l-md bg-neutral-700" />
      <span className="absolute top-36 -left-0.75 h-12 w-1 rounded-l-md bg-neutral-700" />
      <span className="absolute top-52 -left-0.75 h-12 w-1 rounded-l-md bg-neutral-700" />
      <span className="absolute top-32 -right-0.75 h-16 w-1 rounded-r-md bg-neutral-700" />

      <div className="relative aspect-[9/19] overflow-hidden rounded-[3rem] border-10 border-neutral-800 bg-background shadow-2xl">
        {/* Dynamic island */}
        <span className="absolute top-2.5 left-1/2 z-20 h-6.5 w-24 -translate-x-1/2 rounded-full bg-neutral-900" />
        <div className="absolute inset-0">{children}</div>
      </div>
    </div>
  );
}

