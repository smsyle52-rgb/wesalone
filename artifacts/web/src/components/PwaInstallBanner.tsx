import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

const DISMISSED_KEY = "pwa-install-dismissed-v1";

function isIos() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && !(window as { MSStream?: unknown }).MSStream;
}

function isInStandaloneMode() {
  return (
    ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true) ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

export function PwaInstallBanner() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (isInStandaloneMode()) { setInstalled(true); return; }
    if (localStorage.getItem(DISMISSED_KEY)) { setDismissed(true); return; }

    const handler = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener("beforeinstallprompt", handler);

    if (isIos() && !isInStandaloneMode()) {
      setShowIosHint(true);
    }

    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function handleInstall() {
    if (!installEvent) return;
    void installEvent.prompt();
    void installEvent.userChoice.then((choice) => {
      if (choice.outcome === "accepted") setInstalled(true);
      else dismiss();
    });
    setInstallEvent(null);
  }

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
    setShowIosHint(false);
    setInstallEvent(null);
  }

  if (!user || installed || dismissed) return null;
  if (!installEvent && !showIosHint) return null;

  return (
    <div className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom)+0.5rem)] lg:bottom-4 inset-x-4 z-40 max-w-sm mx-auto" dir="rtl">
      <div className="rounded-2xl border border-border bg-card shadow-lg p-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Download className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          {installEvent ? (
            <>
              <p className="text-sm font-semibold text-foreground">ثبّت وصال ون</p>
              <p className="text-xs text-muted-foreground mt-0.5">احصل على تجربة أسرع بدون متصفح</p>
              <button
                onClick={handleInstall}
                className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                تثبيت التطبيق
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-foreground">أضف وصال ون للشاشة الرئيسية</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                اضغط على زر المشاركة <span className="font-mono">⬆</span> في المتصفح ثم اختر <strong>«إضافة إلى الشاشة الرئيسية»</strong>
              </p>
            </>
          )}
        </div>
        <button
          onClick={dismiss}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted/50 transition-colors"
          aria-label="إغلاق"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
