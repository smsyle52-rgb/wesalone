import { useEffect } from "react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
}

export function Modal({ open, onClose, title, children, size = "md" }: ModalProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    if (open) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  const sizeClass = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={cn(
          "relative flex max-h-[calc(100dvh-1.5rem-var(--app-safe-top)-var(--app-safe-bottom))] w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl sm:max-h-[calc(100dvh-2rem)]",
          sizeClass,
        )}
      >
        {title && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5 sm:py-4">
            <h2 className="min-w-0 break-words text-base font-bold text-foreground">{title}</h2>
            <button
              onClick={onClose}
              className="app-touch-target inline-flex shrink-0 items-center justify-center rounded-lg text-xl leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="إغلاق"
            >
              ×
            </button>
          </div>
        )}
        <div className="app-modal-body min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}
